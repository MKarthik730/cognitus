import { create } from 'zustand';

const TOKEN_KEY = 'token';

interface AuthState {
  token: string | null;
  isAuthOpen: boolean;
  isSubmitting: boolean;
  error: string | null;

  setAuthOpen: (open: boolean) => void;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, email: string, password: string) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
  initAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  isAuthOpen: false,
  isSubmitting: false,
  error: null,

  setAuthOpen: (open) => set({ isAuthOpen: open, error: null }),

  login: async (username, password) => {
    set({ isSubmitting: true, error: null });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem(TOKEN_KEY, data.access_token);
        set({ token: data.access_token, isSubmitting: false, isAuthOpen: false, error: null });
        return true;
      } else {
        set({ isSubmitting: false, error: data.detail || 'Login failed' });
        return false;
      }
    } catch (e) {
      set({ isSubmitting: false, error: 'Network error. Is the server running?' });
      return false;
    }
  },

  register: async (username, email, password) => {
    set({ isSubmitting: true, error: null });
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem(TOKEN_KEY, data.access_token);
        set({ token: data.access_token, isSubmitting: false, isAuthOpen: false, error: null });
        return true;
      } else {
        set({ isSubmitting: false, error: data.detail || 'Registration failed' });
        return false;
      }
    } catch (e) {
      set({ isSubmitting: false, error: 'Network error. Is the server running?' });
      return false;
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null });
  },

  clearError: () => set({ error: null }),

  initAuth: () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      set({ token });
    } else {
      // Show auth modal when no token is found
      set({ isAuthOpen: true });
    }
  },
}));
