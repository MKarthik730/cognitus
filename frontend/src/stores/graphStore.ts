import { create } from 'zustand';
import type {
  GraphJSON, NodeOutput, GraphStatus, AnalysisMode, NodePosition, EdgeConflict,
  VerdictScorecard, GateStatus,
} from '../types';

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
  liveSources: { source: string; title: string; url: string }[];
  isResearching: boolean;

  // Verdict mode
  gateStatus: GateStatus;
  gateReason: string | null;
  verdictScorecard: VerdictScorecard | null;

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
  setResearching: (researching: boolean) => void;
  setLiveSources: (sources: { source: string; title: string; url: string }[]) => void;
  setGate: (status: GateStatus, reason?: string | null) => void;
  setVerdictScorecard: (scorecard: VerdictScorecard) => void;
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
  liveSources: [] as { source: string; title: string; url: string }[],
  isResearching: false,
  gateStatus: 'pending' as GateStatus,
  gateReason: null as string | null,
  verdictScorecard: null as VerdictScorecard | null,
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

  setResearching: (researching) => set({ isResearching: researching }),

  setLiveSources: (sources) => set({ liveSources: sources, isResearching: false }),

  setGate: (status, reason = null) => set({ gateStatus: status, gateReason: reason }),

  setVerdictScorecard: (scorecard) => set({ verdictScorecard: scorecard }),

  reset: () => set(initialState),
}));
