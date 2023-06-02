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
    (currentTime.getMinutes() === targetTime.getMinutes())
  );
};

const getTables = async () => {
  await client.connect();
  await client.execute(`USE lsquiz`);

  const response = await client.execute(`SELECT * FROM PENDINGQUIZ`);
  if (response.rows.length === 0) {
    return [];
  }

  const data = response.rows;

  const quizQuestions = await Promise.all(
    data.map(async (v) => {
      if (shouldStartQuiz(v.date, v.time)) {
        const tableName = v.quizname + "questiontable";
        const query = `SELECT * FROM ${tableName}`;
        const result = await client.execute(query);
        return result.rows;
      }
      return undefined; // Return undefined for non-matching quizzes
    })
  );

  const filteredQuizQuestions = quizQuestions.filter((questions) => questions !== undefined);

  return filteredQuizQuestions.flat();
};

let questionTimer;
let questionStartTime;
const questionInterval = 60 * 1000;
const participants = [];

io.on("connection", async (socket) => {
  console.log("A client connected: ", socket.id);
  const quizQuestions = await getTables();

  console.log("QuizQuestions in io: ", quizQuestions[0]);
  const participant = {
    socketId: socket.id,
    score: 0,
    questionIndex: 0,
  };
  console.log(participant);
  participants.push(participant);
  socket.on("startQuiz", () => {
    // Delay the start of the quiz by 5 minutes
    setTimeout(() => {
      sendNextQuestion(participant, quizQuestions);
    }, 2000);
  });

  socket.on("answer", (data) => {
    clearTimeout(questionTimer);

    // Check the answer and calculate the score
    const currentQuestion = quizQuestions[participant.questionIndex];

    console.log(data);
    // Send the score back to the client
    const responseTime = data.responseTime;
    const timeRatio = 1 - responseTime / 60;
    console.log(timeRatio);
    // Calculate the score based on response time and correctness
    const score =
      data.answer === currentQuestion.answer ? Math.floor(100 * timeRatio) : 0;

    // Update participant's score
    participant.score += score;
    console.log("Received answer:", data, "Score:", score);
    socket.emit("score", { score: participant.score });

    // Proceed to the next question or end the quiz if all questions have been asked
    participant.questionIndex++;
    if (participant.questionIndex >= quizQuestions.length) {
      endQuizForParticipant(participant);
    } else {
      sendNextQuestion(participant, quizQuestions);
    }
  });

  socket.on("disconnect", () => {
    console.log("A client disconnected: ", socket.id);
    const index = participants.findIndex((p) => p.socketId === socket.id);
    if (index !== -1) {
      participants.splice(index, 1);
    }
    clearTimeout(questionTimer);
  });
});

function sendNextQuestion(participant, quizQuestions) {
  const { socketId, questionIndex } = participant;

  if (questionIndex >= quizQuestions.length) {
    // All questions have been answered by the participant, end the quiz for that participant
    endQuizForParticipant(participant);
    return;
  }
  const currentQuestion = quizQuestions[questionIndex];
  // console.log(currentQuestion);
  const questionData = {
    question: currentQuestion.question,
    options: [currentQuestion.opt1, currentQuestion.opt2, currentQuestion.opt3],
    timeLimit: questionInterval / 1000, // Convert milliseconds to seconds
  };

  io.to(socketId).emit("question", questionData);

  questionStartTime = Date.now();
  questionTimer = setTimeout(() => {
    // Time's up, consider it as an unanswered question
    const score = 0;
    participant.score += score;

    // Send the score back to the participant
    io.to(socketId).emit("score", { score: participant.score });

    // Proceed to the next question or end the quiz for the participant
    participant.questionIndex++;
    if (participant.questionIndex >= quizQuestions.length) {
      endQuizForParticipant(participant);
    } else {
      sendNextQuestion(participant, quizQuestions); // Pass `quizQuestions` parameter here
    }
  }, questionInterval);
}

function endQuizForParticipant(participant) {
  console.log(`Quiz ended for participant: ${participant.socketId}`);
  // Remove the participant from the participants array
  const index = participants.findIndex(
    (p) => p.socketId === participant.socketId
  );
  if (index !== -1) {
    participants.splice(index, 1);
  }
}

const PORT = 8007;
server.listen(PORT, () => {
  console.log(`Server is running at ${PORT}`);
});
