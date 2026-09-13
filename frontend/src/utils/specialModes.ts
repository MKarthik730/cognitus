// Debate mode runs a dedicated FOR/AGAINST/Arbitrator backend analyzer
// instead of the standard expert roster, and returns its result via the
// `complete` event's `mode_output` field (see backend/app/agents/debate.py
// and the SPECIAL_ANALYSIS_MODES dispatch in backend/app/api/websocket.py).
// This maps that bespoke shape onto the SAME node/verdict shapes the standard
// pipeline already renders (AgentRoster, GraphCanvas, SynthesisPanel) using a
// small fixed 3-node roster (For/Against/Arbitrator) instead of the
// LLM-invented, never-updating roster the Planner would otherwise produce.

import type { AnalysisMode, GraphJSON, GraphNode, NodeOutput } from '../types';

export function isSpecialMode(mode: AnalysisMode): boolean {
  return mode === 'debate';
}

function node(id: string, label: string, color: GraphNode['color']): GraphNode {
  return { id, label, instruction: '', color, role: 'domain_expert' };
}

const DEBATE_GRAPH: GraphJSON = {
  mode: 'debate',
  edges: [{ from: 'for', to: 'arbitrator' }, { from: 'against', to: 'arbitrator' }],
  nodes: [
    node('for', 'For', 'green' as GraphNode['color']),
    node('against', 'Against', 'red'),
    node('arbitrator', 'Arbitrator', 'indigo'),
  ],
};

export function specialModeGraph(mode: AnalysisMode): GraphJSON | null {
  return mode === 'debate' ? DEBATE_GRAPH : null;
}

function fmtList(items: string[]): string {
  return items.map((s) => `• ${s}`).join('\n');
}

/** Maps debate mode's raw `mode_output` onto the standard NodeOutput shape per fixed role. */
export function mapSpecialModeOutputs(mode: AnalysisMode, output: any): Record<string, NodeOutput> {
  if (mode !== 'debate' || !output) return {};

  const forSide = output.for ?? {};
  const against = output.against ?? {};
  const arb = output.arbitration ?? {};
  const forArgs: string[] = (forSide.strongest_arguments ?? []).map((a: any) => a.argument);
  const againstArgs: string[] = (against.strongest_arguments ?? []).map((a: any) => a.argument);
  const stronger = arb.stronger_argument;

  return {
    for: {
      output: fmtList(forArgs) || 'No arguments returned.',
      confidence: stronger === 'for' ? 75 : stronger === 'against' ? 35 : 50,
      verdict: 'For',
      sentiment: 'neutral',
      reasoning: forSide.rebuttal_against_opposition || '',
      keyPoints: forArgs,
    },
    against: {
      output: fmtList(againstArgs) || 'No arguments returned.',
      confidence: stronger === 'against' ? 75 : stronger === 'for' ? 35 : 50,
      verdict: 'Against',
      sentiment: 'neutral',
      reasoning: against.rebuttal_against_opposition || '',
      keyPoints: againstArgs,
    },
    arbitrator: {
      output: arb.reasoning || 'No arbitration returned.',
      confidence: 80,
      verdict: stronger ? `${String(stronger).toUpperCase()} is stronger` : 'Tie',
      sentiment: 'neutral',
      reasoning: arb.what_would_change_verdict || '',
      keyPoints: [arb.for_summary, arb.against_summary].filter(Boolean),
    },
  };
}

/** A one-line headline for the Synthesis panel's "Final Verdict" card. */
export function deriveSpecialVerdict(mode: AnalysisMode, output: any): string {
  if (mode !== 'debate' || !output) return 'Analysis complete.';
  const arb = output.arbitration ?? {};
  const stronger = arb.stronger_argument ? String(arb.stronger_argument).toUpperCase() : 'NEITHER';
  return `Stronger case: ${stronger}. ${arb.reasoning || ''}`.trim();
}
