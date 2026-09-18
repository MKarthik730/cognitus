import React, { useEffect } from 'react';
import { useGraphStore } from './stores/graphStore';
import { useAuthStore } from './stores/authStore';
import { useSettingsStore } from './stores/settingsStore';
import { useWebSocket } from './hooks/useWebSocket';
import { Header } from './components/Header';
import { AgentRoster } from './components/AgentRoster';
import { GraphCanvas } from './components/GraphCanvas';
import { SynthesisPanel } from './components/SynthesisPanel';
import { VerdictScorecardPanel } from './components/VerdictScorecardPanel';
import { InputBar } from './components/InputBar';
import { CustomNodeBuilder } from './components/CustomNodeBuilder';
import { NodePopover } from './components/NodePopover';
import { ModeSelector } from './components/ModeSelector';
import { SettingsPanel } from './components/SettingsPanel';
import { AuthModal } from './components/AuthModal';
import { isSpecialMode, specialModeGraph } from './utils/specialModes';

const App: React.FC = () => {
  const status = useGraphStore((s) => s.status);
  const setStatus = useGraphStore((s) => s.setStatus);
  const setGraph = useGraphStore((s) => s.setGraph);
  const setSessionId = useGraphStore((s) => s.setSessionId);
  const mode = useGraphStore((s) => s.mode);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const token = useAuthStore((s) => s.token);
  const initAuth = useAuthStore((s) => s.initAuth);

  const ws = useWebSocket();

  // Load auth + settings on mount
  useEffect(() => {
    initAuth();
    loadSettings();
  }, [initAuth, loadSettings]);

  const handleAnalyze = async (q: string) => {
    // Reset previous session state
    useGraphStore.getState().reset();
    ws.disconnect();
    setStatus('planning');

    try {
      const sid = `session_${Date.now()}`;
      setSessionId(sid);
      useGraphStore.getState().setQuery(q);

      // Verdict takes a PR URL, not free-text situation — its own payload
      // shape and its own `mode: "verdict"` field for the backend's
      // websocket dispatch (see backend/app/api/websocket.py).
      if (mode === 'verdict') {
        setGraph(specialModeGraph('verdict')!);
        setStatus('analyzing');
        const { githubToken } = useSettingsStore.getState();
        ws.connect(sid, {
          mode: 'verdict',
          pr_url: q,
          ...(githubToken ? { github_token: githubToken } : {}),
        });
        return;
      }

      const connectAnalysis = (plan: ReturnType<typeof specialModeGraph>) => {
        setGraph(plan!);
        setStatus('analyzing');
        const {
          researchEnabled, researchCategories, customUrls,
          llmBaseUrl, llmApiKey, llmModelName,
        } = useSettingsStore.getState();
        ws.connect(sid, {
          situation: q,
          graph: plan,
          analysis_mode: mode,
          research_enabled: researchEnabled,
          research_categories: researchCategories,
          custom_urls: customUrls,
          llm_base_url: llmBaseUrl,
          llm_api_key: llmApiKey,
          llm_model: llmModelName,
        });
      };

      // Special modes (debate, pre-mortem, etc.) run one fixed analyzer, not a
      // dynamic expert roster — skip the Planner call, which would otherwise
      // invent a plausible-looking but disconnected "6 agent" preview graph.
      if (isSpecialMode(mode)) {
        connectAnalysis(specialModeGraph(mode));
        return;
      }

      // Call planner to generate the node graph
      const res = await fetch('/api/plan/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ query: q, mode }),
      });

      if (res.ok) {
        const plan = await res.json();
        connectAnalysis(plan);
      } else if (res.status === 401) {
        // Token expired or invalid — re-prompt auth
        useAuthStore.getState().setAuthOpen(true);
        setStatus('idle');
      } else {
        setStatus('error');
      }
    } catch (e) {
      console.error('Planner failed:', e);
      setStatus('error');
    }
  };

  const handleNewSession = () => {
    ws.disconnect();
    useGraphStore.getState().reset();
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-void overflow-hidden">
      <Header onNewSession={handleNewSession} />

      {status === 'idle' ? (
        <ModeSelector onAnalyze={handleAnalyze} />
      ) : (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <AgentRoster />
          <div className="flex-1 flex flex-col bg-void overflow-hidden min-w-0 relative">
            <div className="zone-header flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
              <span className="font-display text-[10px] font-semibold uppercase tracking-widest text-ghost">
                Deliberation Chamber
              </span>
              <span className="text-[9px] text-ghost font-mono">live</span>
            </div>
            <GraphCanvas />
          </div>
          {mode === 'verdict' ? <VerdictScorecardPanel /> : <SynthesisPanel />}
        </div>
      )}

      {status !== 'idle' && <InputBar onAnalyze={handleAnalyze} />}

      {/* Slide-in custom node builder */}
      <CustomNodeBuilder />

      {/* Settings panel */}
      <SettingsPanel />

      {/* Auth modal */}
      <AuthModal />

      {/* Node popover (Obsidian-style) */}
      <NodePopover />
    </div>
  );
};

export default App;
