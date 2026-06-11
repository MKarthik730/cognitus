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
// Custom node types
// ==========================================================================

export interface CustomNode {
  id: string;
  label: string;
  instruction: string;
  role: NodeRole;
  color: NodeColor;
  bias: number; // 0.0 = optimistic, 1.0 = pessimistic
  confidenceThreshold: number; // 0.0-1.0, min confidence to speak
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
// WebSocket event types
// ==========================================================================

export interface WSGraphReady {
  type: 'graph_ready';
  graph: GraphJSON;
}

export interface WSNodeStart {
  type: 'node_start';
  node_id: string;
}

export interface WSNodeStream {
  type: 'node_stream';
  node_id: string;
  chunk: string;
}

export interface WSNodeDone {
  type: 'node_done';
  node_id: string;
  output: string;
  confidence: number;
  verdict: string;
  sentiment: NodeSentiment;
}

export interface WSEdgeConflict {
  type: 'edge_conflict';
  from: string;
  to: string;
  summary: string;
}

export interface WSAnalysisComplete {
  type: 'analysis_complete';
  final_verdict: string;
}

export interface WSError {
  type: 'error';
  message: string;
}

export type WSEvent =
  | WSGraphReady
  | WSNodeStart
  | WSNodeStream
  | WSNodeDone
  | WSEdgeConflict
  | WSAnalysisComplete
  | WSError;

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
