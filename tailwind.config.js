/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        bg:       '#03030a',
        surface:  '#08080f',
        panel:    '#0d0d18',
        border:   'rgba(255,255,255,0.06)',
        accent:   '#6366f1',
        purple:   '#8b5cf6',
        cyan:     '#06b6d4',
        emerald:  '#10b981',
        amber:    '#f59e0b',
        rose:     '#f43f5e',
      },
      animation: {
        'pulse-slow':   'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flow':         'flow 2s ease-in-out infinite',
        'glow':         'glow 2s ease-in-out infinite alternate',
        'slide-in':     'slideIn 0.3s ease-out',
        'float':        'float 6s ease-in-out infinite',
        'grid-move':    'gridMove 20s linear infinite',
      },
      keyframes: {
        flow: {
          '0%, 100%': { opacity: 0, transform: 'translateX(0)' },
          '50%': { opacity: 1, transform: 'translateX(8px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 10px rgba(99,102,241,0.3)' },
          '100%': { boxShadow: '0 0 25px rgba(99,102,241,0.7), 0 0 50px rgba(99,102,241,0.3)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        gridMove: {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '40px 40px' },
        },
        slideIn: {
          '0%': { opacity: 0, transform: 'translateX(-10px)' },
          '100%': { opacity: 1, transform: 'translateX(0)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'glow-accent': '0 0 20px rgba(99,102,241,0.4)',
        'glow-emerald': '0 0 20px rgba(16,185,129,0.4)',
        'glow-cyan': '0 0 20px rgba(6,182,212,0.4)',
        'glow-rose': '0 0 20px rgba(244,63,94,0.4)',
        'panel': '0 4px 40px rgba(0,0,0,0.5)',
      }
    },
  },
  plugins: [],
}
