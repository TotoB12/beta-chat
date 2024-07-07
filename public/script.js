const DEFAULT_MODEL_PREFERENCE = "Fast";
const chatBox = document.getElementById("chat-box");
const inputField = document.getElementById("chat-input");
const sendButton = document.getElementById("send-button");
const modelToggle = document.getElementById("modelToggle");
const modelPreference = localStorage.getItem("modelPreference") || "Fast";
const newChatButton = document.getElementById("newChatButton");
const deleteAllButton = document.getElementById("deleteAllButton");
const settingsButton = document.getElementById("settingsButton");
const settingsModal = document.getElementById("settings-modal");
const settingsCloseButton = document.querySelector(".close-button");
const charCountElement = document.getElementById("char-count");
const expanderButton = document.getElementById("expander-button");
const menuToggleCheckbox = document.querySelector("#menuToggle input");
const menu = document.getElementById("menu");
const conversationElements = document.querySelectorAll(".conversation");
const transparentOverlay = document.getElementById("transparent-overlay");
let buffer;
let reconnectionAttempts = 0;
const maxReconnectionAttempts = 5;
let latestAIMessageElement = null;
let isAIResponding = false;
let lastPingTimestamp;
let currentUploadXHR = null;
let currentConversationUUID = null;
let isNewConversation = false;
const main_color = "#eee";
const disabled_color = "#aaa";
const hover_color = "#ddd";

const anim_canvas = document.getElementById("animation");
const ctx = anim_canvas.getContext("2d");
const chatBoxStyle = window.getComputedStyle(chatBox);
const anim_params = {
  pointsNumber: 40,
  widthFactor: 0.3,
  mouseThreshold: 0.6, // 0.6
  spring: 0.4,
  friction: 0.5,
};
const anim_trail = new Array(anim_params.pointsNumber);
let useSimulatedMouse = true;
let userMouseX = 0;
let userMouseY = 0;

let ws;
let pingInterval;
const imgurClientId = "6a8a51f3d7933e1";

anim_canvas.width = window.innerWidth;
anim_canvas.height = window.innerHeight;
// anim_canvas.width = 1400;
// anim_canvas.height = 280;



function generateUUID() {
  let uuid;
  do {
    uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        var r = (Math.random() * 16) | 0,
          v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      },
    );
  } while (localStorage.getItem(uuid) !== null);
  return uuid;
}

