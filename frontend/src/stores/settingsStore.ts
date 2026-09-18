import { create } from 'zustand';

interface SettingsState {
  isSettingsOpen: boolean;
  llmMode: string;

  // LLM endpoint — one URL field covers local llama.cpp, a tunneled/cloud
  // host (e.g. ngrok/cloudflared fronting a Kaggle-hosted model), or any
  // other OpenAI-compatible server. Blank = use the backend's local default.
  llmBaseUrl: string;
  llmApiKey: string;
  llmModelName: string;

  // Live research (real-time data)
  researchEnabled: boolean;
  researchCategories: string[];
  customUrls: string[];

  // Verdict — overrides the server's GITHUB_TOKEN for this browser only.
  // Blank = use the server's configured token.
  githubToken: string;

  setSettingsOpen: (open: boolean) => void;
  setLlmMode: (mode: string) => void;
  setLlmBaseUrl: (url: string) => void;
  setLlmApiKey: (key: string) => void;
  setLlmModelName: (name: string) => void;
  setGithubToken: (token: string) => void;
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
  llmBaseUrl: '',
  llmApiKey: '',
  llmModelName: '',
  researchEnabled: false,
  researchCategories: [],
  customUrls: [],
  githubToken: '',

  setSettingsOpen: (open) => set({ isSettingsOpen: open }),

  setLlmMode: (mode) => {
    set({ llmMode: mode });
    persist({ llmMode: mode });
  },

  setLlmBaseUrl: (url) => {
    set({ llmBaseUrl: url });
    persist({ llmBaseUrl: url });
  },

  setLlmApiKey: (key) => {
    set({ llmApiKey: key });
    persist({ llmApiKey: key });
  },

  setLlmModelName: (name) => {
    set({ llmModelName: name });
    persist({ llmModelName: name });
  },

  setGithubToken: (token) => {
    set({ githubToken: token });
    persist({ githubToken: token });
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
          llmBaseUrl: saved.llmBaseUrl ?? '',
          llmApiKey: saved.llmApiKey ?? '',
          llmModelName: saved.llmModelName ?? '',
          researchEnabled: saved.researchEnabled ?? false,
          researchCategories: saved.researchCategories ?? [],
          customUrls: saved.customUrls ?? [],
          githubToken: saved.githubToken ?? '',
        });
      }
    } catch {}
  },
}));
