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
  return mode === 'debate' || mode === 'verdict';
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

// Verdict's fixed roster: the deterministic layer (facts, no LLM), the
// Backend/Security/DevOps/QA opinion layer, the one narrow claim-matcher
// LLM check, and a center "gate" node (role 'verdict' places it at the
// hub, same as the synthesizer in every other mode).
const VERDICT_DETERMINISTIC = ['tests', 'static_analysis', 'coverage', 'cve', 'secrets'];
const VERDICT_OPINION = ['backend', 'security', 'devops', 'qa'];

const VERDICT_GRAPH: GraphJSON = {
  mode: 'verdict',
  nodes: [
    ...VERDICT_DETERMINISTIC.map((id) => node(id, id.replace(/_/g, ' '), 'cyan')),
    ...VERDICT_OPINION.map((id) => node(id, id, 'indigo')),
    node('claim_matcher', 'Claim Match', 'amber'),
    { id: 'gate', label: 'Gate', instruction: '', color: 'green', role: 'verdict' },
  ],
  edges: [...VERDICT_DETERMINISTIC, ...VERDICT_OPINION, 'claim_matcher'].map((id) => ({
    from: id,
    to: 'gate',
  })),
};

export function specialModeGraph(mode: AnalysisMode): GraphJSON | null {
  if (mode === 'debate') return DEBATE_GRAPH;
  if (mode === 'verdict') return VERDICT_GRAPH;
  return null;
}

function fmtList(items: string[]): string {
  return items.map((s) => `• ${s}`).join('\n');
}

/** Maps Verdict's raw scorecard onto the standard NodeOutput shape per fixed role. */
function mapVerdictOutputs(scorecard: any): Record<string, NodeOutput> {
  const result: Record<string, NodeOutput> = {};

  for (const check of scorecard.deterministic_checks ?? []) {
    const confidence = check.status === 'pass' ? 100 : check.status === 'fail' ? 0 : 40;
    result[check.check_name] = {
      output: check.detail,
      confidence,
      verdict: check.status,
      sentiment: check.status === 'pass' ? 'positive' : check.status === 'fail' ? 'negative' : 'neutral',
    };
  }

  for (const finding of scorecard.opinion_findings ?? []) {
    result[finding.domain] = {
      output: finding.reasoning || '',
      confidence: finding.confidence ?? 50,
      verdict: finding.position || '',
      sentiment: 'neutral',
      reasoning: finding.reasoning || '',
      keyPoints: finding.key_findings || [],
      evidence: finding.evidence || [],
      uncertainty: finding.uncertainty || [],
    };
  }

  const claims = scorecard.claim_matches ?? [];
  if (claims.length > 0) {
    const matched = claims.filter((c: any) => c.verdict === 'match').length;
    const worst = claims.find((c: any) => c.verdict !== 'match');
    result.claim_matcher = {
      output: claims.map((c: any) => `"${c.claim}" -> ${c.verdict}`).join('\n'),
      confidence: Math.round(claims.reduce((s: number, c: any) => s + c.confidence, 0) / claims.length),
      verdict: `${matched}/${claims.length} matched`,
      sentiment: worst ? 'negative' : 'positive',
      keyPoints: claims.map((c: any) => c.claim),
    };
  }

  result.gate = {
    output: scorecard.action_reason || '',
    confidence: scorecard.action_taken === 'auto_approved' ? 100 : 0,
    verdict: scorecard.action_taken,
    sentiment: scorecard.action_taken === 'auto_approved' ? 'positive' : 'negative',
    reasoning: scorecard.action_reason || '',
  };

  return result;
}

/** Maps debate mode's raw `mode_output` onto the standard NodeOutput shape per fixed role. */
export function mapSpecialModeOutputs(mode: AnalysisMode, output: any): Record<string, NodeOutput> {
  if (mode === 'verdict') return output ? mapVerdictOutputs(output) : {};
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
  if (mode === 'verdict') {
    if (!output) return 'Verdict run complete.';
    const label = String(output.action_taken ?? '').replace(/_/g, ' ').toUpperCase();
    return `${label}. ${output.action_reason ?? ''}`.trim();
  }
  if (mode !== 'debate' || !output) return 'Analysis complete.';
  const arb = output.arbitration ?? {};
  const stronger = arb.stronger_argument ? String(arb.stronger_argument).toUpperCase() : 'NEITHER';
  return `Stronger case: ${stronger}. ${arb.reasoning || ''}`.trim();
}