function generateElementId() {
  return `ele-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function validateUUID(uuid) {
  const regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
}

function updateChatBoxVisibility() {
  const welcomeScreen = document.getElementById("welcome-screen");
  if (document.getElementById("chat-box").innerHTML.trim() === "") {
    welcomeScreen.classList.add("show");
    typeText("typing-text", "Hello! How can I assist you today?");
  } else {
    welcomeScreen.classList.remove("show");
  }
}

function updateSendButtonState() {
  if (isAIResponding) {
    sendButton.classList.add("ai-responding");
    sendButton.innerHTML =
      '<span class="material-symbols-outlined">stop_circle</span>';
    // sendButton.style.backgroundColor = disabled_color;
  } else {
    sendButton.classList.remove("ai-responding");
    sendButton.innerHTML =
      '<span class="material-symbols-outlined">arrow_upward_alt</span>';
    // sendButton.style.backgroundColor = main_color;
  }
}

function typeText(elementId, text, typingSpeed = 50) {
  const element = document.getElementById(elementId);
  let charIndex = 0;
  element.innerHTML = "";

  // sourcery skip: avoid-function-declarations-in-blocks
  function typing() {
    if (charIndex < text.length) {
      if (text.charAt(charIndex) === "\n") {
        element.innerHTML += "<br>";
      } else {
        element.innerHTML += text.charAt(charIndex);
      }
      charIndex++;
      setTimeout(typing, typingSpeed);
    }
  }

  typing();
}

function startHeartbeat() {
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendPing();
    }
  }, 5000);
}

function stopHeartbeat() {
  clearInterval(pingInterval);
}

function sendPing() {
  lastPingTimestamp = Date.now();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "ping" }));
  }
}

function createUserMessage(entry) {
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "You";
  chatBox.appendChild(label);
  chatBox.innerHTML += `<div class="message user-message">${marked.parse(
    entry.message,
  )}</div>`;

  if (entry.images) {
    entry.images.forEach((image) => {
      displayImage(image.link);
    });
  }
}

function loadHistory() {
  const history = getHistory();

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    const label = document.createElement("div");
    label.className = "message-label";

    if (entry.role === "user") {
      createUserMessage(entry);
    } else if (entry.role === "assistant") {
      label.textContent = "TotoB12";
      chatBox.appendChild(label);

      let input = entry.message;
      const match = input.match(/\{"generateImage": "(.+?)"\}/);
      if (match) {
        input = input.replace(match[0], "");
      }

      if (input.trim() !== "") {
        const div = document.createElement("div");
        div.className = "message ai-message";
        div.innerHTML = marked.parse(input);
        chatBox.appendChild(div);
      }

      if (entry.images && entry.images.length) {
        entry.images.forEach((image) => {
          displayImage(image.link);
        });
      }
    } else if (entry.role === "system") {
      // system messages
    }
  }
  chatBox.scrollTop = chatBox.scrollHeight;
  wrapCodeElements();
}

function checkImageInHistory() {
  const history = getHistory();
  return history.some((entry) => entry.image);
}

function updateCharacterCount() {
  const charCount = inputField.value.length;

  const charLimit = 60000;

  charCountElement.innerHTML = `${charCount
    .toLocaleString()
    .replace(",", " ")}<br><hr>${charLimit.toLocaleString().replace(",", " ")}`;

  const hrElement = charCountElement.querySelector("hr");
  if (charCount >= charLimit) {
    displayNotification("Character limit exceeded.", "error");
    charCountElement.style.color = "red";
    hrElement.style.borderColor = "red";
    inputField.value = inputField.value.substring(0, charLimit);
  } else {
    charCountElement.style.color = main_color;
    hrElement.style.borderColor = main_color;
  }

  if (charCount > 300) {
    charCountElement.style.display = "block";
  } else {
    charCountElement.style.display = "none";
  }
}

function updateHistory(
  role,
  message,
  updateLast = false,
  images = [],
  error = false,
) {
  let history = getHistory();
  const timestamp = new Date().getTime();

  if (
    updateLast &&
    history.length > 0 &&
    history[history.length - 1].role === "assistant"
  ) {
    history[history.length - 1].message = message;
    if (error) {
      history[history.length - 1].error = true;
    }
    if (images.length) {
      history[history.length - 1].images = images;
    }
    history[history.length - 1].timestamp = timestamp;
  } else {
    const newEntry = {
      role: role,
      message: message,
      error: error,
      id: generateElementId(),
      images: images,
      timestamp: timestamp,
    };
    history.push(newEntry);
  }

  if (!currentConversationUUID) {
    currentConversationUUID = generateUUID();
    console.log("haaaaaaaaaaaa");
    window.history.pushState(null, null, `/c/${currentConversationUUID}`);
  }

  if (isNewConversation) {
    window.history.pushState(null, null, `/c/${currentConversationUUID}`);
    // isNewConversation = false;
  }

  localStorage.setItem(
    "timestamp_" + currentConversationUUID,
    timestamp.toString(),
  );
  localStorage.setItem(currentConversationUUID, JSON.stringify(history));
}

function debugLogAllConversations() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);

    if (key && key.includes("-")) {
      const conversation = localStorage.getItem(key);
      console.log(`Conversation UUID: ${key}`);
      console.log("Conversation Data:", JSON.parse(conversation));
    }
  }
}

function clearLocalStorage() {
  localStorage.clear();
  console.log("Local storage cleared.");
  window.location.href = "/";
}

function getHistory() {
  const defaultConversationStarter = [];

  if (!currentConversationUUID) {
    currentConversationUUID = generateUUID();
    isNewConversation = true;
    return defaultConversationStarter;
  }

  const history = localStorage.getItem(currentConversationUUID);
  return history ? JSON.parse(history) : defaultConversationStarter;
}

function updateMenuWithConversations() {
  const menu = document.getElementById("menu");
  const resetButton = menu.querySelector("#newChatButton");
  const deleteAllButton = menu.querySelector("#deleteAllButton");
  menu.innerHTML = "";
  menu.appendChild(resetButton);
  menu.appendChild(deleteAllButton);
  menu.appendChild(settingsButton);

  let conversations = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('timestamp_')) {
      const uuid = key.replace('timestamp_', '');
      const timestamp = parseInt(localStorage.getItem(key), 10);
      if (!isNaN(timestamp)) {
        conversations.push({ uuid, timestamp });
      }
    }
  }

  conversations.sort((a, b) => b.timestamp - a.timestamp);

  if (conversations.length === 0) {
    const noConversationsMessage = document.createElement("div");
    noConversationsMessage.className = "no-conversations-message";
    noConversationsMessage.innerHTML = "<p>No conversations available</p><p>Start chatting now!</p>";
    menu.appendChild(noConversationsMessage);
    deleteAllButton.classList.add("disabled");
  } else {
    const now = new Date();
    const today = new Date(now.setHours(0, 0, 0, 0));
    const yesterday = new Date(today).setDate(today.getDate() - 1);
    const sevenDaysAgo = new Date(today).setDate(today.getDate() - 7);

    const categories = [
      { label: "Today", start: today.getTime(), conversations: [] },
      { label: "Yesterday", start: yesterday, end: today.getTime(), conversations: [] },
      { label: "Previous 7 Days", start: sevenDaysAgo, end: yesterday, conversations: [] },
      { label: "Older", end: sevenDaysAgo, conversations: [] },
    ];

    conversations.forEach(({ uuid, timestamp }) => {
      const conversationDate = new Date(timestamp);
      const category = categories.find(cat => {
        return (!cat.start || conversationDate >= cat.start) && (!cat.end || conversationDate < cat.end);
      });
      if (category) {
        category.conversations.push({ uuid, timestamp });
      }
    });

    categories.forEach(category => {
      if (category.conversations.length > 0) {
        const header = document.createElement("p");
        header.className = "conversation-header";
        header.textContent = category.label;
        menu.appendChild(header);

        category.conversations.forEach(({ uuid }) => {
          const conversationData = JSON.parse(localStorage.getItem(uuid));
          const title = conversationData[3]?.message || "New Conversation";
          const truncatedTitle = title.length > 100 ? title.substring(0, 100) + "..." : title;

          const menuItem = document.createElement("li");
          menuItem.className = "conversation";
          menuItem.dataset.uuid = uuid;
          menuItem.addEventListener("click", () => loadConversation(uuid));

          const titleContainer = document.createElement("div");
          titleContainer.className = "menu-title-container";
          titleContainer.textContent = truncatedTitle;

          const deleteButton = document.createElement("button");
          deleteButton.innerHTML =
            '<span class="material-symbols-outlined" style="background: none;">delete</span>';
          deleteButton.className = "delete-conversation-button";
          deleteButton.onclick = (e) => {
            e.stopPropagation();
            deleteConversation(uuid);
          };

          menuItem.appendChild(titleContainer);
          menuItem.appendChild(deleteButton);
          menu.appendChild(menuItem);
        });
      }
    });
    // const ConversationsMessage = document.createElement("div");
    // ConversationsMessage.className = "conversation-message";
    // ConversationsMessage.innerHTML = `<p>haaaaaaaaaa</p>`;
    // menu.appendChild(ConversationsMessage);

    deleteAllButton.classList.remove("disabled");
    deleteAllButton.addEventListener("click", deleteAllConversations);
  }
}

function checkForConversations() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.includes("-")) {
      return true;
    }
  }
  return false;
}

function deleteConversation(uuid) {
  const conversationElement = document.querySelector(
    `.conversation[data-uuid="${uuid}"]`,
  );

  conversationElement.classList.add("slide-away");

  setTimeout(() => {
    const conversation = JSON.parse(localStorage.getItem(uuid));
    if (conversation) {
      conversation.forEach((entry) => {
        if (entry.images) {
          entry.images.forEach((image) => {
            if (image.deletehash) {
              deleteImageFromImgur(image.deletehash);
            }
          });
        }
      });
    }

    localStorage.removeItem(uuid);
    localStorage.removeItem(`timestamp_${uuid}`);

    updateMenuWithConversations();

    if (currentConversationUUID === uuid) {
      resetConversation();
    }

    if (!checkForConversations() && menuToggleCheckbox.checked) {
      menuToggleCheckbox.click();
    }
  }, 250);
}

function deleteImageFromImgur(deletehash) {
  const xhr = new XMLHttpRequest();
  xhr.open("DELETE", `https://api.imgur.com/3/image/${deletehash}`);
  xhr.setRequestHeader("Authorization", `Client-ID ${imgurClientId}`);
  xhr.onload = function () {
    if (xhr.status === 200) {
      console.log("Image deleted successfully");
    } else {
      console.log("Failed to delete image");
    }
  };
  xhr.send();
  displayNotification("Conversation(s) & Image(s) deleted", "data", 1000);
}

