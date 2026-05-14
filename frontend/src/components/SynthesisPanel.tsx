import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

interface SynthesisPanelProps {
  verdict?: string;
  reasoning?: string;
  confidence?: string;
  isLoading?: boolean;
}

const CONFIDENCE_CONFIG: Record<string, { color: string; icon: typeof CheckCircle }> = {
  high: { color: "#10B981", icon: CheckCircle },
  medium: { color: "#F59E0B", icon: AlertTriangle },
  low: { color: "#EF4444", icon: XCircle },
};

export default function SynthesisPanel({
  verdict,
  reasoning,
  confidence = "medium",
  isLoading = false,
}: SynthesisPanelProps) {
  const config = CONFIDENCE_CONFIG[confidence] || CONFIDENCE_CONFIG.medium;
  const Icon = config.icon;

  return (
    <AnimatePresence mode="wait">
      {isLoading ? (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex flex-col items-center justify-center py-12 text-gray-400"
        >
          <Loader2 className="w-8 h-8 animate-spin mb-3 text-cortex-400" />
          <p className="text-sm">Synthesizing expert opinions...</p>
        </motion.div>
      ) : verdict ? (
        <motion.div
          key="content"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="space-y-4"
        >
          <div
            className="p-4 rounded-xl border"
            style={{
              background: `${config.color}10`,
              borderColor: `${config.color}30`,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon className="w-5 h-5" style={{ color: config.color }} />
              <span
                className="text-sm font-semibold uppercase tracking-wider"
                style={{ color: config.color }}
              >
                {confidence} Confidence
              </span>
            </div>
            <p className="text-sm text-gray-200 leading-relaxed">{verdict}</p>
          </div>

          {reasoning && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Reasoning
              </h4>
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                {reasoning}
              </p>
            </div>
          )}
        </motion.div>
      ) : (
        <motion.div
          key="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex flex-col items-center justify-center py-12 text-gray-600"
        >
          <p className="text-sm">
            Submit a situation to see the synthesis
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
