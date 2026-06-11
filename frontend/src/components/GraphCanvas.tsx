import React, { useMemo, useRef, useState, useCallback } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { NODE_COLORS } from '../utils/colors';
import type { GraphNode } from '../types';

interface RenderNode extends GraphNode {
  x: number;
  y: number;
}

// Layout: arrange nodes in a layered DAG layout
function layoutNodes(nodes: GraphNode[], edges: { from: string; to: string }[]): RenderNode[] {
  if (nodes.length === 0) return [];

  // Build adjacency
  const inDegree: Record<string, number> = {};
  const children: Record<string, string[]> = {};
  nodes.forEach((n) => {
    inDegree[n.id] = 0;
    children[n.id] = [];
  });
  edges.forEach((e) => {
    if (inDegree[e.to] !== undefined) inDegree[e.to]++;
    if (children[e.from]) children[e.from].push(e.to);
  });

  // Topological sort for layers
  const layers: string[][] = [];
  const visited = new Set<string>();

  const queue = nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id);
  while (queue.length > 0) {
    const layer: string[] = [];
    const next: string[] = [];
    for (const id of queue) {
      if (visited.has(id)) continue;
      visited.add(id);
      layer.push(id);
      for (const child of children[id] || []) {
        if (!visited.has(child)) next.push(child);
      }
    }
    if (layer.length > 0) layers.push(layer);
    queue.length = 0;
    queue.push(...next);
  }

  // Add any remaining nodes not in the topological order
  const remaining = nodes.filter((n) => !visited.has(n.id)).map((n) => n.id);
  if (remaining.length > 0) layers.push(remaining);

  const padding = 80;
  const layerGap = 220;
  const colGap = 180;
  const totalW = 800;
  const totalH = 500;

  const result: RenderNode[] = [];
  layers.forEach((layer, li) => {
    const count = layer.length;
    const startY = (totalH - (count - 1) * colGap) / 2;
    layer.forEach((id, ci) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      result.push({
        ...node,
        x: padding + li * layerGap + (totalW - layerGap * layers.length) / 2,
        y: startY + ci * colGap,
      });
    });
  });

  return result;
}

