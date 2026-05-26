let ws = null;
let onEventCallback = null;
let onConnectionChangeCallback = null;

let currentSessionId = null;
let lastEventId = 0;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;
let reconnectTimer = null;
let isReconnecting = false;
let isIntentionalClose = false;
let pendingRequest = null;

const WS_BASE = `ws://${window.location.hostname}:5173/ws`;
const API_BASE = '/api';

// Connection states
export const CONNECTION_STATES = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  RECONNECTING: 'reconnecting',
};

let connectionStatus = CONNECTION_STATES.DISCONNECTED;

function setConnectionStatus(status) {
  connectionStatus = status;
  if (onConnectionChangeCallback) {
    onConnectionChangeCallback({ status, reconnectAttempts });
  }
}

export function onEvent(cb) {
  onEventCallback = cb;
}

export function onConnectionChange(cb) {
  onConnectionChangeCallback = cb;
}

export function getConnectionStatus() {
  return { status: connectionStatus, reconnectAttempts };
}

function getReconnectDelay() {
  const delay = Math.min(
    INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY
  );
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

function scheduleReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.warn(`WebSocket: max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
    isReconnecting = false;
    setConnectionStatus(CONNECTION_STATES.DISCONNECTED);
    if (onEventCallback) {
      onEventCallback({
        type: 'connection_lost',
        message: `Connection lost after ${MAX_RECONNECT_ATTEMPTS} attempts. Click Retry to reconnect.`,
      });
    }
    return;
  }

  isReconnecting = true;
  setConnectionStatus(CONNECTION_STATES.RECONNECTING);

  const delay = getReconnectDelay();
  console.log(`WebSocket: reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createWebSocket();
  }, delay);
}

function createWebSocket() {
  if (ws) {
    try { ws.close(); } catch (e) { /* ignore */ }
    ws = null;
  }

  // Generate a fresh URL session_id — the ORIGINAL session_id is stored
  // in currentSessionId and sent in the resume message for event replay.
  const urlSessionId = 'ws-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  setConnectionStatus(CONNECTION_STATES.CONNECTING);

  ws = new WebSocket(`${WS_BASE}/${urlSessionId}`);

  ws.onopen = () => {
    setConnectionStatus(CONNECTION_STATES.CONNECTED);
    isReconnecting = false;

    if (onConnectionChangeCallback) {
      onConnectionChangeCallback({
        status: CONNECTION_STATES.CONNECTED,
        reconnectAttempts,
        recovered: reconnectAttempts > 0,
      });
    }

    if (reconnectAttempts > 0 && currentSessionId) {
      // Reconnection — send resume to replay missed events
      ws.send(JSON.stringify({
        type: 'resume',
        session_id: currentSessionId,
        last_event_id: lastEventId,
      }));
    } else if (pendingRequest) {
      // Fresh connection — send the analysis request
      ws.send(JSON.stringify(pendingRequest));
    }
  };

  ws.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data);
      // Track last event_id for reconnection resume
      if (event.event_id && event.event_id > lastEventId) {
        lastEventId = event.event_id;
      }
      if (onEventCallback) onEventCallback(event);
    } catch (e) {
      console.error('Failed to parse WS message:', e);
    }
  };

  ws.onerror = () => {
    if (!isIntentionalClose && !isReconnecting) {
      if (onEventCallback) {
        onEventCallback({ type: 'error', message: 'WebSocket connection failed' });
      }
    }
  };

  ws.onclose = () => {
    ws = null;
    if (!isIntentionalClose && pendingRequest) {
      reconnectAttempts++;
      scheduleReconnect();
    } else {
      setConnectionStatus(CONNECTION_STATES.DISCONNECTED);
      if (onConnectionChangeCallback) {
        onConnectionChangeCallback({
          status: CONNECTION_STATES.DISCONNECTED,
          reconnectAttempts: 0,
        });
      }
    }
  };
}

/**
 * Retry connection after max reconnect attempts have been exhausted.
 * Resets the attempt counter and tries a fresh connection.
 */
export function retryConnection() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // Set to 1 so the websocket sends a resume message (not a fresh request)
  reconnectAttempts = 1;
  isReconnecting = false;
  setConnectionStatus(CONNECTION_STATES.CONNECTING);
  if (pendingRequest) {
    createWebSocket();
  }
}

export function connect(situation, sessionId, userId) {
  isIntentionalClose = false;
  pendingRequest = { situation, user_id: userId };
  currentSessionId = sessionId;
  lastEventId = 0;
  reconnectAttempts = 0;
  createWebSocket();
}

export function connectCaseStudy(data, sessionId) {
  isIntentionalClose = false;
  pendingRequest = data;
  currentSessionId = sessionId || ('case-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  lastEventId = 0;
  reconnectAttempts = 0;
  createWebSocket();
}

export function disconnect() {
  isIntentionalClose = true;
  pendingRequest = null;
  reconnectAttempts = 0;
  isReconnecting = false;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }

  setConnectionStatus(CONNECTION_STATES.DISCONNECTED);
}

export async function createSession(title, situation) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_BASE}/sessions/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ title, situation }),
  });
  if (!res.ok) throw new Error(`Session creation failed: ${res.status}`);
  return res.json();
}

export async function login(username, password) {
  const form = new URLSearchParams();
  form.set('username', username);
  form.set('password', password);
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) throw new Error('Login failed');
  const data = await res.json();
  localStorage.setItem('token', data.access_token);
  return data;
}

export async function register(username, password) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('Registration failed');
  return res.json();
}
