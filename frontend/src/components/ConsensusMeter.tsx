import { motion } from "framer-motion";

interface ConsensusMeterProps {
  score: number;
  className?: string;
}

export default function ConsensusMeter({ score, className = "" }: ConsensusMeterProps) {
  const percent = Math.round(score * 100);
  const getColor = () => {
    if (percent >= 80) return "#10B981";
    if (percent >= 50) return "#F59E0B";
    return "#EF4444";
  };

  return (
    <div className={`${className}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-gray-400">Agreement Level</span>
        <motion.span
          key={percent}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-sm font-bold"
          style={{ color: getColor() }}
        >
          {percent}%
        </motion.span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ background: getColor() }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-gray-500">Disagreement</span>
        <span className="text-xs text-gray-500">Consensus</span>
      </div>
    </div>
  );
}
