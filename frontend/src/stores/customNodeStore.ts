import { create } from 'zustand';
import type { CustomNode, CustomAgentPreset } from '../types';

interface CustomNodeState {
  presets: CustomAgentPreset[];
  pendingNode: Partial<CustomNode> | null;
  isPanelOpen: boolean;
  isSaving: boolean;

  // Actions
  setPendingNode: (node: Partial<CustomNode> | null) => void;
  setPanelOpen: (open: boolean) => void;
  setSaving: (saving: boolean) => void;
  loadPresets: () => Promise<void>;
  savePreset: (preset: CustomAgentPreset) => Promise<void>;
  deletePreset: (id: number) => Promise<void>;
  injectPreset: (sessionId: string, preset: CustomAgentPreset, connectFrom: string, connectTo: string) => Promise<void>;
  createPendingFromPreset: (preset: CustomAgentPreset) => void;
  resetPending: () => void;
}

const API_BASE = '/api';

export const useCustomNodeStore = create<CustomNodeState>((set) => ({
  presets: [],
  pendingNode: null,
  isPanelOpen: false,
  isSaving: false,

  setPendingNode: (node) => set({ pendingNode: node }),
  setPanelOpen: (open) => set({ isPanelOpen: open }),
  setSaving: (saving) => set({ isSaving: saving }),

  loadPresets: async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/presets/`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        set({ presets: data.presets || [] });
      }
    } catch (e) {
      console.warn('Failed to load presets:', e);
    }
  },

  savePreset: async (preset) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/presets/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(preset),
      });
      if (res.ok) {
        const saved = await res.json();
        set((state) => ({ presets: [...state.presets, saved] }));
      }
    } catch (e) {
      console.warn('Failed to save preset:', e);
    }
  },

  deletePreset: async (id) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE}/presets/${id}/`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        set((state) => ({ presets: state.presets.filter((p) => p.id !== id) }));
      }
    } catch (e) {
      console.warn('Failed to delete preset:', e);
    }
  },

  injectPreset: async (sessionId, preset, connectFrom, connectTo) => {
    try {
      const token = localStorage.getItem('token');
      const node: CustomNode = {
        id: `custom_${Date.now()}`,
        label: preset.label,
        instruction: preset.instruction,
        role: preset.role,
        color: preset.color,
        bias: preset.bias,
        confidenceThreshold: preset.confidenceThreshold,
        connectFrom,
        connectTo,
      };

      const res = await fetch(`${API_BASE}/graph/inject-node/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ session_id: sessionId, node }),
      });

      if (res.ok) {
        const data = await res.json();
        return data.graph;
      }
    } catch (e) {
      console.warn('Failed to inject node:', e);
    }
  },

  createPendingFromPreset: (preset) => {
    set({
      pendingNode: {
        label: preset.label,
        instruction: preset.instruction,
        role: preset.role,
        color: preset.color,
        bias: preset.bias,
        confidenceThreshold: preset.confidenceThreshold,
      },
      isPanelOpen: true,
    });
  },

  resetPending: () => set({ pendingNode: null }),
}));
