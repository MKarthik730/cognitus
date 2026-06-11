import React, { useState, useCallback } from 'react';
import { useGraphStore } from '../stores/graphStore';
import { useCustomNodeStore } from '../stores/customNodeStore';
import type { NodeRole, NodeColor } from '../types';

const ROLES: { value: NodeRole; label: string }[] = [
  { value: 'analyst', label: 'Analyst' },
  { value: 'critic', label: 'Critic' },
  { value: 'devil', label: "Devil's Advocate" },
  { value: 'synthesizer', label: 'Synthesizer' },
  { value: 'domain_expert', label: 'Domain Expert' },
  { value: 'emotional', label: 'Emotional' },
  { value: 'technical', label: 'Technical' },
  { value: 'custom', label: 'Custom' },
];

const COLORS: { value: NodeColor; label: string; hex: string }[] = [
  { value: 'indigo', label: 'Indigo', hex: '#6366F1' },
  { value: 'amber', label: 'Amber', hex: '#F59E0B' },
  { value: 'cyan', label: 'Cyan', hex: '#22D3EE' },
  { value: 'green', label: 'Green', hex: '#22C55E' },
  { value: 'red', label: 'Red', hex: '#EF4444' },
  { value: 'purple', label: 'Purple', hex: '#A855F7' },
];

