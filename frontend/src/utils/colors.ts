import type { NodeColor } from '../types';

export const NODE_COLORS: Record<NodeColor, string> = {
  indigo: '#6366F1',
  amber: '#F59E0B',
  cyan: '#22D3EE',
  green: '#22C55E',
  red: '#EF4444',
  purple: '#A855F7',
};

export const NODE_COLOR_CLASSES: Record<NodeColor, string> = {
  indigo: 'bg-indigo-500',
  amber: 'bg-amber-500',
  cyan: 'bg-cyan-400',
  green: 'bg-green-500',
  red: 'bg-red-500',
  purple: 'bg-purple-500',
};

export const SENTIMENT_COLORS = {
  neutral: '#6366F1',
  positive: '#22C55E',
  negative: '#EF4444',
  conflict: '#F59E0B',
};