function deleteAllConversations() {
  if (confirm("Are you sure you want to delete all conversations?")) {
    const keysToDelete = [];
    const conversationElements = document.querySelectorAll(".conversation");

    conversationElements.forEach((element) => {
      element.classList.add("slide-away");
      keysToDelete.push(element.dataset.uuid);
    });

    setTimeout(() => {
      keysToDelete.forEach((uuid) => {
        const conversation = JSON.parse(localStorage.getItem(uuid));
        if (conversation) {
          conversation.forEach((entry) => {
            if (entry.images) {
              entry.images.forEach((image) => {
                if (image.deletehash) {
                  deleteImageFromImgur(image.deletehash);
                }
              });
            }
          });
        }
        localStorage.removeItem(uuid);
        localStorage.removeItem(`timestamp_${uuid}`);
      });

      updateMenuWithConversations();
      if (menuToggleCheckbox.checked) {
        menuToggleCheckbox.click();
      }
      if (currentConversationUUID) {
        resetConversation();
      }
    }, 250);
  }
}

function loadConversation(uuid) {
  if (!validateUUID(uuid)) {
    console.error("Invalid UUID:", uuid);
    return;
  }

  currentConversationUUID = uuid;
  document.getElementById("chat-box").innerHTML = "";
  loadHistory();
  window.history.pushState(null, null, `/c/${uuid}`);
  updateMenuWithConversations();

  if (menuToggleCheckbox.checked) {
    menuToggleCheckbox.click();
  }

  updateChatBoxVisibility();
}

conversationElements.forEach((element) => {
  element.addEventListener("click", function () {
    loadConversation(element.dataset.uuid);
  });
});

function updateConnectionStatus(status) {
  const connectionStatusElement = document.getElementById("connection-status");
  if (status === "online") {
    connectionStatusElement.innerHTML = "Status: 🟢 Online";
  } else if (status === "offline") {
    connectionStatusElement.innerHTML = "Status: 🔴 Offline";
  } else {
    connectionStatusElement.innerHTML = "Status: 🔴 Error";
  }
}

function simulateButtonHover() {
  const sendButton = document.getElementById("send-button");
  sendButton.classList.add("hover-effect");
  setTimeout(() => {
    sendButton.classList.remove("hover-effect");
  }, 150);
}

window.onload = function () {
  hljs.configure({ languages: [] });
  const path = window.location.pathname;
  const pathParts = path.split("/");
  inputField.focus();

  if (pathParts.length === 3 && pathParts[1] === "c") {
    const potentialUUID = pathParts[2];
    if (validateUUID(potentialUUID) && localStorage.getItem(potentialUUID)) {
      currentConversationUUID = potentialUUID;
      loadHistory();
    } else {
      window.location.href = "/";
    }
  } else {
    currentConversationUUID = null;
    loadHistory();
  }

  updateCharacterCount();
  updateChatBoxVisibility();
  // setupAnimCanvas();
  update_anim(0);
  updateMenuWithConversations();
  // wrapCodeElements();
};

window.addEventListener("online", function (e) {
  console.log("You are online");
  startWebSocket();
});

window.addEventListener("offline", function (e) {
  console.log("You are offline");
  updateConnectionStatus("offline");
  updatePingDisplay("--");
  stopHeartbeat();
});

