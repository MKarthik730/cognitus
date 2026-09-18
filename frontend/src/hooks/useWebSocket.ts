import { useCallback, useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { mapSpecialModeOutputs, deriveSpecialVerdict } from '../utils/specialModes';
import type { AnalysisMode } from '../types';

const WS_BASE = `ws://${window.location.hostname}:5173/ws`;

function confidenceToNumber(level: string): number {
  if (level === 'high') return 85;
  if (level === 'medium') return 50;
  return 20;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback((sessionId: string, payload: Record<string, unknown>) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const url = `${WS_BASE}/${sessionId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        const store = useGraphStore.getState();

        switch (event.type) {
          // New analysis begins — node selection from LLM
          case 'node_selection_start':
            store.setStatus('analyzing');
            break;

          case 'node_selection_complete':
            // Nodes were selected — analysis about to start
            break;

          // Per-node start — set active node for UI glow
          case 'node_start':
            store.setActiveNode(event.node);
            store.setStatus('analyzing');
            break;

          // Expert completed — store its output (normalize key to lowercase)
          case 'expert_complete': {
            const d = event.data;
            const confidenceNum = d.confidence_score ?? confidenceToNumber(d.confidence);
            const key = event.domain.toLowerCase();
            store.updateNodeOutput(key, {
              output: d.analysis || '',
              confidence: confidenceNum,
              verdict: d.position || '',
              sentiment: 'neutral',
              reasoning: d.reasoning || '',
              keyPoints: d.key_findings || [],
            });
            store.setActiveNode(null);
            break;
          }

          // Expert errored
          case 'expert_error':
            store.updateNodeOutput(event.domain.toLowerCase(), {
              output: `Error: ${event.error}`,
              confidence: 0,
              verdict: 'Error',
              sentiment: 'negative',
            });
            store.setActiveNode(null);
            break;

          // Node complete (cross_check or synthesizer)
          case 'node_complete':
            if (event.node === 'cross_check') {
              // Cross-check data — not stored in nodeOutputs
              store.setActiveNode(null);
            } else if (event.node === 'synthesizer') {
              const synthData = event.data;
              const synthKey = event.node.toLowerCase();
              store.setFinalVerdict(synthData.verdict || '');
              store.updateNodeOutput(synthKey, {
                output: synthData.reasoning || '',
                confidence: synthData.consensus_score != null
                  ? Math.round(synthData.consensus_score * 100)
                  : confidenceToNumber(synthData.confidence),
                verdict: synthData.verdict || '',
                sentiment: 'neutral',
                reasoning: synthData.reasoning || '',
              });
              store.setActiveNode(null);
            }
            break;

          // Cross-examination results — check for position revisions
          case 'cross_examine_result': {
            const ce = event.data;
            const key = event.domain.toLowerCase();
            // Add disagreement indicators
            if (ce.points_of_disagreement?.length > 0) {
              store.addEdgeConflict({
                from: key,
                to: key,
                summary: ce.points_of_disagreement[0],
              });
            }
            // If position was revised, update the node output
            if (ce.revision) {
              const existing = useGraphStore.getState().nodeOutputs[key];
              if (existing) {
                store.updateNodeOutput(key, {
                  ...existing,
                  verdict: ce.revision,
                  output: existing.output + `\n\n[Revised after cross-examination] ${ce.revision}`,
                });
              }
            }
            break;
          }

          // Final complete event
          case 'complete':
            // Special modes (currently just Debate) return a bespoke shape
            // via `mode_output` instead of `experts`/`verdict` — map it onto
            // the same node/verdict shapes the standard pipeline renders.
            if (event.data.analysis_mode && event.data.mode_output) {
              const specialMode = event.data.analysis_mode as AnalysisMode;
              const mapped = mapSpecialModeOutputs(specialMode, event.data.mode_output);
              Object.entries(mapped).forEach(([key, output]) => {
                store.updateNodeOutput(key, output);
              });
              store.setActiveNode(null);
              store.setFinalVerdict(deriveSpecialVerdict(specialMode, event.data.mode_output));
              store.setStatus('complete');
              break;
            }

            // Store all expert outputs from the complete payload (for reconnect recovery)
            if (event.data.experts) {
              event.data.experts.forEach((exp: { domain: string; analysis: string; confidence: string; position: string; reasoning: string; key_findings: string[]; concerns: string[]; cached: boolean }) => {
                const key = exp.domain.toLowerCase();
                const existing = useGraphStore.getState().nodeOutputs[key];
                if (!existing) {
                  const confidenceNum =
                    exp.confidence === 'high' ? 85 :
                    exp.confidence === 'medium' ? 50 : 20;
                  store.updateNodeOutput(key, {
                    output: exp.analysis || '',
                    confidence: confidenceNum,
                    verdict: exp.position || '',
                    sentiment: 'neutral',
                    reasoning: exp.reasoning || '',
                    keyPoints: exp.key_findings || [],
                  });
                }
              });
            }
            store.setActiveNode(null);
            store.setFinalVerdict(event.data.verdict || 'Analysis complete.');
            store.setStatus('complete');
            break;

          // Error
          case 'error':
            store.setStatus('error');
            break;

          // Live research (real-time data) — fetching, then the sources used
          case 'research_start':
            store.setResearching(true);
            break;

          case 'research_sources':
            store.setLiveSources(event.sources || []);
            break;

          // Ghost mode / PII / assumptions — log but don't disrupt
          case 'ghost_disclosure':
          case 'ghost_timer':
          case 'pii_redactions':
          case 'assumptions':
            break;

          // --- Verdict mode ---
          case 'verdict_ingest_start':
            store.setStatus('analyzing');
            store.setGate('pending');
            break;

          case 'verdict_ingest_complete':
            break;

          case 'verdict_check_start':
            store.setActiveNode(event.check_name);
            break;

          case 'verdict_check_complete': {
            const c = event.check;
            const confidence = c.status === 'pass' ? 100 : c.status === 'fail' ? 0 : 40;
            store.updateNodeOutput(c.check_name, {
              output: c.detail,
              confidence,
              verdict: c.status,
              sentiment: c.status === 'pass' ? 'positive' : c.status === 'fail' ? 'negative' : 'neutral',
            });
            store.setActiveNode(null);
            break;
          }

          case 'verdict_opinion_start':
            store.setActiveNode(event.domain);
            break;

          case 'verdict_opinion_complete': {
            const f = event.finding;
            store.updateNodeOutput(f.domain, {
              output: f.reasoning || '',
              confidence: f.confidence ?? 50,
              verdict: f.position || '',
              sentiment: 'neutral',
              reasoning: f.reasoning || '',
              keyPoints: f.key_findings || [],
              evidence: f.evidence || [],
              uncertainty: f.uncertainty || [],
            });
            store.setActiveNode(null);
            break;
          }

          case 'verdict_claim_start':
            store.setActiveNode('claim_matcher');
            break;

          case 'verdict_claim_complete': {
            const m = event.match;
            const existing = useGraphStore.getState().nodeOutputs.claim_matcher;
            const priorLines = existing?.keyPoints ?? [];
            const priorText = existing?.output ? existing.output + '\n' : '';
            const sentiment = m.verdict !== 'match'
              ? 'negative'
              : existing?.sentiment === 'negative' ? 'negative' : 'positive';
            store.updateNodeOutput('claim_matcher', {
              output: `${priorText}"${m.claim}" -> ${m.verdict}`,
              confidence: m.confidence,
              verdict: m.verdict,
              sentiment,
              keyPoints: [...priorLines, m.claim],
            });
            break;
          }

          case 'verdict_gate_update':
            store.setGate(event.gate, event.action_reason);
            break;

          case 'verdict_complete':
            store.setVerdictScorecard(event.scorecard);
            store.setActiveNode(null);
            break;

          // Unknown — log for debugging
          default:
            console.debug('Unhandled WS event type:', event.type);
        }
      } catch (e) {
        console.error('Failed to parse WS message:', e);
      }
    };

    ws.onerror = () => {
      useGraphStore.getState().setStatus('error');
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const sendMessage = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { connect, disconnect, sendMessage };
}
