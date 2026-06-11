/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#080B11',
        chamber: '#0F1520',
        border: '#1E2D45',
        pulse: '#6366F1',
        signal: '#22D3EE',
        warn: '#F59E0B',
        ghost: '#94A3B8',
        'surface-raised': '#131B2A',
        'surface-hover': '#1A2438',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'breathing': 'breathing 3s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'bubble-in': 'bubbleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'conflict-pulse': 'conflictPulse 2s ease-in-out infinite',
        'flow-particles': 'flowParticles 1.5s linear infinite',
        'ripple': 'ripple 0.8s ease-out forwards',
        'drift': 'drift 4s ease-in-out infinite',
      },
      keyframes: {
        breathing: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.6', transform: 'scale(1.05)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(99, 102, 241, 0.15)' },
          '50%': { boxShadow: '0 0 20px rgba(99, 102, 241, 0.3), 0 0 40px rgba(99, 102, 241, 0.1)' },
        },
        bubbleIn: {
          from: { opacity: '0', transform: 'translateY(12px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        conflictPulse: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(245, 158, 11, 0.2)' },
          '50%': { boxShadow: '0 0 20px rgba(245, 158, 11, 0.4), 0 0 40px rgba(245, 158, 11, 0.15)' },
        },
        flowParticles: {
          '0%': { strokeDashoffset: '0' },
          '100%': { strokeDashoffset: '-20' },
        },
        ripple: {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(3)', opacity: '0' },
        },
        drift: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-3px)' },
        },
      },
    },
  },
  plugins: [],
};
