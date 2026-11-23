import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#F9FAF4',
        foreground: '#111111',
        surface: '#EFECE6',
        border: '#111111',
      },
      fontFamily: {
        sans: ['var(--font-arial)', 'Arial', 'Helvetica', 'sans-serif'],
        arial: ['var(--font-arial)', 'Arial', 'Helvetica', 'sans-serif'],
        mono: [
          'var(--font-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
        serif: ['var(--font-amiri)', 'Georgia', 'serif'],
        amiri: ['var(--font-amiri)', 'Georgia', 'serif'],
      },
      letterSpacing: {
        tightest: '-0.03em',
        label: '0.08em',
      },
      // Tactile Brutalism: geometría estrictamente ortogonal, sin esquinas.
      borderRadius: {
        none: '0',
        sm: '0',
        DEFAULT: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        '3xl': '0',
        full: '0',
      },
    },
  },
  plugins: [],
};

export default config;
