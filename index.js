const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const genAI = new GoogleGenerativeAI(process.env["API_KEY"]);
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

app.use(bodyParser.json());
app.use(express.static("public"));

wss.on("connection", function connection(ws) {
  ws.on("message", async function incoming(messageBuffer) {
    try {
      const message = messageBuffer.toString();
      console.log(message);

      const model = genAI.getGenerativeModel({ model: "gemini-pro", safetySettings });
      const result = await model.generateContentStream(message);

      for await (const chunk of result.stream) {
        ws.send(chunk.text());
      }

      ws.send(JSON.stringify({ type: "AI_COMPLETE", uniqueIdentifier: "7777" }));
    } catch (error) {
      console.error(error);
      ws.send("Error: Unable to process the request.");
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`Server started on port ${server.address().port}`);
});
