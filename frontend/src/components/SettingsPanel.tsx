import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

// Fallback shown if /api/sources can't be reached — kept in sync with
// backend/app/services/live_sources.py CURATED_SOURCES.
const FALLBACK_CATEGORIES: Record<string, { name: string }[]> = {
  students: [{ name: 'Wikipedia' }, { name: 'arXiv' }, { name: 'dev.to' }, { name: 'GitHub' }],
  researchers: [{ name: 'arXiv' }, { name: 'Semantic Scholar' }, { name: 'OpenAlex' }, { name: 'Crossref' }, { name: 'PubMed' }],
  finance: [{ name: 'SEC EDGAR' }, { name: 'CoinGecko' }, { name: 'MarketWatch' }, { name: 'Federal Reserve' }],
  tech_news: [{ name: 'Hacker News' }, { name: 'NVD' }, { name: 'dev.to' }, { name: 'GitHub' }],
  world_news: [{ name: 'GDELT' }, { name: 'BBC News' }, { name: 'Wikipedia' }],
  legal: [{ name: 'CourtListener' }, { name: 'GDELT' }],
};

const CATEGORY_LABELS: Record<string, string> = {
  students: 'Students',
  researchers: 'Researchers',
  finance: 'Finance & Markets',
  tech_news: 'Tech News',
  world_news: 'World News',
  legal: 'Legal',
};

