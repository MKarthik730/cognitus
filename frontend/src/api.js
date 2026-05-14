let ws = null;
let onEventCallback = null;

const WS_BASE = `ws://${window.location.hostname}:5173/ws`;
const API_BASE = '/api';

export function onEvent(cb) {
  onEventCallback = cb;
}

export function connect(situation, sessionId, userId) {
  disconnect();

  ws = new WebSocket(`${WS_BASE}/${sessionId}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ situation, user_id: userId }));
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
    if (onEventCallback) onEventCallback({ type: 'error', message: 'WebSocket connection failed' });
  };

  ws.onclose = () => {
    ws = null;
  };
}

export function connectCaseStudy(data, sessionId) {
  disconnect();
  ws = new WebSocket(`${WS_BASE}/${sessionId}`);
  ws.onopen = () => {
    ws.send(JSON.stringify(data));
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
    if (onEventCallback) onEventCallback({ type: 'error', message: 'WebSocket connection failed' });
  };
  ws.onclose = () => {
    ws = null;
  };
}

export function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
  }
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
