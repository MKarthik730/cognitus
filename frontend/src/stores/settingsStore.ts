import { create } from 'zustand';

interface SettingsState {
  isSettingsOpen: boolean;
  llmMode: string;

  // Live research (real-time data)
  researchEnabled: boolean;
  researchCategories: string[];
  customUrls: string[];

  setSettingsOpen: (open: boolean) => void;
  setLlmMode: (mode: string) => void;
  setResearchEnabled: (enabled: boolean) => void;
  toggleResearchCategory: (category: string) => void;
  addCustomUrl: (url: string) => void;
  removeCustomUrl: (url: string) => void;
  loadSettings: () => void;
}

const STORAGE_KEY = 'council_settings';

function persist(partial: Record<string, unknown>) {
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, ...partial }));
  } catch {}
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  isSettingsOpen: false,
  llmMode: 'local',
  researchEnabled: false,
  researchCategories: [],
  customUrls: [],

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),

  setLlmMode: (mode) => {
    set({ llmMode: mode });
    persist({ llmMode: mode });
  },

  setResearchEnabled: (enabled) => {
    set({ researchEnabled: enabled });
    persist({ researchEnabled: enabled });
  },

  toggleResearchCategory: (category) => {
    const current = get().researchCategories;
    const next = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    set({ researchCategories: next });
    persist({ researchCategories: next });
  },

  addCustomUrl: (url) => {
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) return;
    const current = get().customUrls;
    if (current.includes(trimmed) || current.length >= 5) return;
    const next = [...current, trimmed];
    set({ customUrls: next });
    persist({ customUrls: next });
  },

  removeCustomUrl: (url) => {
    const next = get().customUrls.filter((u) => u !== url);
    set({ customUrls: next });
    persist({ customUrls: next });
  },

  loadSettings: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        set({
          llmMode: 'local',
          researchEnabled: saved.researchEnabled ?? false,
          researchCategories: saved.researchCategories ?? [],
          customUrls: saved.customUrls ?? [],
        });
      }
    } catch {}
  },
}));
