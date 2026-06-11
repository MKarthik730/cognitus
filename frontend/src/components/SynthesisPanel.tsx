import React from 'react';
import { useGraphStore } from '../stores/graphStore';

export const SynthesisPanel: React.FC = () => {
  const status = useGraphStore((s) => s.status);
  const mode = useGraphStore((s) => s.mode);
  const graph = useGraphStore((s) => s.graph);
  const nodeOutputs = useGraphStore((s) => s.nodeOutputs);
  const activeNodeId = useGraphStore((s) => s.activeNodeId);
  const finalVerdict = useGraphStore((s) => s.finalVerdict);
  const edgeConflicts = useGraphStore((s) => s.edgeConflicts);
  const query = useGraphStore((s) => s.query);

  const nodes = graph?.nodes ?? [];
  const conflicts = edgeConflicts ?? [];
  const outputs = Object.entries(nodeOutputs ?? {});
  const doneCount = outputs.length;
  const totalCount = nodes.length;

  // Aggregate confidence
  const avgConfidence =
    outputs.length > 0
      ? Math.round(
          outputs.reduce((sum, [, o]) => sum + o.confidence, 0) / outputs.length
        )
      : 0;

  const statusLabel =
    status === 'idle' ? 'Ready' :
    status === 'planning' ? 'Assembling Council' :
    status === 'analyzing' ? 'Deliberating' :
    status === 'complete' ? 'Verdict Reached' :
    status === 'error' ? 'Error' : '';

  const modeLabel = mode.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <aside className="w-[260px] min-w-[260px] flex flex-col bg-chamber border-l border-border overflow-hidden">
      {/* Header */}
      <div className="zone-header px-3.5 pt-3 pb-2 border-b border-border">
        <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ghost">
          Synthesis
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Status card */}
        <div className="px-3.5 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
              Status
            </span>
            <span
              className={`text-[10px] font-semibold font-mono ${
                status === 'analyzing' ? 'text-signal' :
                status === 'complete' ? 'text-green-400' :
                status === 'error' ? 'text-red-400' :
                'text-ghost'
              }`}
            >
              {statusLabel}
            </span>
          </div>

          {/* Subject */}
          {query && (
            <div className="mb-2">
              <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                Subject
              </span>
              <p className="mt-1 text-[11px] text-white font-body leading-relaxed">
                {query}
              </p>
            </div>
          )}

          {/* Mode */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
              Mode
            </span>
            <span className="text-[10px] text-pulse font-mono">{modeLabel}</span>
          </div>
        </div>

        {/* Progress */}
        <div className="px-3.5 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
              Progress
            </span>
            <span className="text-[10px] text-white font-mono">
              {doneCount}/{totalCount}
            </span>
          </div>
          <div className="h-1.5 bg-void rounded-full overflow-hidden">
            <div
              className="h-full bg-pulse rounded-full transition-all duration-500"
              style={{ width: totalCount > 0 ? `${(doneCount / totalCount) * 100}%` : '0%' }}
            />
          </div>
        </div>

        {/* Active node */}
        {activeNodeId && (
          <div className="px-3.5 py-3 border-b border-border">
            <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
              Active Agent
            </span>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-signal animate-ping" />
              <span className="text-[11px] text-white font-mono">{activeNodeId}</span>
            </div>
          </div>
        )}

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div className="px-3.5 py-3 border-b border-border">
            <span className="text-[9px] text-warn font-semibold uppercase tracking-wider flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-warn" />
              Disagreements ({conflicts.length})
            </span>
            <div className="mt-1.5 space-y-1.5">
              {conflicts.map((c, i) => (
                <div key={i} className="text-[10px] text-ghost font-mono leading-relaxed p-2 rounded-sm bg-warn/5 border border-warn/10">
                  <span className="text-warn font-semibold">{c.from}</span>
                  {' ↔ '}
                  <span className="text-warn font-semibold">{c.to}</span>
                  <p className="mt-0.5 text-[9px]">{c.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Verdict */}
        {(status === 'complete' || finalVerdict) && (
          <div className="px-3.5 py-3">
            <span className="text-[9px] text-pulse font-semibold uppercase tracking-wider flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="10" />
              </svg>
              Final Verdict
            </span>
            <div className="mt-2 p-3 rounded-md bg-surface-raised border border-border">
              <p className="text-[12px] text-white font-body leading-relaxed">
                {finalVerdict || 'Analysis complete.'}
              </p>
            </div>

            {/* Confidence score */}
            {avgConfidence > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                    Consensus Confidence
                  </span>
                  <span className="text-[11px] text-white font-mono font-semibold">{avgConfidence}%</span>
                </div>
                <div className="h-2 bg-void rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${
                      avgConfidence >= 70 ? 'bg-green-500' :
                      avgConfidence >= 40 ? 'bg-amber-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${avgConfidence}%` }}
                  />
                </div>
              </div>
            )}

            {/* Agent summary */}
            {outputs.length > 0 && (
              <div className="mt-3">
                <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                  Agent Contributions
                </span>
                <div className="mt-1.5 space-y-1">
                  {outputs.map(([id, output]) => (
                    <div key={id} className="flex items-center justify-between py-1.5 px-2 rounded-sm even:bg-void/30">
                      <span className="text-[10px] text-white font-mono truncate max-w-[140px]">
                        {id}
                      </span>
                      <span className={`text-[9px] font-mono ${
                        output.confidence >= 70 ? 'text-green-400' :
                        output.confidence >= 40 ? 'text-amber-400' :
                        'text-red-400'
                      }`}>
                        {Math.round(output.confidence)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {status === 'idle' && !query && (
          <div className="px-3.5 py-6 text-center">
            <svg className="w-8 h-8 text-border mx-auto mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <p className="text-[10px] text-ghost italic">
              Verdict will appear here once analysis completes.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
};
