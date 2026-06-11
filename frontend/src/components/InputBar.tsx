import React, { useState } from 'react';
import { useGraphStore } from '../stores/graphStore';

interface InputBarProps {
  onAnalyze?: (query: string) => void;
}

export const InputBar: React.FC<InputBarProps> = ({ onAnalyze }) => {
  const [query, setQuery] = useState('');
  const status = useGraphStore((s) => s.status);
  const setQueryStore = useGraphStore((s) => s.setQuery);

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed || status === 'analyzing' || status === 'planning') return;

    setQueryStore(trimmed);
    onAnalyze?.(trimmed);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isDisabled = status === 'analyzing' || status === 'planning';

  return (
    <footer className="h-14 flex items-center gap-2 px-4 bg-chamber border-t border-border flex-shrink-0">
      <svg className="w-4 h-4 text-ghost flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe a situation or ask the council..."
        disabled={isDisabled}
        className="flex-1 h-9 px-3 bg-void border border-border rounded-md text-white font-body text-[13px] outline-none placeholder:text-muted focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] disabled:opacity-40 transition-colors"
      />
      <button
        onClick={handleSubmit}
        disabled={isDisabled || !query.trim()}
        className="w-9 h-9 flex items-center justify-center bg-pulse rounded-md text-white hover:bg-[#5558E6] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </footer>
  );
};
