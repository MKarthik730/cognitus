import React from 'react';
import { useGraphStore } from '../stores/graphStore';

/**
 * Live visual for whether the action layer is allowed to fire — locked
 * while any deterministic check or claim match is still pending/failing,
 * unlocked only once verdict_synthesizer's hardcoded gate says so.
 */
export const GateIndicator: React.FC = () => {
  const gateStatus = useGraphStore((s) => s.gateStatus);
  const gateReason = useGraphStore((s) => s.gateReason);

  const isUnlocked = gateStatus === 'unlocked';
  const isLocked = gateStatus === 'locked';

  const label = isUnlocked ? 'Gate Unlocked' : isLocked ? 'Gate Locked' : 'Gate Pending';
  const color = isUnlocked ? 'text-green-400' : isLocked ? 'text-red-400' : 'text-ghost';
  const ring = isUnlocked ? 'border-green-400/40 bg-green-400/10' : isLocked ? 'border-red-400/40 bg-red-400/10' : 'border-border bg-void';

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors duration-500 ${ring}`}
      title={gateReason ?? 'Waiting for deterministic checks and claim matches to complete.'}
    >
      <svg
        className={`w-3.5 h-3.5 flex-shrink-0 transition-colors duration-500 ${color}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        {isUnlocked ? (
          <>
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 9.9-1" />
          </>
        ) : (
          <>
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </>
        )}
      </svg>
      <span className={`text-[9px] font-mono font-semibold uppercase tracking-wider ${color}`}>
        {label}
      </span>
    </div>
  );
};
