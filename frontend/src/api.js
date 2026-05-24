let ws = null;
let onEventCallback = null;
let onConnectionChangeCallback = null;

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
let reconnectTimer = null;
let isReconnecting = false;
let isIntentionalClose = false;

// Pending request data for reconnection replay
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
  // Exponential backoff with jitter
  const delay = Math.min(
    INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY
  );
  // Add ±25% jitter
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
    setConnectionStatus(CONNECTION_STATES.DISCONNECTED);
    if (onEventCallback) {
      onEventCallback({
        type: 'connection_error',
        message: `Connection lost after ${MAX_RECONNECT_ATTEMPTS} reconnection attempts. Please try again.`,
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

    if (onConnectionChangeCallback) {
      onConnectionChangeCallback({
        status: CONNECTION_STATES.RECONNECTING,
        reconnectAttempts: reconnectAttempts + 1,
        reconnecting: true,
      });
    }

    // Reconnect using the pending request data
    if (pendingRequest) {
      createWebSocket(pendingRequest);
    }
  }, delay);
}

function createWebSocket(requestData) {
  if (ws) {
    try { ws.close(); } catch (e) { /* ignore */ }
    ws = null;
  }

  const sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  setConnectionStatus(CONNECTION_STATES.CONNECTING);

  ws = new WebSocket(`${WS_BASE}/${sessionId}`);

  // Don't reset reconnectAttempts here — it's reset in connect()/connectCaseStudy().
  // Resetting here would prevent exponential backoff from growing across reconnect cycles.
  ws.onopen = () => {
    setConnectionStatus(CONNECTION_STATES.CONNECTED);
    isReconnecting = false;

    if (onConnectionChangeCallback) {
      onConnectionChangeCallback({
        status: CONNECTION_STATES.CONNECTED,
        reconnectAttempts,
        reconnecting: false,
        recovered: reconnectAttempts > 0,
      });
    }

    // Send the pending request
    ws.send(JSON.stringify(requestData));
  };

  ws.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data);
      if (onEventCallback) onEventCallback(event);
    } catch (e) {
      console.error('Failed to parse WS message:', e);
    }
  };

  ws.onerror = () => {
    console.warn('WebSocket error');
    if (!isIntentionalClose && !isReconnecting) {
      if (onEventCallback) {
        onEventCallback({ type: 'error', message: 'WebSocket connection failed' });
      }
    }
  };

  ws.onclose = () => {
    ws = null;

    if (!isIntentionalClose && pendingRequest) {
      // Unintentional close — try to reconnect
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

export function connect(situation, sessionId, userId) {
  isIntentionalClose = false;
  pendingRequest = { situation, user_id: userId };
  reconnectAttempts = 0;
  createWebSocket(pendingRequest);
}

export function connectCaseStudy(data, sessionId) {
  isIntentionalClose = false;
  pendingRequest = data;
  reconnectAttempts = 0;
  createWebSocket(pendingRequest);
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