function startWebSocket() {
  ws = new WebSocket(`wss://${window.location.host}`);

  ws.onopen = function () {
    console.log("WebSocket Connected");
    updateConnectionStatus("online");
    sendPing();
    reconnectionAttempts = 0;
    sendButton.addEventListener("click", function () {
      if (this.classList.contains("ai-responding") === true) {
        stopAIResponse(currentConversationUUID);
      } else if (this.classList.contains("disabled") === true) {
        // do something
      } else if (!isAIResponding) {
        sendMessage();
      } else {
        displayNotification("Error: Please refresh the page.", "error");
      }
    });
    inputField.addEventListener("keydown", handleEnterKeyPress);
    isAIResponding = false;
    startHeartbeat();
  };

  ws.onmessage = function (event) {
    console.log("WebSocket Message:", event.data);
    try {
      const data = JSON.parse(event.data);

      if (
        data.type === "AI_RESPONSE" &&
        data.uuid === currentConversationUUID
      ) {
        // console.log("UUID:", data.uuid);
        processAIResponse(data.text);
        // wrapCodeElements();
      }

      if (data.type === "pong") {
        const latency = Date.now() - lastPingTimestamp;
        updatePingDisplay(latency);
      }

      if (data.type === "error" && data.uuid === currentConversationUUID) {
        processAIResponse(data.text, true);
      }

      if (data.type === "AI_COMPLETE" && data.uniqueIdentifier === "7777") {
        // console.log("UUID:", data.uuid);
        if (
          latestAIMessageElement &&
          latestAIMessageElement.fullMessage.trim() !== ""
        ) {
          updateHistory(
            "assistant",
            latestAIMessageElement.fullMessage.trim(),
            true,
          );
        }
        wrapCodeElements();
        isAIResponding = false;
        updateSendButtonState();
        return;
      }
    } catch (e) {
      // processAIResponse(event.data);
      // wrapCodeElements();
    }
  };

  ws.onclose = function (event) {
    console.log("WebSocket Disconnected", event);
    updateConnectionStatus("offline");
    attemptReconnect();
  };

  ws.onerror = function (error) {
    console.error("WebSocket Error:", error);
    updateConnectionStatus("error");
  };
}

function attemptReconnect() {
  if (reconnectionAttempts < maxReconnectionAttempts) {
    setTimeout(() => {
      console.log("Attempting to reconnect...");
      startWebSocket();
      reconnectionAttempts++;
    }, 2000);
  } else {
    displayReconnectModal();
  }
}

function displayReconnectModal() {
  const reconnectModal = document.getElementById("reconnect-modal");
  if (!reconnectModal) {
    console.error("Reconnect modal element not found!");
    return;
  }
  reconnectModal.style.display = "block";
  window.onclick = null;
}

function updatePingDisplay(latency) {
  const pingStatusElement = document.getElementById("ping-status");
  pingStatusElement.innerHTML = `Ping: ${latency} ms`;
}

function processAIResponse(message, isError = false) {
  if (!latestAIMessageElement) {
    latestAIMessageElement = document.createElement("div");
    latestAIMessageElement.className = isError
      ? "message ai-error-message"
      : "message ai-message";
    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = "TotoB12";
    chatBox.appendChild(label);
    chatBox.appendChild(latestAIMessageElement);
    latestAIMessageElement.fullMessage = "";
  }

  latestAIMessageElement.fullMessage += message;

  const imageCommandMatch = latestAIMessageElement.fullMessage.match(
    /\{"generateImage": "(.+?)"\}/,
  );

  let displayedMessage = latestAIMessageElement.fullMessage;

  if (imageCommandMatch) {
    displayedMessage = latestAIMessageElement.fullMessage.replace(
      imageCommandMatch[0],
      "",
    );

    if (!displayedMessage.trim()) {
      latestAIMessageElement.parentNode.removeChild(latestAIMessageElement);
    } else {
      latestAIMessageElement.innerHTML = marked.parse(displayedMessage.trim());
    }
    addLoadingIndicator();

    generateAndDisplayImage(imageCommandMatch[1]);
  } else if (displayedMessage.trim() !== "") {
    latestAIMessageElement.innerHTML = marked.parse(displayedMessage.trim());
    wrapCodeElements();
  }

  if (latestAIMessageElement.fullMessage.trim() !== "") {
    updateHistory(
      "assistant",
      latestAIMessageElement.fullMessage.trim(),
      true,
      null,
      isError,
    );
  }

  chatBox.scrollTop = chatBox.scrollHeight;
  updateChatBoxVisibility();
  // wrapCodeElements();
}

function addLoadingIndicator() {
  const bubbleContainer = document.createElement("div");
  bubbleContainer.className = "loading-bubble";

  const loadingIndicator = document.createElement("div");
  loadingIndicator.className = "image-loading";
  loadingIndicator.textContent = "Generating image";
  bubbleContainer.appendChild(loadingIndicator);
  chatBox.appendChild(bubbleContainer);

  let dots = 0;
  const maxDots = 3;
  const updateText = () => {
    dots = (dots + 1) % (maxDots + 1);
    loadingIndicator.textContent = "Generating image" + ".".repeat(dots);
  };
  const intervalId = setInterval(updateText, 500);

  bubbleContainer.dataset.intervalId = intervalId.toString();
}

function removeLoadingIndicator() {
  const bubbleContainer = document.querySelector(".loading-bubble");
  if (bubbleContainer) {
    const intervalId = parseInt(bubbleContainer.dataset.intervalId, 10);
    clearInterval(intervalId);
    bubbleContainer.remove();
  }
}

