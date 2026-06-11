import React from 'react';
import { useGraphStore } from '../stores/graphStore';
import { useCustomNodeStore } from '../stores/customNodeStore';
import { NODE_COLORS } from '../utils/colors';

export const AgentRoster: React.FC = () => {
  const graph = useGraphStore((s) => s.graph);
  const nodeOutputs = useGraphStore((s) => s.nodeOutputs);
  const activeNodeId = useGraphStore((s) => s.activeNodeId);
  const edgeConflicts = useGraphStore((s) => s.edgeConflicts);

  const presets = useCustomNodeStore((s) => s.presets);
  const createPendingFromPreset = useCustomNodeStore((s) => s.createPendingFromPreset);

  const nodes = graph?.nodes ?? [];
  const conflicts = edgeConflicts ?? [];

  const getNodeStatus = (nodeId: string): 'idle' | 'thinking' | 'done' | 'conflict' => {
    if (activeNodeId === nodeId) return 'thinking';
    if (nodeOutputs[nodeId]) return 'done';
    const hasConflict = conflicts.some((c) => c.from === nodeId || c.to === nodeId);
    if (hasConflict) return 'conflict';
    return 'idle';
  };

  return (
    <aside className="w-[220px] min-w-[220px] flex flex-col bg-chamber border-r border-border overflow-hidden">
      <div className="zone-header px-3.5 pt-3 pb-2 border-b border-border">
        <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ghost">
          Agent Roster
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {/* Active agents */}
        {nodes.length === 0 ? (
          <div className="text-xs text-muted text-center py-8 italic">
            Submit a query to assemble the council
          </div>
        ) : (
          nodes.map((node) => {
            const status = getNodeStatus(node.id);
            const output = nodeOutputs[node.id];
            const color = NODE_COLORS[node.color] ?? NODE_COLORS.indigo;
            const isCustom = node.id.startsWith('custom_');

            const statusDotClass =
              status === 'thinking' ? 'bg-signal animate-pulse' :
              status === 'done' ? 'bg-green-400' :
              status === 'conflict' ? 'bg-warn' :
              'bg-border';

            const cardBorderClass =
              status === 'thinking' ? 'border-signal shadow-[0_0_12px_rgba(34,211,238,0.12)]' :
              status === 'conflict' ? 'border-warn animate-conflict-pulse' :
              isCustom ? 'border-dashed border-pulse' :
              'border-border';

            return (
              <div
                key={node.id}
                className={`flex items-center gap-2.5 p-2 mb-1.5 border rounded-md bg-surface-raised transition-all ${cardBorderClass}`}
              >
                <div className={`relative w-7 h-7 rounded-full flex items-center justify-center font-mono text-[11px] font-semibold text-white flex-shrink-0 ${status === 'thinking' ? 'animate-breathing' : ''}`}
                  style={{ backgroundColor: color }}
                >
                  {node.label.charAt(0).toUpperCase()}
                  {isCustom && (
                    <span className="absolute -top-1 -right-1 text-[8px] text-ghost">✎</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display text-xs font-semibold text-white truncate">
                    {node.label}
                  </div>
                  <div className="text-[10px] text-ghost truncate">
                    {output ? `${output.confidence}% confidence` : node.role}
                  </div>
                </div>
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass}`} />
              </div>
            );
          })
        )}

        {/* Divider */}
        {presets.length > 0 && nodes.length > 0 && (
          <div className="my-3 border-t border-border" />
        )}

        {/* My Agents presets */}
        {presets.length > 0 && (
          <div>
            <div className="px-1 mb-2">
              <span className="font-display text-[9px] font-semibold uppercase tracking-widest text-muted">
                My Agents
              </span>
            </div>
            {presets.map((preset, i) => (
              <div
                key={preset.id ?? i}
                onClick={() => createPendingFromPreset(preset)}
                className="flex items-center gap-2 px-2 py-1.5 mb-1 text-xs text-ghost rounded-sm cursor-pointer hover:text-white hover:bg-surface-hover transition-colors"
              >
                <span className="text-pulse font-bold">+</span>
                <span className="truncate">{preset.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