export const SettingsPanel: React.FC = () => {
  const isOpen = useSettingsStore((s) => s.isSettingsOpen);
  const setOpen = useSettingsStore((s) => s.setSettingsOpen);

  const llmBaseUrl = useSettingsStore((s) => s.llmBaseUrl);
  const setLlmBaseUrl = useSettingsStore((s) => s.setLlmBaseUrl);
  const llmApiKey = useSettingsStore((s) => s.llmApiKey);
  const setLlmApiKey = useSettingsStore((s) => s.setLlmApiKey);
  const llmModelName = useSettingsStore((s) => s.llmModelName);
  const setLlmModelName = useSettingsStore((s) => s.setLlmModelName);

  const researchEnabled = useSettingsStore((s) => s.researchEnabled);
  const setResearchEnabled = useSettingsStore((s) => s.setResearchEnabled);
  const researchCategories = useSettingsStore((s) => s.researchCategories);
  const toggleResearchCategory = useSettingsStore((s) => s.toggleResearchCategory);
  const customUrls = useSettingsStore((s) => s.customUrls);
  const addCustomUrl = useSettingsStore((s) => s.addCustomUrl);
  const removeCustomUrl = useSettingsStore((s) => s.removeCustomUrl);

  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);
  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/sources')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.categories) setCategories(data.categories);
      })
      .catch(() => {
        /* keep fallback list */
      });
  }, [isOpen]);

  const handleAddUrl = () => {
    const trimmed = urlInput.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      setUrlError('Enter a full http:// or https:// URL');
      return;
    }
    if (customUrls.length >= 5) {
      setUrlError('Up to 5 custom URLs at a time');
      return;
    }
    addCustomUrl(trimmed);
    setUrlInput('');
    setUrlError('');
  };

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
            {/* LLM Endpoint */}
            <div>
              <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                LLM Endpoint
              </label>
              <p className="text-[10px] text-muted mt-0.5 mb-2">
                Local by default. Paste any OpenAI-compatible URL instead — a
                tunneled Kaggle/Colab endpoint (ngrok, cloudflared), or a
                hosted provider — plus a key if it requires one.
              </p>

              <div className="space-y-2">
                <div>
                  <label className="text-[9px] text-ghost uppercase tracking-wider">Base URL</label>
                  <input
                    type="text"
                    value={llmBaseUrl}
                    onChange={(e) => setLlmBaseUrl(e.target.value)}
                    placeholder="http://localhost:8000/v1"
                    className="w-full mt-1 h-9 px-3 text-[12px] bg-void border border-border rounded-md text-white placeholder:text-muted outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] transition-colors font-mono"
                  />
                </div>

                <div>
                  <label className="text-[9px] text-ghost uppercase tracking-wider">API Key (optional)</label>
                  <input
                    type="password"
                    value={llmApiKey}
                    onChange={(e) => setLlmApiKey(e.target.value)}
                    placeholder="only needed for cloud/tunneled endpoints"
                    className="w-full mt-1 h-9 px-3 text-[12px] bg-void border border-border rounded-md text-white placeholder:text-muted outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] transition-colors font-mono"
                  />
                </div>

                <div>
                  <label className="text-[9px] text-ghost uppercase tracking-wider">Model name (optional)</label>
                  <input
                    type="text"
                    value={llmModelName}
                    onChange={(e) => setLlmModelName(e.target.value)}
                    placeholder="qwen2.5-1.5b-instruct-q4_k_m.gguf"
                    className="w-full mt-1 h-9 px-3 text-[12px] bg-void border border-border rounded-md text-white placeholder:text-muted outline-none focus:border-pulse focus:shadow-[0_0_0_1px_#6366F1] transition-colors font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Live Research (real-time data) */}
            <div>
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-[9px] text-ghost font-semibold uppercase tracking-wider">
                    Live Research
                  </label>
                  <p className="text-[10px] text-muted mt-0.5">
                    Pull real-time context from free sources before analysis.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={researchEnabled}
                  onClick={() => setResearchEnabled(!researchEnabled)}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                    researchEnabled ? 'bg-pulse' : 'bg-border'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      researchEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {researchEnabled && (
                <div className="mt-3 space-y-3">
                  {/* Curated category picker */}
                  <div>
                    <p className="text-[9px] text-ghost uppercase tracking-wider mb-1.5">
                      Curated sources
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.keys(categories).map((cat) => {
                        const active = researchCategories.includes(cat);
                        return (
                          <button
                            key={cat}
                            onClick={() => toggleResearchCategory(cat)}
                            title={categories[cat]?.map((s) => s.name).join(', ')}
                            className={`px-2 py-1 rounded text-[10px] border transition-colors ${
                              active
                                ? 'border-pulse bg-surface-raised text-white'
                                : 'border-border bg-void text-muted hover:border-pulse/40'
                            }`}
                          >
                            {CATEGORY_LABELS[cat] || cat}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Custom URL input */}
                  <div>
                    <p className="text-[9px] text-ghost uppercase tracking-wider mb-1.5">
                      Custom URL
                    </p>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={urlInput}
                        onChange={(e) => { setUrlInput(e.target.value); setUrlError(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddUrl(); }}
                        placeholder="https://example.com/feed"
                        className="flex-1 min-w-0 bg-void border border-border rounded px-2 py-1.5 text-[11px] text-white placeholder-muted focus:outline-none focus:border-pulse/60"
                      />
                      <button
                        onClick={handleAddUrl}
                        className="px-2.5 py-1.5 rounded border border-border bg-surface-raised text-[10px] text-white hover:border-pulse/40"
                      >
                        Add
                      </button>
                    </div>
                    {urlError && (
                      <p className="text-[10px] text-red-400 mt-1">{urlError}</p>
                    )}
                    {customUrls.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {customUrls.map((url) => (
                          <li
                            key={url}
                            className="flex items-center justify-between gap-2 bg-void border border-border rounded px-2 py-1"
                          >
                            <span className="text-[10px] text-muted truncate">{url}</span>
                            <button
                              onClick={() => removeCustomUrl(url)}
                              className="text-ghost hover:text-white text-[10px] flex-shrink-0"
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
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
                    Leave the LLM endpoint blank to use the local llama.cpp
                    server at <code className="text-white">http://localhost:8000</code>,
                    or set a URL above to use a tunneled or cloud-hosted model instead.
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
