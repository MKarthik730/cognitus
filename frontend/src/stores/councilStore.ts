import { create } from "zustand";

export type DomainName =
  | "legal"
  | "finance"
  | "medical"
  | "technology"
  | "education"
  | "science"
  | "business"
  | "ethics"
  | "psychology"
  | "sociology";

export type PipelineStatus =
  | "idle"
  | "processing"
  | "completed"
  | "failed";

export interface ExpertResult {
  domain: DomainName;
  analysis: string;
  confidence: "high" | "medium" | "low";
  model_used: string;
  processing_time_ms: number;
}

export interface Contradiction {
  between: [DomainName, DomainName];
  type: "direct" | "partial" | "complementary";
  description: string;
  severity: "high" | "medium" | "low";
}

export interface Agreement {
  between: [DomainName, DomainName];
  points: string[];
}

export interface CrossCheckData {
  contradictions: Contradiction[];
  agreements: Agreement[];
  consensus_score: number;
}

export interface SynthesisData {
  verdict: string;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  consensus_score: number;
}

export interface WsEvent {
  type: string;
  node?: string;
  domain?: DomainName;
  data?: Record<string, unknown>;
  status?: string;
  error?: string;
  message?: string;
  experts?: ExpertResult[];
  contradictions?: Contradiction[];
  agreements?: Agreement[];
  consensus_score?: number;
  verdict?: string;
  synthesis_reasoning?: string;
  synthesis_confidence?: string;
}

interface CouncilState {
  status: PipelineStatus;
  situation: string;
  selectedDomains: DomainName[];
  experts: ExpertResult[];
  contradictions: Contradiction[];
  agreements: Agreement[];
  consensusScore: number;
  synthesis: SynthesisData | null;
  error: string | null;
  currentNode: string | null;

  setSituation: (s: string) => void;
  setStatus: (s: PipelineStatus) => void;
  setSelectedDomains: (d: DomainName[]) => void;
  addExpert: (e: ExpertResult) => void;
  setContradictions: (c: Contradiction[]) => void;
  setAgreements: (a: Agreement[]) => void;
  setConsensusScore: (s: number) => void;
  setSynthesis: (s: SynthesisData) => void;
  setError: (e: string | null) => void;
  setCurrentNode: (n: string | null) => void;
  reset: () => void;
  handleWsEvent: (event: WsEvent) => void;
}

const initialState = {
  status: "idle" as PipelineStatus,
  situation: "",
  selectedDomains: [] as DomainName[],
  experts: [] as ExpertResult[],
  contradictions: [] as Contradiction[],
  agreements: [] as Agreement[],
  consensusScore: 0,
  synthesis: null as SynthesisData | null,
  error: null as string | null,
  currentNode: null as string | null,
};

export const useCouncilStore = create<CouncilState>((set, get) => ({
  ...initialState,

  setSituation: (situation) => set({ situation }),
  setStatus: (status) => set({ status }),
  setSelectedDomains: (selectedDomains) => set({ selectedDomains }),
  addExpert: (expert) =>
    set((s) => ({ experts: [...s.experts, expert] })),
  setContradictions: (contradictions) => set({ contradictions }),
  setAgreements: (agreements) => set({ agreements }),
  setConsensusScore: (consensusScore) => set({ consensusScore }),
  setSynthesis: (synthesis) => set({ synthesis }),
  setError: (error) => set({ error }),
  setCurrentNode: (currentNode) => set({ currentNode }),

  reset: () => set(initialState),

  handleWsEvent: (event: WsEvent) => {
    const state = get();
    switch (event.type) {
      case "node_start":
        set({ currentNode: event.node ?? null });
        break;
      case "node_complete":
        if (event.node === "distributor" && event.data?.domains) {
          set({
            selectedDomains: event.data.domains as DomainName[],
            currentNode: null,
          });
        }
        if (event.node === "cross_check" && event.data) {
          set({
            contradictions: (event.data.contradictions ?? []) as Contradiction[],
            agreements: (event.data.agreements ?? []) as Agreement[],
            consensusScore: (event.data.consensus_score as number) ?? 0,
            currentNode: null,
          });
        }
        if (event.node === "synthesizer" && event.data) {
          set({
            synthesis: {
              verdict: (event.data.verdict as string) ?? "",
              reasoning: (event.data.reasoning as string) ?? "",
              confidence: (event.data.confidence as "high" | "medium" | "low") ?? "medium",
              consensus_score: (event.data.consensus_score as number) ?? 0,
            },
            currentNode: null,
          });
        }
        break;
      case "expert_complete":
        if (event.domain && event.data) {
          set({
            experts: [
              ...state.experts,
              {
                domain: event.domain,
                analysis: (event.data.analysis as string) ?? "",
                confidence: (event.data.confidence as "high" | "medium" | "low") ?? "medium",
                model_used: (event.data.model_used as string) ?? "",
                processing_time_ms: 0,
              },
            ],
          });
        }
        break;
      case "expert_error":
        set({ error: `Expert ${event.domain} failed: ${event.error}` });
        break;
      case "complete":
        if (event.data) {
          set({
            status: "completed",
            synthesis: {
              verdict: (event.verdict ?? event.data?.verdict as string) ?? "",
              reasoning: (event.synthesis_reasoning ?? event.data?.synthesis_reasoning as string) ?? "",
              confidence: (event.synthesis_confidence ?? event.data?.synthesis_confidence as "high" | "medium" | "low") ?? "medium",
              consensus_score: (event.consensus_score ?? event.data?.consensus_score as number) ?? 0,
            },
            consensusScore: (event.consensus_score ?? event.data?.consensus_score as number) ?? 0,
            contradictions: (event.contradictions ?? event.data?.contradictions as Contradiction[]) ?? [],
            agreements: (event.agreements ?? event.data?.agreements as Agreement[]) ?? [],
            currentNode: null,
          });
        }
        break;
      case "error":
        set({ error: event.message ?? "Unknown error", status: "failed", currentNode: null });
        break;
    }
  },
}));
