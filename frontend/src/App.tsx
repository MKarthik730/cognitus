import { useCallback, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Toaster } from "react-hot-toast";
import { useCouncilStore } from "./stores/councilStore";
import CouncilGraphCanvas from "./components/Graph/CouncilGraph";
import QueryBar from "./components/QueryBar";
import SynthesisPanel from "./components/SynthesisPanel";
import ConsensusMeter from "./components/ConsensusMeter";
import RateLimitBanner from "./components/RateLimitBanner";
import { Brain } from "lucide-react";

export default function App() {
  const status = useCouncilStore((s) => s.status);
  const synthesis = useCouncilStore((s) => s.synthesis);
  const consensusScore = useCouncilStore((s) => s.consensusScore);
  const [showSynthesis, setShowSynthesis] = useState(false);

  const isRunning = status === "processing";

  const handleToggleSynthesis = useCallback(() => {
    setShowSynthesis((v) => !v);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-950">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#1f2937",
            color: "#f3f4f6",
            border: "1px solid #374151",
          },
        }}
      />

      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Brain className="w-7 h-7 text-cortex-400" />
          <h1 className="text-xl font-bold text-white">Cognitus</h1>
          {isRunning && (
            <span className="flex items-center gap-1.5 text-sm text-cortex-300">
              <span className="w-2 h-2 rounded-full bg-cortex-400 animate-pulse" />
              Processing
            </span>
          )}
        </div>
        <RateLimitBanner />
      </header>

      <main className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col">
          <div className="px-6 py-3 border-b border-gray-800">
            <QueryBar />
          </div>
          <div className="flex-1 relative">
            <ReactFlowProvider>
              <CouncilGraphCanvas />
            </ReactFlowProvider>
          </div>
        </div>

        <aside className="w-80 border-l border-gray-800 bg-gray-900/30 flex flex-col">
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Consensus
            </h2>
            <ConsensusMeter
              score={consensusScore}
              className="mt-3"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <button
              onClick={handleToggleSynthesis}
              disabled={!synthesis && !isRunning}
              className="w-full mb-3 px-4 py-2 text-sm font-medium rounded-lg bg-cortex-600 hover:bg-cortex-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {showSynthesis ? "Hide Synthesis" : "Show Synthesis"}
            </button>

            {showSynthesis && (
              <SynthesisPanel
                verdict={synthesis?.verdict}
                reasoning={synthesis?.reasoning}
                confidence={synthesis?.confidence}
                isLoading={isRunning}
              />
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