export const CustomNodeBuilder: React.FC = () => {
  const isPanelOpen = useCustomNodeStore((s) => s.isPanelOpen);
  const setPanelOpen = useCustomNodeStore((s) => s.setPanelOpen);
  const pendingNode = useCustomNodeStore((s) => s.pendingNode);
  const savePreset = useCustomNodeStore((s) => s.savePreset);
  const resetPending = useCustomNodeStore((s) => s.resetPending);

  const graph = useGraphStore((s) => s.graph);
  const sessionId = useGraphStore((s) => s.sessionId);

  // Form state
  const [label, setLabel] = useState(pendingNode?.label ?? '');
  const [role, setRole] = useState<NodeRole>(pendingNode?.role ?? 'analyst');
  const [instruction, setInstruction] = useState(pendingNode?.instruction ?? '');
  const [bias, setBias] = useState(pendingNode?.bias ?? 0.5);
  const [confidenceThreshold, setConfidenceThreshold] = useState(
    pendingNode?.confidenceThreshold ?? 0.7
  );
  const [connectFrom, setConnectFrom] = useState(pendingNode?.connectFrom ?? graph?.nodes[0]?.id ?? 'distributor');
  const [connectTo, setConnectTo] = useState(pendingNode?.connectTo ?? 'synthesizer');
  const [color, setColor] = useState<NodeColor>(pendingNode?.color ?? 'indigo');
  const [saveAsPreset, setSaveAsPreset] = useState(false);

  // Sync form with pending node
  React.useEffect(() => {
    if (pendingNode) {
      setLabel(pendingNode.label ?? '');
      setRole(pendingNode.role ?? 'analyst');
      setInstruction(pendingNode.instruction ?? '');
      setBias(pendingNode.bias ?? 0.5);
      setConfidenceThreshold(pendingNode.confidenceThreshold ?? 0.7);
      setColor(pendingNode.color ?? 'indigo');
      if (pendingNode.connectFrom) setConnectFrom(pendingNode.connectFrom);
      if (pendingNode.connectTo) setConnectTo(pendingNode.connectTo);
    }
  }, [pendingNode]);

  const resetForm = useCallback(() => {
    setLabel('');
    setRole('analyst');
    setInstruction('');
    setBias(0.5);
    setConfidenceThreshold(0.7);
    setConnectFrom(graph?.nodes[0]?.id ?? 'distributor');
    setConnectTo('synthesizer');
    setColor('indigo');
    setSaveAsPreset(false);
    resetPending();
  }, [graph, resetPending]);

  const handleClose = useCallback(() => {
    setPanelOpen(false);
    resetForm();
  }, [setPanelOpen, resetForm]);

  const handleAdd = useCallback(async () => {
    if (!label.trim() || !instruction.trim()) return;

    const nodeData = {
      id: `custom_${Date.now()}`,
      label: label.trim(),
      instruction: instruction.trim(),
      role,
      color,
      bias,
      confidenceThreshold,
      connectFrom,
      connectTo,
    };

    // If saving as preset
    if (saveAsPreset) {
      await savePreset({
        label: label.trim(),
        instruction: instruction.trim(),
        role,
        color,
        bias,
        confidenceThreshold,
      });
    }

    // Inject into graph via API
    if (sessionId) {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/graph/inject-node/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ session_id: sessionId, node: nodeData }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.graph) {
            useGraphStore.getState().setGraph(data.graph);
          }
        }
      } catch (e) {
        console.warn('Failed to inject custom node:', e);
      }
    }

    handleClose();
  }, [
    label, instruction, role, color, bias, confidenceThreshold,
    connectFrom, connectTo, saveAsPreset, sessionId, savePreset, handleClose,
  ]);

  const existingNodes = graph?.nodes ?? [];

  return (
    <>
      {/* Overlay */}
      {isPanelOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={handleClose}
        />
      )}

      {/* Slide-in panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[380px] bg-chamber border-l border-border z-50 transform transition-transform duration-300 ease-out ${
          isPanelOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 h-12 border-b border-border">
            <h2 className="font-display text-sm font-semibold text-white">
              Add Your Own Perspective
            </h2>
            <button
              onClick={handleClose}
              className="w-6 h-6 flex items-center justify-center text-ghost hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {/* Name */}
            <div>
              <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                Name
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder='e.g. "Startup Founder"'
                maxLength={40}
                className="w-full mt-1 h-8 px-2.5 text-[12px] bg-void border border-border rounded-md text-white placeholder:text-muted outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] transition-colors"
              />
            </div>

            {/* Role */}
            <div>
              <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as NodeRole)}
                className="w-full mt-1 h-8 px-2.5 text-[12px] bg-void border border-border rounded-md text-white outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] transition-colors"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Instruction */}
            <div>
              <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                Behavior / Instruction
              </label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Analyze this from the lens of..."
                maxLength={300}
                rows={4}
                className="w-full mt-1 px-2.5 py-2 text-[12px] bg-void border border-border rounded-md text-white placeholder:text-muted outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] resize-none transition-colors"
              />
              <div className="text-right text-[9px] text-ghost mt-0.5">
                {instruction.length}/300
              </div>
            </div>

            {/* Bias slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                  Perspective Bias
                </label>
                <span className="text-[10px] text-white font-mono">
                  {bias <= 0.33 ? 'Optimistic' : bias <= 0.66 ? 'Balanced' : 'Pessimistic'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-ghost">Optimistic</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={bias}
                  onChange={(e) => setBias(parseFloat(e.target.value))}
                  className="flex-1 h-1 appearance-none bg-void rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-pulse [&::-webkit-slider-thumb]:cursor-pointer"
                />
                <span className="text-[9px] text-ghost">Pessimistic</span>
              </div>
            </div>

            {/* Confidence threshold */}
            <div>
              <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                Confidence Threshold
              </label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number"
                  value={Math.round(confidenceThreshold * 100)}
                  onChange={(e) => setConfidenceThreshold(Math.min(1, Math.max(0, parseInt(e.target.value) / 100)))}
                  min={0}
                  max={100}
                  className="w-16 h-8 px-2 text-[12px] text-center bg-void border border-border rounded-md text-white font-mono outline-none focus:border-pulse"
                />
                <span className="text-[10px] text-ghost">% minimum confidence to speak</span>
              </div>
            </div>

            {/* Connect From / Connect To */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                  Connect From
                </label>
                <select
                  value={connectFrom}
                  onChange={(e) => setConnectFrom(e.target.value)}
                  className="w-full mt-1 h-8 px-2 text-[11px] bg-void border border-border rounded-md text-white outline-none focus:border-pulse"
                >
                  {existingNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                  Connect To
                </label>
                <select
                  value={connectTo}
                  onChange={(e) => setConnectTo(e.target.value)}
                  className="w-full mt-1 h-8 px-2 text-[11px] bg-void border border-border rounded-md text-white outline-none focus:border-pulse"
                >
                  {existingNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Color picker */}
            <div>
              <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                Color
              </label>
              <div className="flex gap-2 mt-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setColor(c.value)}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                      color === c.value
                        ? 'ring-2 ring-white ring-offset-1 ring-offset-chamber scale-110'
                        : ''
                    }`}
                    style={{ backgroundColor: c.hex }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            {/* Save as preset toggle */}
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="save-preset"
                checked={saveAsPreset}
                onChange={(e) => setSaveAsPreset(e.target.checked)}
                className="w-3.5 h-3.5 accent-pulse"
              />
              <label htmlFor="save-preset" className="text-[11px] text-ghost cursor-pointer">
                Save as preset for future use
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border flex items-center gap-2">
            <button
              onClick={handleClose}
              className="flex-1 h-8 text-[11px] font-medium text-ghost border border-border rounded-md hover:text-white hover:border-pulse/40 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!label.trim() || !instruction.trim()}
              className="flex-1 h-8 text-[11px] font-medium text-white bg-pulse rounded-md hover:bg-[#5558E6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Add to Graph
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
