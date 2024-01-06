const chatBox = document.getElementById("chat-box");
const inputField = document.getElementById("chat-input");
const sendButton = document.getElementById("send-button");
let latestAIMessageElement = null;

const ws = new WebSocket(`wss://${window.location.host}`);

ws.onopen = function () {
  sendButton.addEventListener("click", sendMessage);
  inputField.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
};

ws.onmessage = function (event) {
  if (!latestAIMessageElement) {
    latestAIMessageElement = document.createElement("div");
    latestAIMessageElement.className = "message ai-message";
    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = "TotoB12";
    chatBox.appendChild(label);
    chatBox.appendChild(latestAIMessageElement);
  }
  latestAIMessageElement.innerHTML += event.data.replace(/\n/g, "<br>");
  chatBox.scrollTop = chatBox.scrollHeight;
};

function sendMessage() {
    const inputField = document.getElementById('chat-input');
    const userText = inputField.value.trim();
    if (userText === '') return;

  const userLabel = document.createElement("div");
  userLabel.className = "message-label";
  userLabel.textContent = "You";
  chatBox.appendChild(userLabel);

  chatBox.innerHTML += `<div class="message user-message">${userText.replace(
    /\n/g,
    "<br>",
  )}</div>`;
  inputField.value = "";

  resetTextarea();
  latestAIMessageElement = null;
  ws.send(userText);
}

// Function to resize the textarea only when a new line is added
function resizeTextarea() {
  const textarea = document.getElementById("chat-input");
  const numberOfLineBreaks = (textarea.value.match(/\n/g) || []).length;
  // Minimum number of lines the textarea will have
  const newHeight = 17 + numberOfLineBreaks * 22; // 22 is the line height, adjust if different
  if (newHeight < 176) {
    // 176 is the max height for 8 lines
    textarea.style.height = newHeight + "px";
  } else {
    textarea.style.height = "176px";
    textarea.style.overflowY = "auto";
  }
}

// Reset the textarea after sending a message
function resetTextarea() {
  const textarea = document.getElementById("chat-input");
  textarea.style.height = "22px";
  textarea.style.overflowY = "hidden";
}

document.getElementById("chat-input").addEventListener("input", resizeTextarea);
