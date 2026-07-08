// ==========================================================================
// Core types for the Council AI deliberation platform
// ==========================================================================

export type NodeRole =
  | 'analyst' | 'critic' | 'devil' | 'synthesizer'
  | 'domain_expert' | 'emotional' | 'technical' | 'custom'
  | 'historian' | 'verdict' | 'moderator';

export type NodeColor = 'indigo' | 'amber' | 'cyan' | 'green' | 'red' | 'purple';

export type AnalysisMode =
  | 'standard' | 'debate' | 'research' | 'decision' | 'technical' | 'cascade'
  | 'pre_mortem' | 'signal_vs_noise' | 'iceberg' | 'reverse_engineer';

export type GraphStatus = 'idle' | 'planning' | 'analyzing' | 'complete' | 'error';

export type NodeSentiment = 'neutral' | 'positive' | 'negative' | 'conflict';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

// ==========================================================================
// Graph types
// ==========================================================================

export interface GraphNode {
  id: string;
  label: string;
  instruction: string;
  color: NodeColor;
  role: NodeRole;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphJSON {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mode: AnalysisMode;
}

export interface NodePosition {
  x: number;
  y: number;
}

// ==========================================================================
// Node output types
// ==========================================================================

export interface NodeOutput {
  output: string;
  confidence: number;
  verdict: string;
  sentiment: NodeSentiment;
  reasoning?: string;
  keyPoints?: string[];
}

export interface EdgeConflict {
  from: string;
  to: string;
  summary: string;
}

// ==========================================================================
// Backend data shapes (from WebSocket events)
// ==========================================================================

export interface BackendExpertData {
  analysis: string;
  confidence: ConfidenceLevel;
  position: string;
  reasoning: string;
  key_findings: string[];
  concerns: string[];
  confidence_score?: number;
  model_used: string;
  cached: boolean;
}

export interface BackendCrossCheckData {
  contradictions: any[];
  agreements: any[];
  consensus_score: number;
}

export interface BackendCrossExamineData {
  maintains_position: boolean;
  revision: string | null;
  points_of_agreement: string[];
  points_of_disagreement: string[];
}

export interface BackendSynthesisData {
  verdict: string;
  reasoning: string;
  confidence: ConfidenceLevel;
  consensus_score: number;
  minority_report?: string;
  what_would_change_my_mind?: string[];
  confidence_breakdown?: Record<string, number>;
  cross_examine?: Record<string, BackendCrossExamineData>;
}

export interface BackendCompleteData {
  status: string;
  experts: Array<{
    domain: string;
    analysis: string;
    confidence: ConfidenceLevel;
    position: string;
    reasoning: string;
    key_findings: string[];
    concerns: string[];
    cached: boolean;
  }>;
  contradictions: any[];
  agreements: any[];
  consensus_score: number;
  verdict: string;
  synthesis_reasoning: string;
  synthesis_confidence: ConfidenceLevel;
  minority_report: string;
  what_would_change_my_mind: string[];
  confidence_breakdown: Record<string, number>;
  cross_examine: Record<string, BackendCrossExamineData>;
}

// ==========================================================================
// WebSocket event types (matching backend)
// ==========================================================================

export interface WSAssumptions {
  type: 'assumptions';
  assumptions: string[];
}

export interface WSNodeSelectionStart {
  type: 'node_selection_start';
}

export interface WSNodeSelectionComplete {
  type: 'node_selection_complete';
  nodes: Array<{ name: string; behavior: string; color?: string }>;
}

export interface WSNodeStart {
  type: 'node_start';
  node: string;
  status: string;
}

export interface WSExpertComplete {
  type: 'expert_complete';
  domain: string;
  data: BackendExpertData;
}

export interface WSExpertError {
  type: 'expert_error';
  domain: string;
  error: string;
}

export interface WSNodeComplete {
  type: 'node_complete';
  node: string;
  data: BackendSynthesisData | BackendCrossCheckData;
  status?: string;
}

export interface WSCrossExamineResult {
  type: 'cross_examine_result';
  domain: string;
  data: BackendCrossExamineData;
}

export interface WSComplete {
  type: 'complete';
  data: BackendCompleteData;
}

export interface WSError {
  type: 'error';
  message: string;
}

export interface WSGhostDisclosure {
  type: 'ghost_disclosure';
  disclosure: string;
}

export interface WSPIIRedactions {
  type: 'pii_redactions';
  redactions: any[];
}

export type WSEvent =
  | WSAssumptions
  | WSNodeSelectionStart
  | WSNodeSelectionComplete
  | WSNodeStart
  | WSExpertComplete
  | WSExpertError
  | WSNodeComplete
  | WSCrossExamineResult
  | WSComplete
  | WSError
  | WSGhostDisclosure
  | WSPIIRedactions;

// ==========================================================================
// UI types
// ==========================================================================

export interface ModeCard {
  id: AnalysisMode;
  icon: string;
  name: string;
  description: string;
  example: string;
}

export interface NodePopoverData {
  nodeId: string;
  label: string;
  color: NodeColor;
  confidence: number;
  reasoning: string;
  keyPoints: string[];
  influencedBy: string;
  influences: string;
}

// ==========================================================================
// Custom node types
// ==========================================================================

export interface CustomNode {
  id: string;
  label: string;
  instruction: string;
  role: NodeRole;
  color: NodeColor;
  bias: number;
  confidenceThreshold: number;
  connectFrom: string;
  connectTo: string;
  createdAt?: string;
  useCount?: number;
}

export interface CustomAgentPreset {
  id?: number;
  label: string;
  instruction: string;
  role: NodeRole;
  color: NodeColor;
  bias: number;
  confidenceThreshold: number;
  createdAt?: string;
  useCount?: number;
}

// ==========================================================================
// API types
// ==========================================================================

export interface PlannerRequest {
  query: string;
  mode: AnalysisMode;
}

export interface InjectNodeRequest {
  session_id: string;
  node: CustomNode;
}

export interface InjectNodeResponse {
  graph: GraphJSON;
}

export interface PresetListResponse {
  presets: CustomAgentPreset[];
}

export interface PresetSaveRequest {
  label: string;
  instruction: string;
  role: NodeRole;
  color: NodeColor;
  bias: number;
  confidenceThreshold: number;
}