// Bezier curve path between two points
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2;
  return `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
}

export const GraphCanvas: React.FC = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const graph = useGraphStore((s) => s.graph);
  const nodeOutputs = useGraphStore((s) => s.nodeOutputs);
  const activeNodeId = useGraphStore((s) => s.activeNodeId);
  const edgeConflicts = useGraphStore((s) => s.edgeConflicts);
  const [selectedNode, setSelectedNode] = useState<RenderNode | null>(null);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];

  const renderedNodes = useMemo(() => layoutNodes(nodes, edges), [nodes, edges]);

  const nodePositions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    renderedNodes.forEach((n) => { map[n.id] = { x: n.x, y: n.y }; });
    return map;
  }, [renderedNodes]);

  const conflictNodeIds = useMemo(() => {
    const set = new Set<string>();
    edgeConflicts.forEach((c) => { set.add(c.from); set.add(c.to); });
    return set;
  }, [edgeConflicts]);

  const handleNodeClick = useCallback((node: RenderNode) => {
    setSelectedNode(node === selectedNode ? null : node);
  }, [selectedNode]);

  const handleClosePopover = useCallback(() => {
    setSelectedNode(null);
  }, []);

  if (!graph || nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <svg className="w-12 h-12 text-border mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <p className="font-body text-sm text-ghost">Waiting for the council to assemble...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      <svg
        ref={svgRef}
        className="w-full h-full"
        viewBox="0 0 900 600"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Edge arrow marker */}
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#1E2D45" />
          </marker>
          <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#6366F1" />
          </marker>
          <marker id="arrowhead-conflict" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#F59E0B" />
          </marker>

          {/* Glow filter */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-strong">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Ripple radial gradient */}
          <radialGradient id="rippleGrad">
            <stop offset="0%" stopColor="#6366F1" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Background grid */}
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#0F1520" strokeWidth="0.5" />
        </pattern>
        <rect width="900" height="600" fill="url(#grid)" />

        {/* Edges */}
        {edges.map((edge) => {
          const from = nodePositions[edge.from];
          const to = nodePositions[edge.to];
          if (!from || !to) return null;

          const isConflict = edgeConflicts.some(
            (c) => (c.from === edge.from && c.to === edge.to)
          );
          const isActive = activeNodeId === edge.from || activeNodeId === edge.to;
          const hasData = nodeOutputs[edge.from] && nodeOutputs[edge.to];

          const strokeColor = isConflict
            ? '#F59E0B'
            : isActive
            ? '#6366F1'
            : '#1E2D45';
          const strokeWidth = isConflict ? 2.5 : isActive ? 2 : 1.5;
          const markerEnd = isConflict
            ? 'url(#arrowhead-conflict)'
            : isActive
            ? 'url(#arrowhead-active)'
            : 'url(#arrowhead)';

          return (
            <g key={`${edge.from}-${edge.to}`}>
              <path
                d={edgePath(from.x + 80, from.y + 30, to.x + 80, to.y + 30)}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                markerEnd={markerEnd}
                className={hasData ? 'transition-colors duration-500' : ''}
              />
              {/* Flow particles when data is flowing */}
              {(isActive || hasData) && (
                <path
                  d={edgePath(from.x + 80, from.y + 30, to.x + 80, to.y + 30)}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={1.5}
                  strokeDasharray="4 6"
                  className="animate-flow-particles"
                  opacity={0.6}
                />
              )}
              {/* Conflict icon */}
              {isConflict && (
                <text
                  x={(from.x + to.x) / 2 + 80}
                  y={(from.y + to.y) / 2 + 30}
                  textAnchor="middle"
                  fontSize="14"
                  fill="#F59E0B"
                >
                  ⚡
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {renderedNodes.map((node) => {
          const isActive = activeNodeId === node.id;
          const isDone = !!nodeOutputs[node.id];
          const isConflict = conflictNodeIds.has(node.id);
          const isCustom = node.id.startsWith('custom_');
          const output = nodeOutputs[node.id];
          const color = NODE_COLORS[node.color] ?? NODE_COLORS.indigo;
          const cx = node.x + 80;
          const cy = node.y + 30;

          const nodeFill = isDone ? color : '#131B2A';
          const nodeStroke = isActive
            ? '#22D3EE'
            : isConflict
            ? '#F59E0B'
            : isDone
            ? color
            : '#1E2D45';
          const strokeDash = isCustom ? '5 3' : 'none';
          const glowFilter = isActive ? 'url(#glow-strong)' : isDone ? 'url(#glow)' : undefined;

          return (
            <g
              key={node.id}
              onClick={() => handleNodeClick(node)}
              className="cursor-pointer transition-opacity"
              style={{ cursor: 'pointer' }}
            >
              {/* Breathing glow ring when active */}
              {isActive && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={38}
                  fill="none"
                  stroke="#22D3EE"
                  strokeWidth={1}
                  opacity={0.3}
                  className="animate-ping"
                />
              )}

              {/* Ripple on completion */}
              {isDone && !isActive && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={38}
                  fill="none"
                  stroke={color}
                  strokeWidth={0.5}
                  opacity={0.2}
                  className="animate-ripple"
                />
              )}

              {/* Node body */}
              <rect
                x={node.x}
                y={node.y}
                width={160}
                height={60}
                rx={8}
                ry={8}
                fill={nodeFill}
                stroke={nodeStroke}
                strokeWidth={isActive ? 2 : 1.5}
                strokeDasharray={strokeDash}
                filter={glowFilter}
                className={`transition-all duration-500 ${!isActive && !isDone ? 'hover:stroke-pulse/50' : ''}`}
              />

              {/* Color strip on top */}
              <rect
                x={node.x}
                y={node.y}
                width={160}
                height={3}
                rx={0}
                fill={color}
                opacity={isDone ? 1 : 0.4}
              />

              {/* Custom node indicator */}
              {isCustom && (
                <text x={node.x + 8} y={node.y + 16} fontSize="10" fill="#94A3B8" fontFamily="JetBrains Mono">
                  ✎
                </text>
              )}

              {/* Node label */}
              <text
                x={cx}
                y={cy - 2}
                textAnchor="middle"
                fill={isDone ? '#FFFFFF' : '#94A3B8'}
                fontSize="12"
                fontFamily="Space Grotesk, sans-serif"
                fontWeight="600"
              >
                {node.label.length > 18 ? node.label.slice(0, 17) + '…' : node.label}
              </text>

              {/* Status indicator */}
              {isActive && (
                <text
                  x={cx}
                  y={cy + 14}
                  textAnchor="middle"
                  fill="#22D3EE"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                  className="animate-pulse"
                >
                  Analyzing...
                </text>
              )}
              {isDone && output && (
                <text
                  x={cx}
                  y={cy + 14}
                  textAnchor="middle"
                  fill="#94A3B8"
                  fontSize="9"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {output.confidence}% · {output.verdict.slice(0, 24)}{output.verdict.length > 24 ? '…' : ''}
                </text>
              )}

              {/* Connection dots */}
              <circle cx={node.x + 80} cy={node.y} r={3} fill="#1E2D45" />
              <circle cx={node.x + 80} cy={node.y + 60} r={3} fill="#1E2D45" />
            </g>
          );
        })}
      </svg>

      {/* Obsidian-style popover (rendered inline) */}
      {selectedNode && (
        <NodePopoverContent
          node={selectedNode}
          output={selectedNode.id ? nodeOutputs[selectedNode.id] : undefined}
          onClose={handleClosePopover}
        />
      )}
    </div>
  );
};

// Inline popover component rendered as an overlay
interface NodePopoverContentProps {
  node: RenderNode;
  output?: {
    output: string;
    confidence: number;
    verdict: string;
    sentiment: string;
    reasoning?: string;
    keyPoints?: string[];
  };
  onClose: () => void;
}

const NodePopoverContent: React.FC<NodePopoverContentProps> = ({ node, output, onClose }) => {
  const color = NODE_COLORS[node.color] ?? NODE_COLORS.indigo;
  const isCustom = node.id.startsWith('custom_');

  const confidenceWidth = output ? `${Math.round(output.confidence)}%` : '--';
  const confidenceColor = output
    ? output.confidence >= 70
      ? 'bg-green-500'
      : output.confidence >= 40
      ? 'bg-amber-500'
      : 'bg-red-500'
    : 'bg-border';

  const keyPoints = output?.keyPoints ?? [];
  const reasoning = output?.reasoning ?? output?.output ?? '';

  return (
    <div
      className="absolute bottom-4 right-4 w-[340px] max-h-[420px] bg-chamber border border-border rounded-lg shadow-2xl z-50 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-border">
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
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center text-ghost hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Confidence bar */}
      <div className="px-3.5 py-2.5 border-b border-border">
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
            style={{ width: confidenceWidth === '--' ? '0%' : confidenceWidth }}
          />
        </div>
      </div>

      {/* Reasoning / content */}
      <div className="px-3.5 py-2.5 overflow-y-auto max-h-[200px]">
        <div className="text-[11px] text-ghost font-mono leading-relaxed whitespace-pre-wrap">
          {reasoning || 'Waiting for agent to report...'}
        </div>

        {/* Key points */}
        {keyPoints.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <span className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
              Key Points
            </span>
            <ul className="mt-1.5 space-y-1">
              {keyPoints.map((point, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-white group">
                  <span className="text-pulse mt-px">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Verdict */}
        {output?.verdict && (
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

      {/* Footer actions */}
      <div className="flex items-center gap-2 px-3.5 py-2 border-t border-border bg-void/50">
        <span className="text-[9px] text-ghost">
          Influenced by: {node.role === 'synthesizer' ? 'All agents' : 'Previous agent'}
        </span>
        <div className="flex-1" />
        {isCustom && (
          <button className="text-[10px] text-red-400 hover:text-red-300 transition-colors">
            Remove
          </button>
        )}
      </div>
    </div>
  );
};
