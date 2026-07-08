import React from 'react';
import { useSettingsStore } from '../stores/settingsStore';

const LLM_MODES = [
  { value: 'free', label: 'Free', desc: 'Groq / Google Gemini (rate-limited)' },
  { value: 'local', label: 'Local', desc: 'Ollama (run locally)' },
  { value: 'paid', label: 'Paid', desc: 'OpenAI / Anthropic (your own key)' },
  { value: 'browser', label: 'Browser', desc: 'Browser-based (experimental)' },
];

export const SettingsPanel: React.FC = () => {
  const isOpen = useSettingsStore((s) => s.isSettingsOpen);
  const setOpen = useSettingsStore((s) => s.setSettingsOpen);
  const groqApiKey = useSettingsStore((s) => s.groqApiKey);
  const setGroqApiKey = useSettingsStore((s) => s.setGroqApiKey);
  const llmMode = useSettingsStore((s) => s.llmMode);
  const setLlmMode = useSettingsStore((s) => s.setLlmMode);

  const handleClose = () => setOpen(false);

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={handleClose}
        />
      )}

      {/* Slide-in panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[380px] bg-chamber border-l border-border z-50 transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 h-12 border-b border-border">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-ghost" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <h2 className="font-display text-sm font-semibold text-white">
                Settings
              </h2>
            </div>
            <button
              onClick={handleClose}
              className="w-6 h-6 flex items-center justify-center text-ghost hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
            {/* LLM Mode */}
            <div>
              <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                LLM Provider
              </label>
              <p className="text-[10px] text-muted mt-0.5 mb-2">
                Choose which AI backend powers the council.
              </p>
              <div className="space-y-1.5">
                {LLM_MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setLlmMode(m.value)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md border text-left transition-all ${
                      llmMode === m.value
                        ? 'border-pulse bg-surface-raised shadow-[0_0_8px_rgba(99,102,241,0.1)]'
                        : 'border-border bg-void hover:border-pulse/40'
                    }`}
                  >
                    <span
                      className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                        llmMode === m.value ? 'border-pulse' : 'border-muted'
                      }`}
                    >
                      {llmMode === m.value && (
                        <span className="w-1.5 h-1.5 rounded-full bg-pulse" />
                      )}
                    </span>
                    <div>
                      <span className="text-[12px] font-medium text-white">
                        {m.label}
                      </span>
                      <p className="text-[10px] text-muted">{m.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Groq API Key */}
            <div>
              <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                Groq API Key
              </label>
              <p className="text-[10px] text-muted mt-0.5 mb-2">
                Required for the <strong className="text-white">Free</strong> provider tier. Get yours at{' '}
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-pulse hover:underline"
                >
                  console.groq.com
                </a>
              </p>
              <div className="relative">
                <input
                  type="password"
                  value={groqApiKey}
                  onChange={(e) => setGroqApiKey(e.target.value)}
                  placeholder="gsk_..."
                  className="w-full h-9 px-3 pr-9 text-[12px] bg-void border border-border rounded-md text-white placeholder:text-muted outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] transition-colors font-mono"
                />
                {groqApiKey && (
                  <button
                    onClick={() => setGroqApiKey('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ghost hover:text-white transition-colors"
                    title="Clear key"
                  >
                    ✕
                  </button>
                )}
              </div>
              {groqApiKey && (
                <p className="text-[10px] text-green-400 mt-1">
                  ✓ Key stored locally and will be sent with each analysis
                </p>
              )}
            </div>

            <div className="h-px bg-border" />

            {/* Info */}
            <div className="bg-void border border-border rounded-md px-3 py-2.5">
              <div className="flex items-start gap-2">
                <svg className="w-3.5 h-3.5 text-ghost mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <div>
                  <p className="text-[10px] text-ghost leading-relaxed">
                    API keys are stored in your browser's localStorage and are
                    never saved on the server. They are sent securely with each
                    analysis request.
                  </p>
                  <p className="text-[10px] text-ghost leading-relaxed mt-1">
                    Other providers (OpenAI, Anthropic) can be configured via
                    the server's <code className="text-white">.env</code> file.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
