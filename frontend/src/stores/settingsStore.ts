import { create } from 'zustand';

interface SettingsState {
  isSettingsOpen: boolean;
  groqApiKey: string;
  llmMode: string;

  setSettingsOpen: (open: boolean) => void;
  setGroqApiKey: (key: string) => void;
  setLlmMode: (mode: string) => void;
  loadSettings: () => void;
}

const STORAGE_KEY = 'council_settings';

export const useSettingsStore = create<SettingsState>((set) => ({
  isSettingsOpen: false,
  groqApiKey: '',
  llmMode: 'free',

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),

  setGroqApiKey: (key) => {
    set({ groqApiKey: key });
    try {
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      existing.groqApiKey = key;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch {}
  },

  setLlmMode: (mode) => {
    set({ llmMode: mode });
    try {
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      existing.llmMode = mode;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch {}
  },

  loadSettings: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        set({
          groqApiKey: saved.groqApiKey || '',
          llmMode: saved.llmMode || 'free',
        });
      }
    } catch {}
  },
}));
