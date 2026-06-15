import React, { useState } from 'react';
import { useGraphStore } from '../stores/graphStore';
import type { AnalysisMode, ModeCard } from '../types';

const MODES: ModeCard[] = [
  { id: 'standard', icon: '⚖️', name: 'Standard', description: '', example: '' },
  { id: 'pre_mortem', icon: '🎯', name: 'Pre-Mortem', description: '', example: '' },
  { id: 'signal_vs_noise', icon: '🔬', name: 'Signal vs Noise', description: '', example: '' },
  { id: 'debate', icon: '⚔️', name: 'Debate', description: '', example: '' },
  { id: 'reverse_engineer', icon: '🏗️', name: 'Reverse Engineer', description: '', example: '' },
  { id: 'iceberg', icon: '🧊', name: 'Iceberg Report', description: '', example: '' },
  { id: 'cascade', icon: '🌊', name: 'Cascade Mapper', description: '', example: '' },
];

interface ModeSelectorProps {
  onAnalyze?: (query: string) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({ onAnalyze }) => {
  const setMode = useGraphStore((s) => s.setMode);
  const mode = useGraphStore((s) => s.mode);
  const [query, setQuery] = useState('');

  const handleModeSelect = (selected: AnalysisMode) => {
    setMode(selected);
  };

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setQuery('');
    onAnalyze?.(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto p-8">
      {/* Hero */}
      <div className="text-center mb-8 max-w-lg">
        <div className="flex items-center justify-center gap-2 mb-4">
          <svg className="w-8 h-8 text-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
            <circle cx="6" cy="6" r="1.5" fill="currentColor" />
            <circle cx="18" cy="6" r="1.5" fill="currentColor" />
            <circle cx="6" cy="18" r="1.5" fill="currentColor" />
            <circle cx="18" cy="18" r="1.5" fill="currentColor" />
          </svg>
          <h1 className="font-display text-3xl font-bold text-white tracking-tight">
            What shall we deliberate?
          </h1>
        </div>
      </div>

      {/* Mode pills */}
      <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg mb-8">
        {MODES.map((modeCard) => {
          const isActive = mode === modeCard.id;
          return (
            <button
              key={modeCard.id}
              onClick={() => handleModeSelect(modeCard.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                isActive
                  ? 'bg-pulse text-white border-pulse shadow-[0_0_8px_rgba(99,102,241,0.25)]'
                  : 'text-ghost border-border hover:text-white hover:border-pulse/40'
              }`}
            >
              <span className="text-sm">{modeCard.icon}</span>
              {modeCard.name}
            </button>
          );
        })}
      </div>

      {/* Input area */}
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 p-1.5 rounded-lg border border-border bg-chamber focus-within:border-pulse focus-within:shadow-[0_0_0_1px_#6366F1] transition-all">
          <svg className="w-4 h-4 text-ghost flex-shrink-0 ml-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a situation or ask the council..."
            className="flex-1 h-10 bg-transparent text-white font-body text-[14px] outline-none placeholder:text-muted"
          />
          <button
            onClick={handleSubmit}
            disabled={!query.trim()}
            className="h-10 px-4 flex items-center gap-1.5 bg-pulse rounded-md text-white text-xs font-medium hover:bg-[#5558E6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            Enter
          </button>
        </div>
        <p className="text-[10px] text-muted text-center mt-2">
          Selected: <span className="text-pulse font-semibold">{mode.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
        </p>
      </div>
    </div>
  );
};
