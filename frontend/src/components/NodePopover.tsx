import React, { useEffect, useRef } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { NODE_COLORS } from '../utils/colors';

export const NodePopover: React.FC = () => {
  const activeNodeId = useGraphStore((s) => s.activeNodeId);
  const nodeOutputs = useGraphStore((s) => s.nodeOutputs);
  const graph = useGraphStore((s) => s.graph);
  const setActiveNode = useGraphStore((s) => s.setActiveNode);
  const popoverRef = useRef<HTMLDivElement>(null);

  const node = graph?.nodes.find((n) => n.id === activeNodeId);
  const output = activeNodeId ? nodeOutputs[activeNodeId] : undefined;

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setActiveNode(null);
      }
    };
    if (activeNodeId) {
      setTimeout(() => document.addEventListener('click', handleClick), 0);
    }
    return () => document.removeEventListener('click', handleClick);
  }, [activeNodeId, setActiveNode]);

  if (!node || !output) return null;

  const color = NODE_COLORS[node.color] ?? NODE_COLORS.indigo;
  const isCustom = node.id.startsWith('custom_');

  const confidenceWidth = `${Math.round(output.confidence)}%`;
  const confidenceColor =
    output.confidence >= 70
      ? 'bg-green-500'
      : output.confidence >= 40
      ? 'bg-amber-500'
      : 'bg-red-500';

  const keyPoints = output.keyPoints ?? [];
  const reasoning = output.reasoning ?? output.output ?? '';

  return (
    <div
      ref={popoverRef}
      className="fixed bottom-20 right-72 w-[360px] max-h-[460px] bg-chamber border border-border rounded-lg shadow-2xl z-50 overflow-hidden animate-bubble-in"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border">
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <div className="font-display text-sm font-semibold text-white">
            {node.label}
            {isCustom && <span className="ml-1 text-[10px] text-ghost">✎</span>}
          </div>
          <div className="text-[10px] text-ghost font-mono">{node.role}</div>
        </div>
        <button
          onClick={() => setActiveNode(null)}
          className="w-5 h-5 flex items-center justify-center text-ghost hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Confidence bar */}
      <div className="px-4 py-2.5 border-b border-border">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-ghost font-semibold uppercase tracking-wider">
            Confidence
          </span>
          <span className="text-[11px] text-white font-mono font-semibold">
            {confidenceWidth}
          </span>
        </div>
        <div className="h-1.5 bg-void rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${confidenceColor}`}
            style={{ width: confidenceWidth }}
          />
        </div>
      </div>

      {/* Reasoning */}
      <div className="px-4 py-3 overflow-y-auto max-h-[220px]">
        <div className="text-[11px] text-ghost font-mono leading-relaxed whitespace-pre-wrap">
          {reasoning}
        </div>

        {/* Key points */}
        {keyPoints.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
              Key Points
            </span>
            <ul className="mt-1.5 space-y-1">
              {keyPoints.map((point, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-white">
                  <span className="text-pulse mt-px flex-shrink-0">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Verdict */}
        {output.verdict && (
          <div className="mt-3 pt-3 border-t border-border">
            <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
              Verdict
            </span>
            <p className="mt-1 text-[12px] text-white font-medium leading-relaxed">
              {output.verdict}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border bg-void/50">
        <span className="text-[9px] text-ghost">Influences: Synthesizer</span>
        <div className="flex-1" />
        {isCustom && (
          <button className="text-[10px] text-red-400 hover:text-red-300 transition-colors">
            Remove
          </button>
        )}
        <button className="text-[10px] text-ghost hover:text-white transition-colors">
          Full Output →
        </button>
      </div>
    </div>
  );
};
