import { useState, useCallback } from "react";
import { useCouncilStore } from "../stores/councilStore";
import { useCouncilSocket } from "../hooks/useCouncilSocket";
import { Send, Loader2, Square } from "lucide-react";

export default function QueryBar() {
  const [input, setInput] = useState("");
  const situation = useCouncilStore((s) => s.situation);
  const status = useCouncilStore((s) => s.status);
  const reset = useCouncilStore((s) => s.reset);
  const { startAnalysis, cancelAnalysis } = useCouncilSocket();

  const isRunning = status === "processing";

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isRunning) return;

      startAnalysis(input.trim(), crypto.randomUUID(), 1);
    },
    [input, isRunning, startAnalysis]
  );

  const handleCancel = useCallback(() => {
    cancelAnalysis();
  }, [cancelAnalysis]);

  const handleReset = useCallback(() => {
    reset();
    setInput("");
  }, [reset]);

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Describe a situation or ask a question..."
        disabled={isRunning}
        className="flex-1 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cortex-500 focus:border-transparent disabled:opacity-50 text-sm"
      />
      <div className="flex items-center gap-2">
        {isRunning ? (
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl text-sm font-medium transition-colors"
          >
            <Square className="w-4 h-4" />
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="flex items-center gap-2 px-4 py-2.5 bg-cortex-600 hover:bg-cortex-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl text-sm font-medium transition-colors"
          >
            {status === "completed" ? (
              <Loader2 className="w-4 h-4" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {status === "completed" ? "Re-analyze" : "Analyze"}
          </button>
        )}
        {situation && !isRunning && (
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-2.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
    </form>
  );
}