function generateAndDisplayImage(prompt, image = null) {
  const modelPreference =
    localStorage.getItem("modelPreference") || DEFAULT_MODEL_PREFERENCE;
  const turbo = modelPreference === "Fast";
  fetch("/generate-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt, turbo, image }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data && data.imageData) {
        removeLoadingIndicator();

        const imageBlob = base64ToBlob(data.imageData);
        const tempImageUrl = URL.createObjectURL(imageBlob);
        const imageElement = displayImage(tempImageUrl, true);
        uploadAIGeneratedImageToImgur(imageBlob, imageElement);
      } else {
        throw new Error("Image data not found");
      }
    })
    .catch((error) => {
      console.error("Error generating image:", error);
      const loadingIndicator = document.querySelector(".image-loading");
      if (loadingIndicator) {
        loadingIndicator.textContent = "Failed to load image.";
      }
    });
}

function base64ToBlob(base64, mimeType = "image/jpeg") {
  const byteCharacters = atob(base64);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  const blob = new Blob(byteArrays, { type: mimeType });
  return blob;
}

function uploadAIGeneratedImageToImgur(imageBlob, imageElementToUpdate) {
  const fd = new FormData();
  fd.append("image", imageBlob, "image.jpeg");
  console.log("Before fetch, image element to update:", imageElementToUpdate);

  fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: {
      Authorization: `Client-ID ${imgurClientId}`,
    },
    body: fd,
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        console.log("AI Image uploaded to Imgur:", data.data.link);
        console.log(
          "Before fetch, image element to update:",
          imageElementToUpdate.src,
        );
        updateHistoryWithImage([data.data]);
        // if (imageElementToUpdate) {
        //   imageElementToUpdate.src = data.data.link;
        //   console.log(
        //     "Before fetch, image element to update:",
        //     imageElementToUpdate.src,
        //   );
        // }
        // updateHistoryWithImage(data.data);
      } else {
        throw new Error("Failed to upload image to Imgur");
      }
    })
    .catch((error) => {
      console.error("Error uploading AI-generated image to Imgur:", error);
    });
}

function updateHistoryWithImage(imageInfo) {
  let newImages = Array.isArray(imageInfo) ? imageInfo : [imageInfo];

  let history = getHistory();
  if (history.length > 0) {
    let lastEntry = history[history.length - 1];

    if (!lastEntry.images) {
      lastEntry.images = [];
    }

    lastEntry.images = lastEntry.images.concat(newImages);

    localStorage.setItem(currentConversationUUID, JSON.stringify(history));
  }
}

function stopAIResponse(uuid) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "stop_ai_response", uuid: uuid }));
    isAIResponding = false;
    updateSendButtonState();
    return;
  } else {
    console.error("WebSocket not connected");
    displayNotification("App not connected, please refresh.", "error");
    return;
  }
}

function sendMessage() {
  const userText = inputField.value.trim();

  if (userText.length > 60000) {
    displayNotification(
      "Character limit exceeded. Please shorten your message.",
      "error",
    );
    return;
  }
  if (isAIResponding) {
    displayNotification("AI is processing a response. Please wait.");
    sendButton.classList.add("shake");
    setTimeout(() => sendButton.classList.remove("shake"), 120);
    return;
  }
  if (userText === "") {
    displayNotification("Please enter a message.", "error");
    sendButton.classList.add("shake");
    setTimeout(() => sendButton.classList.remove("shake"), 120);
    return;
  }


  const message = {
    type: "user-message",
    uuid: currentConversationUUID,
    history: getHistory(),
    text: userText,
  };

  updateHistory("user", userText, false);

  createUserMessage({
    role: "user",
    message: userText,
  });

  if (!currentConversationUUID) {
    currentConversationUUID = generateUUID();
    isNewConversation = true;
  }

  if (isNewConversation) {
    updateMenuWithConversations();
    updateChatBoxVisibility();
    isNewConversation = false;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }

  inputField.value = "";
  resetTextarea();
  latestAIMessageElement = null;
  isAIResponding = true;
  updateSendButtonState();
  wrapCodeElements();
  updateMenuWithConversations();
}

function displayImage(imageUrl, blobUrl = false) {
  let smallThumbnailUrl = imageUrl;
  let largeThumbnailUrl = imageUrl;

  if (blobUrl == false) {
    smallThumbnailUrl = smallThumbnailUrl.replace(/(\.[\w\d_-]+)$/i, "t$1");
    largeThumbnailUrl = largeThumbnailUrl.replace(/(\.[\w\d_-]+)$/i, "l$1");
  }

  const imageElement = document.createElement("img");
  imageElement.src = smallThumbnailUrl;
  imageElement.className = "uploaded-image";

  imageElement.onload = () => {
    imageElement.src = largeThumbnailUrl;
  };

  imageElement.addEventListener("click", () => {
    const modal = document.getElementById("image-modal");
    const fullImage = document.getElementById("fullscreen-image");
    fullImage.src = imageUrl;
    modal.classList.add("show-modal");
  });

  chatBox.appendChild(imageElement);
  return imageElement;
}

document.getElementById("image-modal").addEventListener("click", function (e) {
  if (e.target !== this) {
    return;
  }
  this.classList.remove("show-modal");
  inputField.focus();
});

function handleEnterKeyPress(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
    simulateButtonHover();
  }
}

