import React from 'react';
import { useGraphStore } from '../stores/graphStore';
import type { AnalysisMode, ModeCard } from '../types';

const MODES: ModeCard[] = [
  {
    id: 'pre_mortem',
    icon: '🎯',
    name: 'Pre-Mortem',
    description: 'Stress-test decisions before committing',
    example: '"Should I accept this job offer?"',
  },
  {
    id: 'signal_vs_noise',
    icon: '🔬',
    name: 'Signal vs Noise',
    description: 'Filter facts from noise for research',
    example: '"Is AI really a threat to humanity?"',
  },
  {
    id: 'debate',
    icon: '⚔️',
    name: 'Debate',
    description: 'Multi-perspective debate with moderator',
    example: '"Should social media be regulated?"',
  },
  {
    id: 'reverse_engineer',
    icon: '🏗️',
    name: 'Reverse Engineer',
    description: 'Trace outcomes back to root causes',
    example: '"Why did the startup fail after Series A?"',
  },
  {
    id: 'iceberg',
    icon: '🧊',
    name: 'Iceberg Report',
    description: 'Deep-dive beneath surface assumptions',
    example: '"What are the hidden risks in cloud migration?"',
  },
  {
    id: 'cascade',
    icon: '🌊',
    name: 'Cascade Mapper',
    description: 'Map second and third order effects',
    example: '"What happens if we mandate 4-day workweeks?"',
  },
];

interface ModeSelectorProps {
  onSelect?: (mode: AnalysisMode) => void;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({ onSelect }) => {
  const setMode = useGraphStore((s) => s.setMode);
  const mode = useGraphStore((s) => s.mode);

  const handleSelect = (selected: AnalysisMode) => {
    setMode(selected);
    onSelect?.(selected);
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
        <p className="font-body text-sm text-ghost leading-relaxed">
          Choose an analysis mode — each assembles a unique council of AI agents
          with different perspectives and expertise.
        </p>
      </div>

      {/* Mode cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-3xl w-full">
        {MODES.map((card) => {
          const isActive = mode === card.id;
          const borderClass = isActive
            ? 'border-pulse bg-surface-raised shadow-[0_0_12px_rgba(99,102,241,0.12)]'
            : 'border-border bg-chamber hover:border-pulse/40 hover:bg-surface-raised';

          return (
            <button
              key={card.id}
              onClick={() => handleSelect(card.id)}
              className={`group flex flex-col items-start gap-2 p-4 rounded-lg border text-left transition-all duration-200 ${borderClass}`}
            >
              <span className="text-xl">{card.icon}</span>
              <div>
                <h3 className="font-display text-sm font-semibold text-white group-hover:text-pulse transition-colors">
                  {card.name}
                </h3>
                <p className="font-body text-[11px] text-ghost leading-relaxed mt-0.5">
                  {card.description}
                </p>
              </div>
              <code className="text-[10px] text-muted font-mono italic mt-1">
                {card.example}
              </code>
              {isActive && (
                <span className="mt-1 text-[10px] font-semibold text-pulse uppercase tracking-wider">
                  Selected
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Fallback mode */}
      <div className="mt-5 flex items-center gap-2">
        <span className="text-xs text-ghost">Or use</span>
        <button
          onClick={() => handleSelect('standard')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
            mode === 'standard'
              ? 'bg-pulse text-white border-pulse'
              : 'text-ghost border-border hover:border-pulse/40 hover:text-white'
          }`}
        >
          Standard Analysis
        </button>
      </div>
    </div>
  );
};
