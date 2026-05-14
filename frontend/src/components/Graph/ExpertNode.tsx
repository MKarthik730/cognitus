import { memo } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { motion } from "framer-motion";
import { DomainName } from "../../stores/councilStore";

interface ExpertNodeData {
  domain: DomainName;
  label: string;
  analysis?: string;
  confidence?: string;
  color: string;
  isActive: boolean;
  isComplete: boolean;
}

const DOMAIN_ICONS: Record<string, string> = {
  legal: "⚖️",
  finance: "💹",
  medical: "🩺",
  technology: "💻",
  education: "📚",
  science: "🔬",
  business: "📊",
  ethics: "🛡️",
  psychology: "🧠",
  sociology: "👥",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "#10B981",
  medium: "#F59E0B",
  low: "#EF4444",
};

const ExpertNode = memo(({ data }: NodeProps<ExpertNodeData>) => {
  const confidenceColor = data.confidence
    ? CONFIDENCE_COLORS[data.confidence] || "#9CA3AF"
    : "#9CA3AF";

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{
        scale: data.isActive ? 1.05 : 1,
        opacity: 1,
      }}
      transition={{ duration: 0.3 }}
      style={{
        background: data.isActive
          ? `${data.color}22`
          : data.isComplete
          ? `${data.color}18`
          : "rgba(31, 41, 55, 0.8)",
        border: `2px solid ${
          data.isActive ? data.color : data.isComplete ? `${data.color}88` : "#374151"
        }`,
        borderRadius: 12,
        padding: "10px 16px",
        minWidth: 160,
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />

      <div className="flex items-center gap-2">
        <span style={{ fontSize: 20 }}>{DOMAIN_ICONS[data.domain] || "🧠"}</span>
        <div>
          <div
            style={{
              color: data.isActive ? data.color : "#e5e7eb",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {data.label}
          </div>
          {data.isComplete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                marginTop: 4,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: confidenceColor,
                  display: "inline-block",
                }}
              />
              <span style={{ color: "#9CA3AF", fontSize: 11 }}>
                {data.confidence}
              </span>
            </motion.div>
          )}
          {data.isActive && !data.isComplete && (
            <motion.div
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              style={{ color: data.color, fontSize: 11, marginTop: 4 }}
            >
              Analyzing...
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
});

ExpertNode.displayName = "ExpertNode";

export default ExpertNode;
