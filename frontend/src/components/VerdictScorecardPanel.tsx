import React from 'react';
import { useGraphStore } from '../stores/graphStore';
import { GateIndicator } from './GateIndicator';
import type { CheckStatus, ClaimVerdict } from '../types';

const CHECK_STATUS_COLOR: Record<CheckStatus, string> = {
  pass: 'text-green-400',
  fail: 'text-red-400',
  error: 'text-amber-400',
  skipped_no_data: 'text-ghost',
};

const CLAIM_VERDICT_COLOR: Record<ClaimVerdict, string> = {
  match: 'text-green-400',
  mismatch: 'text-red-400',
  partial: 'text-amber-400',
  unsupported: 'text-red-400',
};

/**
 * The Verdict scorecard — itemized on purpose. Facts + opinions + claim
 * matches are never collapsed into one verdict sentence; the itemization
 * is the product.
 */
export const VerdictScorecardPanel: React.FC = () => {
  const status = useGraphStore((s) => s.status);
  const query = useGraphStore((s) => s.query);
  const scorecard = useGraphStore((s) => s.verdictScorecard);
  const nodeOutputs = useGraphStore((s) => s.nodeOutputs);
  const activeNodeId = useGraphStore((s) => s.activeNodeId);

  const statusLabel =
    status === 'idle' ? 'Ready' :
    status === 'planning' ? 'Fetching PR' :
    status === 'analyzing' ? 'Verifying' :
    status === 'complete' ? 'Verdict Reached' :
    status === 'error' ? 'Error' : '';

  const checks = scorecard?.deterministic_checks ?? [];
  const opinions = scorecard?.opinion_findings ?? [];
  const claims = scorecard?.claim_matches ?? [];

  return (
    <aside className="w-[280px] min-w-[280px] flex flex-col bg-chamber border-l border-border overflow-hidden">
      <div className="zone-header px-3.5 pt-3 pb-2 border-b border-border flex items-center justify-between">
        <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ghost">
          Verdict Scorecard
        </span>
        <GateIndicator />
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Status */}
        <div className="px-3.5 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">Status</span>
            <span className={`text-[10px] font-semibold font-mono ${
              status === 'analyzing' ? 'text-signal' :
              status === 'complete' ? 'text-green-400' :
              status === 'error' ? 'text-red-400' : 'text-ghost'
            }`}>
              {statusLabel}
            </span>
          </div>
          {query && (
            <div>
              <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">PR</span>
              <p className="mt-1 text-[11px] text-white font-mono leading-relaxed break-all">{query}</p>
            </div>
          )}
          {activeNodeId && (
            <div className="mt-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-signal animate-ping" />
              <span className="text-[11px] text-white font-mono">{activeNodeId}</span>
            </div>
          )}
        </div>

        {/* Deterministic checks */}
        <div className="px-3.5 py-3 border-b border-border">
          <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
            Deterministic Checks ({checks.length || 5})
          </span>
          <div className="mt-2 space-y-1.5">
            {(checks.length > 0
              ? checks
              : ['tests', 'static_analysis', 'coverage', 'cve', 'secrets'].map((name) => ({
                  check_name: name as any, status: undefined, detail: '',
                }))
            ).map((c, i) => {
              const live = nodeOutputs[c.check_name];
              const displayStatus = c.status ?? (live?.verdict as CheckStatus | undefined);
              return (
                <div key={i} className="flex items-start justify-between gap-2 py-1 px-2 rounded-sm even:bg-void/30">
                  <span className="text-[10px] text-white font-mono">{c.check_name.replace(/_/g, ' ')}</span>
                  <span className={`text-[9px] font-mono font-semibold uppercase flex-shrink-0 ${
                    displayStatus ? CHECK_STATUS_COLOR[displayStatus as CheckStatus] ?? 'text-ghost' : 'text-ghost'
                  }`}>
                    {displayStatus ?? 'pending'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Claim matches */}
        <div className="px-3.5 py-3 border-b border-border">
          <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
            Claim Matches ({claims.length})
          </span>
          <div className="mt-2 space-y-1.5">
            {claims.length === 0 && (
              <p className="text-[10px] text-ghost italic">No claims verified yet.</p>
            )}
            {claims.map((m, i) => (
              <div key={i} className="p-2 rounded-sm bg-void/30">
                <p className="text-[10px] text-white leading-relaxed">{m.claim}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className={`text-[9px] font-mono font-semibold uppercase ${CLAIM_VERDICT_COLOR[m.verdict]}`}>
                    {m.verdict}
                  </span>
                  <span className="text-[9px] text-ghost font-mono">{m.confidence}%</span>
                </div>
                {m.supporting_lines.length > 0 && (
                  <pre className="mt-1 text-[9px] text-cyan-300 font-mono whitespace-pre-wrap break-all">
                    {m.supporting_lines.join('\n')}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Opinion layer */}
        <div className="px-3.5 py-3 border-b border-border">
          <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
            Opinion Layer ({opinions.length || 4})
          </span>
          <div className="mt-2 space-y-1">
            {(opinions.length > 0 ? opinions : ['backend', 'security', 'devops', 'qa'].map((d) => ({ domain: d, confidence: undefined as any }))).map((o, i) => (
              <div key={i} className="flex items-center justify-between py-1 px-2 rounded-sm even:bg-void/30">
                <span className="text-[10px] text-white font-mono capitalize">{o.domain}</span>
                <span className="text-[9px] text-ghost font-mono">
                  {o.confidence != null ? `${o.confidence}%` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Action taken */}
        {scorecard && (
          <div className="px-3.5 py-3">
            <span className="text-[9px] text-pulse font-semibold uppercase tracking-wider">Action Taken</span>
            <div className={`mt-2 p-3 rounded-md border ${
              scorecard.action_taken === 'auto_approved'
                ? 'bg-green-500/5 border-green-500/20'
                : 'bg-red-500/5 border-red-500/20'
            }`}>
              <p className={`text-[11px] font-mono font-semibold uppercase ${
                scorecard.action_taken === 'auto_approved' ? 'text-green-400' : 'text-red-400'
              }`}>
                {scorecard.action_taken.replace(/_/g, ' ')}
              </p>
              <p className="mt-1.5 text-[11px] text-white leading-relaxed">{scorecard.action_reason}</p>
            </div>
          </div>
        )}

        {!scorecard && status === 'idle' && !query && (
          <div className="px-3.5 py-6 text-center">
            <p className="text-[10px] text-ghost italic">
              Paste a GitHub PR URL to run Verdict.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
};
