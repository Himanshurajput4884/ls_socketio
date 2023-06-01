const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const cassandra = require("cassandra-driver");
const datacenter = "datacenter1";
const contactPoints = ["localhost"];
const keyspace = "lsQuiz";

const client = new cassandra.Client({
  contactPoints: contactPoints,
  localDataCenter: datacenter,
});

const app = express();
app.use(cors());

const server = http.createServer(app);

// Pass the server instance to socket.io
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3001",
    methods: ["GET", "POST"],
    allowedHeaders: ["my-custom-header"],
    credentials: true,
  },
});

const shouldStartQuiz = (dateString, timeString) => {
  const targetDate = new Date(dateString);
  const targetTime = new Date(`2000-01-01T${timeString}`);
  const currentTime = new Date();

  return (
    currentTime >= targetDate &&
    currentTime.getHours() === targetTime.getHours() &&
    currentTime.getMinutes() === targetTime.getMinutes()
  );
};

const getTables = async () => {
  await client.connect();
  await client.execute(`USE lsquiz`);

  const response = await client.execute(`SELECT * FROM PENDINGQUIZ`);
  if (response.rows.length === 0) {
    return [];
  }

  const ques = await client.execute(`SELECT * FROM fastquizquestiontable;`);
  console.log(ques.rows);
  return ques.rows;
};

let currentQuestionIndex = -1;
let questionTimer;
const questionInterval = 60 * 1000; // 60 seconds

io.on("connection", async (socket) => {
  console.log("A client connected");
  const quizQuestions = await getTables();

  socket.on("startQuiz", () => {
    // Delay the start of the quiz by 5 minutes
    setTimeout(() => {
      sendNextQuestion(socket, quizQuestions);
    }, 5000);
  });

  socket.on("answer", (data) => {
    clearTimeout(questionTimer);

    // Check the answer and calculate the score
    const currentQuestion = quizQuestions[currentQuestionIndex];
    const score = data.answer === currentQuestion.answer ? 100 : 0;

    console.log("Received answer:", data, "Score:", score);

    // Send the score back to the client
    socket.emit("score", { score });

    // Proceed to the next question or end the quiz if all questions have been asked
    if (currentQuestionIndex < quizQuestions.length - 1) {
      sendNextQuestion(socket, quizQuestions);
    } else {
      endQuiz(socket);
    }
  });

  socket.on("disconnect", () => {
    console.log("A client disconnected");
    clearTimeout(questionTimer);
  });
});

function sendNextQuestion(socket, quizQuestions) {
  currentQuestionIndex++;

  if (currentQuestionIndex >= quizQuestions.length) {
    // All questions have been asked, end the quiz
    endQuiz(socket);
    return;
  }

  const currentQuestion = quizQuestions[currentQuestionIndex];
  const questionData = {
    question: currentQuestion.question,
    options: [currentQuestion.opt1, currentQuestion.opt2, currentQuestion.opt3],
    timeLimit: questionInterval / 1000, // Convert milliseconds to seconds
  };

  // Send the question data to the client
  socket.emit("question", questionData);

  // Start the timer for the question
  questionTimer = setTimeout(() => {
    // Time's up, consider it as an unanswered question
    const score = 0;
    console.log("Time's up! Score:", score);

    // Send the score back to the client
    socket.emit("score", { score });

    // Proceed to the next question or end the quiz if all questions have been asked
    if (currentQuestionIndex < quizQuestions.length - 1) {
      sendNextQuestion(socket, quizQuestions);
    } else {
      endQuiz(socket);
    }
  }, questionInterval);
}

function endQuiz(socket) {
  console.log("Quiz ended");
  // Perform any necessary cleanup or final calculations here
  // ...
}

const PORT = 8007;
server.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});
