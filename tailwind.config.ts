import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#4F46E5',
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#4F46E5',
          600: '#4338CA',
          700: '#3730A3',
          800: '#312E81',
        },
        ai: {
          DEFAULT: '#8B5CF6',
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
        },
        status: {
          open: {
            light: '#FFF7ED',
            DEFAULT: '#F59E0B',
            dark: '#C2410C',
          },
          escalated: {
            light: '#FEF2F2',
            DEFAULT: '#EF4444',
            dark: '#B91C1C',
          },
          resolved: {
            light: '#F0FDF4',
            DEFAULT: '#10B981',
            dark: '#15803D',
          },
          ai_draft: {
            light: '#F5F3FF',
            DEFAULT: '#8B5CF6',
            dark: '#6D28D9',
          },
        },
        surface: {
          background: '#F9FAFB',
          DEFAULT: '#FFFFFF',
          container: '#F0ECF9',
          'container-high': '#EAE6F4',
          'container-highest': '#E4E1EE',
          border: '#E5E7EB',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-sm': ['1.5rem', { lineHeight: '2rem', fontWeight: '600', letterSpacing: '0' }],
        'headline-sm': ['1.125rem', { lineHeight: '1.75rem', fontWeight: '600', letterSpacing: '0' }],
        'body-md': ['0.875rem', { lineHeight: '1.25rem', fontWeight: '400' }],
        'body-sm': ['0.8125rem', { lineHeight: '1.25rem', fontWeight: '400' }],
        'label-md': ['0.75rem', { lineHeight: '1rem', fontWeight: '600', letterSpacing: '0' }],
        'label-sm': ['0.6875rem', { lineHeight: '1rem', fontWeight: '500', letterSpacing: '0' }],
        'mono-sm': ['0.75rem', { lineHeight: '1rem', fontWeight: '400' }],
      },
      spacing: {
        'container-margin': '1.5rem',
        'panel-gap': '0rem',
        'section-padding': '1rem',
        'element-gap': '0.75rem',
        'tight-gap': '0.5rem',
        'sidebar-w': '240px',
        'inbox-list-w': '360px',
      },
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
      boxShadow: {
        'level-2': '0px 4px 12px rgba(0, 0, 0, 0.05)',
      },
    },
  },
  plugins: [typography],
};

export default config;
