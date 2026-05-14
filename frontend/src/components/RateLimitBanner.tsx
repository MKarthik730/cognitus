import { motion } from "framer-motion";
import { Shield, AlertTriangle, Info } from "lucide-react";
import { useCouncilStore } from "../stores/councilStore";

export default function RateLimitBanner() {
  const status = useCouncilStore((s) => s.status);
  const error = useCouncilStore((s) => s.error);

  if (status !== "failed" || !error) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 px-4 py-2 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300"
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span>{error}</span>
    </motion.div>
  );
}

export function ApiUsageIndicator({
  dailyUsed,
  dailyLimit,
  hourlyUsed,
  hourlyLimit,
}: {
  dailyUsed: number;
  dailyLimit: number;
  hourlyUsed: number;
  hourlyLimit: number;
}) {
  const dailyPercent = (dailyUsed / dailyLimit) * 100;
  const hourlyPercent = (hourlyUsed / hourlyLimit) * 100;
  const isWarning = dailyPercent > 70 || hourlyPercent > 70;

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 rounded-lg bg-gray-800/50 text-xs text-gray-400">
      <div className="flex items-center gap-1.5">
        {isWarning ? (
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
        ) : (
          <Shield className="w-3.5 h-3.5 text-green-400" />
        )}
        <span>Daily: {dailyUsed}/{dailyLimit}</span>
      </div>
      <span>Hourly: {hourlyUsed}/{hourlyLimit}</span>
    </div>
  );
}
