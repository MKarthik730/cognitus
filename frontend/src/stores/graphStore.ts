import { create } from 'zustand';
import type { GraphJSON, NodeOutput, GraphStatus, AnalysisMode, NodePosition, EdgeConflict } from '../types';

interface GraphState {
  sessionId: string | null;
  query: string;
  mode: AnalysisMode;
  graph: GraphJSON | null;
  nodeOutputs: Record<string, NodeOutput>;
  nodePositions: Record<string, NodePosition>;
  activeNodeId: string | null;
  status: GraphStatus;
  finalVerdict: string | null;
  edgeConflicts: EdgeConflict[];

  // Actions
  setSessionId: (id: string) => void;
  setQuery: (query: string) => void;
  setMode: (mode: AnalysisMode) => void;
  setGraph: (graph: GraphJSON) => void;
  updateNodeOutput: (nodeId: string, output: NodeOutput) => void;
  setNodePosition: (nodeId: string, pos: NodePosition) => void;
  setActiveNode: (nodeId: string | null) => void;
  setStatus: (status: GraphStatus) => void;
  setFinalVerdict: (verdict: string) => void;
  addEdgeConflict: (conflict: EdgeConflict) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null as string | null,
  query: '',
  mode: 'standard' as AnalysisMode,
  graph: null as GraphJSON | null,
  nodeOutputs: {} as Record<string, NodeOutput>,
  nodePositions: {} as Record<string, NodePosition>,
  activeNodeId: null as string | null,
  status: 'idle' as GraphStatus,
  finalVerdict: null as string | null,
  edgeConflicts: [] as EdgeConflict[],
};

export const useGraphStore = create<GraphState>((set) => ({
  ...initialState,

  setSessionId: (id) => set({ sessionId: id }),

  setQuery: (query) => set({ query }),

  setMode: (mode) => set({ mode }),

  setGraph: (graph) => set({ graph, status: 'planning' }),

  updateNodeOutput: (nodeId, output) =>
    set((state) => ({
      nodeOutputs: { ...state.nodeOutputs, [nodeId]: output },
    })),

  setNodePosition: (nodeId, pos) =>
    set((state) => ({
      nodePositions: { ...state.nodePositions, [nodeId]: pos },
    })),

  setActiveNode: (nodeId) => set({ activeNodeId: nodeId }),

  setStatus: (status) => set({ status }),

  setFinalVerdict: (verdict) => set({ finalVerdict: verdict, status: 'complete' }),

  addEdgeConflict: (conflict) =>
    set((state) => ({
      edgeConflicts: [...state.edgeConflicts, conflict],
    })),

  reset: () => set(initialState),
}));
