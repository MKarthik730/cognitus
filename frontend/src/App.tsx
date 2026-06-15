import React, { useEffect } from 'react';
import { useGraphStore } from './stores/graphStore';
import { useAuthStore } from './stores/authStore';
import { useSettingsStore } from './stores/settingsStore';
import { useWebSocket } from './hooks/useWebSocket';
import { Header } from './components/Header';
import { AgentRoster } from './components/AgentRoster';
import { GraphCanvas } from './components/GraphCanvas';
import { SynthesisPanel } from './components/SynthesisPanel';
import { InputBar } from './components/InputBar';
import { CustomNodeBuilder } from './components/CustomNodeBuilder';
import { NodePopover } from './components/NodePopover';
import { ModeSelector } from './components/ModeSelector';
import { SettingsPanel } from './components/SettingsPanel';
import { AuthModal } from './components/AuthModal';

const App: React.FC = () => {
  const status = useGraphStore((s) => s.status);
  const setStatus = useGraphStore((s) => s.setStatus);
  const setGraph = useGraphStore((s) => s.setGraph);
  const setSessionId = useGraphStore((s) => s.setSessionId);
  const mode = useGraphStore((s) => s.mode);
  const groqApiKey = useSettingsStore((s) => s.groqApiKey);
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
        setGraph(plan);

        // Connect WebSocket for real-time streaming with API key
        setStatus('analyzing');
        ws.connect(sid, {
          situation: q,
          graph: plan,
          analysis_mode: mode,
          groq_api_key: groqApiKey || undefined,
        });
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

  return (
    <div className="flex flex-col h-screen w-screen bg-void overflow-hidden">
      <Header />

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
          <SynthesisPanel />
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