function countLines(textarea) {
  if (!buffer) {
    buffer = document.createElement("textarea");
    buffer.style.border = "none";
    buffer.style.height = "0";
    buffer.style.overflow = "hidden";
    buffer.style.padding = "0";
    buffer.style.position = "absolute";
    buffer.style.left = "0";
    buffer.style.top = "0";
    buffer.style.zIndex = "-1";
    document.body.appendChild(buffer);
  }

  let cs = window.getComputedStyle(textarea);
  let paddingLeft = parseInt(cs.paddingLeft, 10);
  let paddingRight = parseInt(cs.paddingRight, 10);
  let lineHeight = parseInt(cs.lineHeight, 10);

  if (isNaN(lineHeight)) {
    lineHeight = parseInt(cs.fontSize, 10);
  }

  buffer.style.width = textarea.clientWidth - paddingLeft - paddingRight + "px";

  buffer.style.font = cs.font;
  buffer.style.letterSpacing = cs.letterSpacing;
  buffer.style.whiteSpace = cs.whiteSpace;
  buffer.style.wordBreak = cs.wordBreak;
  buffer.style.wordSpacing = cs.wordSpacing;
  buffer.style.wordWrap = cs.wordWrap;

  buffer.value = textarea.value;

  const { scrollHeight } = buffer;
  const tolerance = -7;

  let lineCount = Math.floor((scrollHeight + tolerance) / lineHeight);
  return lineCount <= 0 ? 1 : lineCount;
}

function resizeTextarea() {
  const textarea = document.getElementById("chat-input");
  if (!textarea.classList.contains("expanded")) {
    const numberOfLines = countLines(textarea);
    const lineHeight = 22;
    const maxTextAreaHeight = 184;

    let newHeight;
    if (numberOfLines <= 1) {
      newHeight = lineHeight;
    } else {
      newHeight = numberOfLines * lineHeight;
      if (newHeight > maxTextAreaHeight) {
        newHeight = maxTextAreaHeight;
        textarea.style.overflowY = "auto";
      } else {
        textarea.style.overflowY = "hidden";
      }
    }

    textarea.style.height = newHeight + "px";
  }

  updateCharacterCount();
  toggleExpanderButtonVisibility(textarea);

  if (isCursorOnLastLine(textarea)) {
    scrollToBottomOfTextarea();
  }
}

function isCursorOnLastLine(textarea) {
  const cursorPosition = textarea.selectionStart;
  const textUpToCursor = textarea.value.substring(0, cursorPosition);
  const linesUpToCursor = textUpToCursor.split("\n").length;
  const totalLines = textarea.value.split("\n").length;

  return linesUpToCursor === totalLines;
}

function toggleExpanderButtonVisibility(textarea) {
  const expanderButton = document.getElementById("expander-button");
  if (textarea.classList.contains("expanded")) {
    expanderButton.style.display = "flex";
  } else if (textarea.scrollHeight > textarea.clientHeight) {
    expanderButton.style.display = "flex";
  } else {
    expanderButton.style.display = "none";
  }
}

function toggleTextareaExpansion() {
  const textarea = document.getElementById("chat-input");
  const expanderButton = document.getElementById("expander-button");
  if (textarea.classList.contains("expanded")) {
    textarea.style.height = "184px";
    textarea.classList.remove("expanded");
    expanderButton.textContent = "expand_less";
  } else {
    textarea.style.height = "80vh";
    textarea.classList.add("expanded");
    expanderButton.textContent = "expand_more";
  }
  scrollToBottomOfTextarea();
}

function scrollToBottomOfTextarea() {
  const textarea = document.getElementById("chat-input");
  textarea.scrollTop = textarea.scrollHeight;
}

document.addEventListener("DOMContentLoaded", function () {
  startWebSocket();
  deleteAllButton.addEventListener("click", function () {
    if (this.classList.contains("disabled") === true) {
      this.classList.add("shake");
      setTimeout(() => this.classList.remove("shake"), 120);
    }
  });

  expanderButton.addEventListener("click", toggleTextareaExpansion);

  menuToggleCheckbox.addEventListener("change", function () {
    if (menuToggleCheckbox.checked) {
      menu.style.boxShadow = "0px 0px 10px 0px black";
    } else {
      menu.style.boxShadow = "none";
    }
  });

  inputField.addEventListener("input", resizeTextarea);
  inputField.addEventListener("input", updateCharacterCount);

  newChatButton.addEventListener("click", function () {
    resetConversation();

    if (menuToggleCheckbox.checked) {
      menuToggleCheckbox.click();
    }
  });

  let mouseMoveTimeout;

  anim_canvas.addEventListener("mousemove", (e) => {
    clearTimeout(mouseMoveTimeout);
    mouseMoveTimeout = setTimeout(() => {
      useSimulatedMouse = true;
    }, 2000);
    useSimulatedMouse = false;
    userMouseX = e.offsetX;
    userMouseY = e.offsetY;
  });

  anim_canvas.addEventListener("mouseleave", () => {
    clearTimeout(mouseMoveTimeout);
    useSimulatedMouse = true;
  });

  const modelPreference =
    localStorage.getItem("modelPreference") || DEFAULT_MODEL_PREFERENCE;
  localStorage.setItem("modelPreference", modelPreference);
  const modelToggle = document.getElementById("modelToggle");
  modelToggle.checked = modelPreference === "Best";

  modelToggle.addEventListener("change", function () {
    const modelPreference = modelToggle.checked ? "Best" : "Fast";
    localStorage.setItem("modelPreference", modelPreference);
  });

  settingsButton.onclick = function () {
    settingsModal.style.display = "block";
  };

  settingsCloseButton.onclick = function () {
    settingsModal.style.display = "none";
  };

  window.onclick = function (event) {
    if (event.target == settingsModal) {
      settingsModal.style.display = "none";
      event.stopPropagation();
    } else if (
      !menu.contains(event.target) &&
      event.target != menuToggleCheckbox &&
      menuToggleCheckbox.checked
    ) {
      menuToggleCheckbox.checked = false;
      menuToggleCheckbox.dispatchEvent(new Event("change"));
      inputField.focus();
    }
  };

  document
    .querySelector(".modal-content")
    .addEventListener("click", function (event) {
      event.stopPropagation();
    });
});

