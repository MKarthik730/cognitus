import React from 'react';
import { useGraphStore } from '../stores/graphStore';
import { useCustomNodeStore } from '../stores/customNodeStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';

interface HeaderProps {
  onNewSession?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onNewSession }) => {
  const status = useGraphStore((s) => s.status);
  const activeNodeId = useGraphStore((s) => s.activeNodeId);
  const graph = useGraphStore((s) => s.graph);
  const setPanelOpen = useCustomNodeStore((s) => s.setPanelOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const logout = useAuthStore((s) => s.logout);
  const setAuthOpen = useAuthStore((s) => s.setAuthOpen);

  const nodeCount = graph?.nodes.length ?? 0;
  const statusColor =
    status === 'analyzing' ? 'text-signal border-signal' :
    status === 'complete' ? 'text-green-400 border-green-400' :
    status === 'error' ? 'text-red-400 border-red-400' :
    'text-ghost border-border';

  const statusLabel =
    status === 'idle' ? 'Ready' :
    status === 'planning' ? 'Planning' :
    status === 'analyzing' ? 'Analyzing' :
    status === 'complete' ? 'Complete' : 'Error';

  return (
    <header className="h-12 flex items-center px-4 bg-chamber border-b border-border flex-shrink-0 gap-4">
      {/* Brand */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <svg className="w-[18px] h-[18px] text-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span className="font-display text-sm font-semibold text-white tracking-wide lowercase">
          council
        </span>
      </div>

      {status !== 'idle' && (
        <button
          onClick={onNewSession}
          title="Back to start — new session"
          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-ghost hover:text-white transition-colors flex-shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          New Session
        </button>
      )}

      <div className="w-px h-5 bg-border flex-shrink-0" />

      {/* Session */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="font-display text-xs font-medium text-white">
          Deliberation Session
        </span>
        <span className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 border rounded-sm ${statusColor}`}>
          <span className="w-[5px] h-[5px] rounded-full bg-current" />
          {statusLabel}
        </span>
      </div>

      {/* Agent count */}
      <div className="flex items-center gap-1 text-[11px] text-ghost font-mono px-2 py-0.5 border border-border rounded-sm">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span className="text-white font-semibold">{nodeCount}</span> agents
      </div>

      <div className="flex-1" />

      {/* Controls */}
      <div className="flex items-center gap-2">
        {activeNodeId && (
          <span className="flex items-center gap-1.5 text-[10px] text-signal font-semibold animate-pulse">
            <span className="w-2 h-2 rounded-full bg-signal animate-ping" />
            {activeNodeId} thinking...
          </span>
        )}

        {/* Settings button */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-ghost border border-border rounded-sm hover:border-pulse hover:text-white transition-colors"
          title="Local model settings"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </button>

        <button
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-ghost border border-border rounded-sm hover:border-pulse hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Agent
        </button>

        <button
          onClick={() => { logout(); setAuthOpen(true); onNewSession?.(); }}
          title="Log out"
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-ghost border border-border rounded-sm hover:border-red-400 hover:text-red-300 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Log Out
        </button>
      </div>
    </header>
  );
};
