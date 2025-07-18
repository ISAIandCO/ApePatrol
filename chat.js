//    Copyright 2024 Anton Kutepov, Konstantin Grishchenko, Security Experts Community
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

const chatToggle = document.getElementById('chat-toggle');
const chatWidget = document.getElementById("chat-widget");
const chatContainer = document.getElementById("chat-container");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendButton = document.getElementById("chat-send");

chatWidget.classList.toggle('visible', true);

chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        const userInput = chatInput.value.trim();
        if (userInput) {
            addChatMessage("You", userInput);
            sendChatMessage(userInput);
            chatInput.value = "";
        }
    }
});

chatSendButton.addEventListener("click", () => {
    const userInput = chatInput.value.trim();
    if (userInput) {
        addChatMessage("You", userInput);
        sendChatMessage(userInput);
        chatInput.value = "";
    }
});

function addChatMessage(sender, message) {
    const messageContainer = document.createElement("div");
    messageContainer.classList.add("chat-message-container");
    const messageHeader = document.createElement("div");
    messageHeader.classList.add("chat-message-header");
    messageHeader.textContent = sender + ":";
    const messageBody = document.createElement("div");
    messageBody.classList.add("chat-message-body");

    // Иногда в ответе LLM есть, куски, обрамленные двойными звёздочками, выделим их жирным (стиль настраивается с chat.css)
    const parts = message.split(/\*\*(.*?)\*\*/);
    parts.forEach((part, index) => {
        if (index % 2 === 1) {
            const boldPart = document.createElement("span");
            boldPart.classList.add("bold-text");
            boldPart.textContent = part;
            messageBody.appendChild(boldPart);
        } else {
            messageBody.innerHTML += part;
        }
    });

    messageContainer.appendChild(messageHeader);
    messageContainer.appendChild(messageBody);
    chatMessages.appendChild(messageContainer);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeEmptyFields(obj) {
    Object.keys(obj).forEach(key => {
        if (obj[key] === null || obj[key] === undefined || obj[key] === '') {
            delete obj[key];
        } else if (typeof obj[key] === 'object') {
            removeEmptyFields(obj[key]);
        }
    });
    return obj;
}

function sendChatMessage(message) {
  const loadingElement = document.getElementById("loading");
  loadingElement.style.display = "block";

  let event_data = decodeURIComponent(atob($("#saved_event_data").text()));
  let cleaned_event = JSON.stringify(removeEmptyFields(JSON.parse(event_data)))

  fetch(LLM_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify({
        messages: [ 
            { "role": "system", "content": "You are a highly skilled and experienced cybersecurity assistant. Your answers are very precise and well-researched. After generating answer on my questions you must translate them into formal Russian language. Return only translated version of your answer without English source." },
            { "role": "user", "content": `This is JSON with event log data:${cleaned_event}.\n${message}` }
        ],
      model: LLM_API_MODEL_NAME,
      temperature: 0.2,
      stop: "###"
    }),
  })
    .then((response) => response.json())
    .then((data) => {
      const chatbotResponse = data.choices[0].message.content.trim();
      addChatMessage("SEC AI Assistant", chatbotResponse);
      loadingElement.style.display = "none";
    })
    .catch((error) => {
      addChatMessage("[SYSTEM]", error);
      addChatMessage("SEC AI Assistant", "Sorry, I was unable to process your request.");
      loadingElement.style.display = "none";
    });
}

options = getStorageData('options');
console.log(options);
options.then((data) => {
    console.log(data);
    LLM_API_ENDPOINT = data.options['llm_api_endpoint'];
    LLM_API_KEY = data.options['llm_api_key'];
    LLM_API_MODEL_NAME = data.options['llm_api_model_name'];
});