function throttle(func, limit) {
  let inThrottle;
  return function () {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

window.onresize = throttle(function () {
  resizeTextarea();
  anim_canvas.width = window.innerWidth - 4;
  anim_canvas.height = window.innerHeight - 4;
}, 100);

function resetTextarea() {
  const textarea = document.getElementById("chat-input");
  textarea.classList.remove("expanded");
  textarea.style.height = "";
  textarea.style.overflowY = "hidden";
}

function resetConversation() {
  document.getElementById("chat-box").innerHTML = "";
  currentConversationUUID = null;
  latestAIMessageElement = null;

  window.history.pushState(null, null, "/");
  updateMenuWithConversations();
  updateChatBoxVisibility();
  isAIResponding = false;
  updateSendButtonState();
  inputField.focus();
}

function upload(file) {
  if (!file || !file.type.match(/image.*/)) {
    displayNotification(
      "Invalid file format. Please select an image.",
      "error",
    );
    uploadButton.classList.add("shake");
    setTimeout(() => uploadButton.classList.remove("shake"), 120);
    resetUploadButton();
    return;
  }

  // file size <= 3MB
  if (file.size > 3 * 1024 * 1024) {
    displayNotification(
      "File size exceeds 3MB. Please select a smaller image.",
      "error",
    );
    uploadButton.classList.add("shake");
    setTimeout(() => uploadButton.classList.remove("shake"), 120);
    resetUploadButton();
    return;
  }

  if (currentUploadXHR && currentUploadXHR.readyState !== XMLHttpRequest.DONE) {
    currentUploadXHR.abort();
  }

  displayNotification("Uploading...", "data");

  let fd = new FormData();
  fd.append("image", file);
  currentUploadXHR = new XMLHttpRequest();
  currentUploadXHR.open("POST", "https://api.imgur.com/3/image.json");

  currentUploadXHR.onload = function () {
    try {
      let response = JSON.parse(currentUploadXHR.responseText);
      if (response.success) {
        document.querySelector(".loading-indicator").style.display = "none";
        document.getElementById("image-preview").classList.remove("dimmed");
        uploadedImageUrl = response.data.link;
        uploadedImage = response.data;
        updateCharacterCount();
        displayNotification("Upload successful.", "info");
        console.log(response.data);
        const smallThumbnailUrl = uploadedImageUrl.replace(
          /(\.[\w\d_-]+)$/i,
          "s$1",
        );
        updateUploadButtonWithImage(smallThumbnailUrl);
      } else {
        displayNotification("Upload failed. " + response.data.error, "error");
        console.log(response.data.error);
        resetUploadButton();
      }
    } catch (e) {
      displayNotification("An error occurred during upload.", "error");
      console.log(e);
      resetUploadButton();
    }
    currentUploadXHR = null;
  };

  currentUploadXHR.onerror = function () {
    displayNotification("An error occurred during upload.", "error");
    console.log(currentUploadXHR.statusText);
    resetUploadButton();
    currentUploadXHR = null;
  };

  currentUploadXHR.onabort = function () {
    displayNotification("Upload canceled.", "info");
    resetUploadButton();
    currentUploadXHR = null;
  };

  currentUploadXHR.setRequestHeader(
    "Authorization",
    "Client-ID 6a8a51f3d7933e1",
  );
  currentUploadXHR.send(fd);
}

function displayNotification(message, type, duration = 2000) {
  const notificationArea = document.getElementById("notification-area");
  notificationArea.innerHTML = "";

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";

  const color =
    type === "error" ? "red" : type === "info" ? "#00d26a" : main_color;

  icon.style.color = color;
  icon.textContent = type === "error" ? "error" : "info";

  const text = document.createElement("span");
  text.textContent = message;
  text.style.color = color;

  notificationArea.appendChild(icon);
  notificationArea.appendChild(text);

  notificationArea.classList.add("show");

  setTimeout(() => {
    notificationArea.classList.remove("show");
  }, duration);
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function highlight(e) {
  dropZone.classList.add("highlight");
}

function unhighlight(e) {
  dropZone.classList.remove("highlight");
}

function fetchImageFromUrl(url) {
  const corsProxy = "https://cors-anywhere.herokuapp.com/";
  const proxiedUrl = corsProxy + url;

  return new Promise((resolve, reject) => {
    fetch(proxiedUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => {
        let file = new File([blob], "image.jpg", { type: "image/jpeg" });
        resolve(file);
      })
      .catch((e) => {
        console.error("Error fetching image from URL:", e);
        reject(e);
      });
  });
}

for (let i = 0; i < anim_params.pointsNumber; i++) {
  anim_trail[i] = {
    x: anim_canvas.width / 2,
    y: anim_canvas.height / 2,
    dx: 0,
    dy: 0,
  };
}

function update_anim(t) {
  let mouseX, mouseY;
  if (useSimulatedMouse) {
    const radius = 125;
    const angle = t * 0.002;
    const centerX = anim_canvas.width / 2;
    const centerY = anim_canvas.height / 2;
    mouseX = centerX + radius * Math.sin(angle);
    mouseY = centerY + radius * Math.cos(angle) * Math.sin(angle);
  } else {
    mouseX = userMouseX;
    mouseY = userMouseY;
  }

  ctx.clearRect(0, 0, anim_canvas.width, anim_canvas.height);
  anim_trail.forEach((p, pIdx) => {
    const prev = pIdx === 0 ? { x: mouseX, y: mouseY } : anim_trail[pIdx - 1];
    const spring = pIdx === 0 ? 0.4 * anim_params.spring : anim_params.spring;
    p.dx += (prev.x - p.x) * spring;
    p.dy += (prev.y - p.y) * spring;
    p.dx *= anim_params.friction;
    p.dy *= anim_params.friction;
    p.x += p.dx;
    p.y += p.dy;
  });

  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(anim_trail[0].x, anim_trail[0].y);

  for (let i = 1; i < anim_trail.length - 1; i++) {
    const xc = 0.5 * (anim_trail[i].x + anim_trail[i + 1].x);
    const yc = 0.5 * (anim_trail[i].y + anim_trail[i + 1].y);
    ctx.quadraticCurveTo(anim_trail[i].x, anim_trail[i].y, xc, yc);
    ctx.lineWidth = anim_params.widthFactor * (anim_params.pointsNumber - i);
    ctx.stroke();
  }
  ctx.lineTo(
    anim_trail[anim_trail.length - 1].x,
    anim_trail[anim_trail.length - 1].y,
  );
  ctx.stroke();

  window.requestAnimationFrame(update_anim);
  ctx.strokeStyle = "#FFFFFF";
}

// let trianglePoints = [
//     { x: anim_canvas.width / 2, y: anim_canvas.height / 4 },
//     { x: anim_canvas.width / 4, y: 3 * anim_canvas.height / 4 },
//     { x: 3 * anim_canvas.width / 4, y: 3 * anim_canvas.height / 4 },
// ];
// let currentPointIndex = 0;

// function update_anim(t) {
//     let target = trianglePoints[currentPointIndex];
//     if (useSimulatedMouse) {
//         let dx = target.x - userMouseX;
//         let dy = target.y - userMouseY;
//         userMouseX += dx * 0.05;
//         userMouseY += dy * 0.05;

//         if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
//             currentPointIndex = (currentPointIndex + 1) % trianglePoints.length;
//         }
//     } else {
//         userMouseX = e.offsetX;
//         userMouseY = e.offsetY;
//     }

//     ctx.clearRect(0, 0, anim_canvas.width, anim_canvas.height);
//     anim_trail.forEach((p, pIdx) => {
//         const prev = pIdx === 0 ? { x: userMouseX, y: userMouseY } : anim_trail[pIdx - 1];
//         const spring = pIdx === 0 ? 0.4 * anim_params.spring : anim_params.spring;
//         p.dx += (prev.x - p.x) * spring;
//         p.dy += (prev.y - p.y) * spring;
//         p.dx *= anim_params.friction;
//         p.dy *= anim_params.friction;
//         p.x += p.dx;
//         p.y += p.dy;
//     });

//     ctx.lineCap = "round";
//     ctx.beginPath();
//     ctx.moveTo(anim_trail[0].x, anim_trail[0].y);

//     for (let i = 1; i < anim_trail.length - 1; i++) {
//         const xc = 0.5 * (anim_trail[i].x + anim_trail[i + 1].x);
//         const yc = 0.5 * (anim_trail[i].y + anim_trail[i + 1].y);
//         ctx.quadraticCurveTo(anim_trail[i].x, anim_trail[i].y, xc, yc);
//         ctx.lineWidth = anim_params.widthFactor * (anim_params.pointsNumber - i);
//         ctx.stroke();
//     }
//     ctx.lineTo(
//         anim_trail[anim_trail.length - 1].x,
//         anim_trail[anim_trail.length - 1].y,
//     );
//     ctx.stroke();

//     window.requestAnimationFrame(update_anim);
//     ctx.strokeStyle = "#FFFFFF";
// }

function wrapCodeElements() {
  // console.log('haaaaaaaaa');
  hljs.highlightAll();
  const codeElements = document.querySelectorAll("code");
  codeElements.forEach((codeElement) => {
    if (
      !codeElement.className.includes("language-") ||
      codeElement.closest(".code-wrapper")
    ) {
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "code-wrapper";

    const languageMatch = codeElement.className.match(/language-(\w+)/);
    let language = languageMatch ? languageMatch[1] : "language unknown";
    if (language === "undefined") {
      language = "unknown";
    }

    const languageBar = document.createElement("div");
    languageBar.className = "language-bar";

    const languageText = document.createElement("span");
    languageText.textContent = language;
    languageBar.appendChild(languageText);

    const copyButton = document.createElement("span");
    copyButton.className = "copy-button";
    copyButton.onclick = () => {
      navigator.clipboard.writeText(codeElement.textContent);
      copyIcon.textContent = "check";
      copyText.textContent = "Copied!";

      setTimeout(() => {
        copyIcon.textContent = "content_copy";
        copyText.textContent = "Copy";
      }, 2000);
    };

    const copyIcon = document.createElement("span");
    copyIcon.className = "material-symbols-outlined";
    copyIcon.textContent = "content_copy";

    const copyText = document.createElement("span");
    copyText.textContent = "Copy";

    copyButton.appendChild(copyIcon);
    copyButton.appendChild(copyText);

    languageBar.appendChild(copyButton);
    wrapper.appendChild(languageBar);
    codeElement.parentNode.insertBefore(wrapper, codeElement);
    wrapper.appendChild(codeElement);
  });
}
