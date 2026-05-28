/**
 * Chat Panel — post-analysis canvas chat.
 *
 * Slides up from bottom after analysis completes.
 * Routes questions to the most relevant expert node.
 * Streaming responses render token by token.
 * Ghost Mode: chat history never stored.
 */

import { getState, setState } from './store.js';

let chatInputEl = null;
let chatMessagesEl = null;
let chatPanelEl = null;

const NODE_COLORS = {
  distributor: '#6c8cff',
  cross_check: '#fbbf24',
  synthesizer: '#34d399',
  default: '#a0a3b1',
};

export function initChat() {
  chatPanelEl = document.getElementById('chat-panel');
  chatMessagesEl = document.getElementById('chat-messages');
  chatInputEl = document.getElementById('chat-input');

  if (!chatPanelEl || !chatMessagesEl || !chatInputEl) {
    console.warn('Chat panel elements not found');
    return;
  }

  // Send message on Enter
  chatInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // Send button
  document.getElementById('chat-send')?.addEventListener('click', sendChatMessage);

  // Close button
  document.getElementById('chat-close')?.addEventListener('click', hideChat);

  // Listen for state changes to show/hide chat
  subscribeToState();
}

function subscribeToState() {
  // We'll use a simple polling approach via the app's render cycle
  // The chat panel visibility is controlled by the analysis completion status
}

export function showChat() {
  if (!chatPanelEl) return;
  chatPanelEl.classList.add('visible');
  chatPanelEl.classList.remove('hidden');
  if (chatInputEl) {
    chatInputEl.focus();
  }
}

export function hideChat() {
  if (!chatPanelEl) return;
  chatPanelEl.classList.remove('visible');
  chatPanelEl.classList.add('hidden');
}

export function toggleChat() {
  if (chatPanelEl?.classList.contains('visible')) {
    hideChat();
  } else {
    showChat();
  }
}

export function addChatMessage(node, text, isUser = false) {
  if (!chatMessagesEl) return;

  const msg = document.createElement('div');
  msg.className = `chat-message ${isUser ? 'chat-message-user' : 'chat-message-node'}`;

  if (!isUser) {
    const color = NODE_COLORS[node] || NODE_COLORS.default;
    const badge = document.createElement('div');
    badge.className = 'chat-node-badge';
    badge.style.color = color;
    badge.style.borderColor = color;
    badge.textContent = node.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    msg.appendChild(badge);
  }

  const content = document.createElement('div');
  content.className = 'chat-message-content';
  content.textContent = text;
  msg.appendChild(content);

  chatMessagesEl.appendChild(msg);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

export function addStreamingMessage(node, initialText = '') {
  if (!chatMessagesEl) return;

  const msg = document.createElement('div');
  msg.className = 'chat-message chat-message-node streaming';

  const color = NODE_COLORS[node] || NODE_COLORS.default;
  const badge = document.createElement('div');
  badge.className = 'chat-node-badge';
  badge.style.color = color;
  badge.style.borderColor = color;
  badge.textContent = node.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  msg.appendChild(badge);

  const content = document.createElement('div');
  content.className = 'chat-message-content';
  content.textContent = initialText;
  msg.appendChild(content);

  chatMessagesEl.appendChild(msg);
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

  return {
    element: msg,
    contentEl: content,
    appendText: (text) => {
      content.textContent += text;
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    },
    finish: () => {
      msg.classList.remove('streaming');
      content.textContent = content.textContent;
    },
  };
}

function sendChatMessage() {
  const text = chatInputEl?.value.trim();
  if (!text) return;

  chatInputEl.value = '';

  // Add user message to chat
  addChatMessage('user', text, true);

  // Check if WebSocket is connected before dispatching
  const connStatus = getState().connectionStatus;
  if (connStatus !== 'connected') {
    addChatMessage('system', '\u26A0\uFE0F WebSocket not connected. Please wait for reconnection or retry.', false);
    return;
  }

  // Dispatch event for the WebSocket handler
  const event = new CustomEvent('chat-message', {
    detail: { text, sessionId: getState().sessionId },
  });
  document.dispatchEvent(event);
}

/**
 * Handle an incoming chat event from WebSocket.
 */
export function handleChatEvent(event) {
  switch (event.type) {
    case 'chat_routing':
      // Backend determined which node should respond
      addChatMessage('system', `Routing to ${event.node}...`, false);
      break;

    case 'chat_token':
      // Streaming token from the responding node
      // This requires maintaining a reference to the current stream
      break;

    case 'chat_complete':
      // Response complete
      break;
  }
}

export function clearChat() {
  if (chatMessagesEl) {
    chatMessagesEl.innerHTML = '';
  }
}

export function getNodeColor(nodeName) {
  return NODE_COLORS[nodeName] || NODE_COLORS.default;
}
