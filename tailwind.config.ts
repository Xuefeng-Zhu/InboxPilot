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
        // M03 monochrome tokens (see app/globals.css :root)
        // Only expose semantic names that components reference. The actual
        // hex values live as CSS custom properties so they can be tweaked
        // globally without rebuilding Tailwind.
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      spacing: {
        'sidebar-w': '220px',
        'sidebar-collapsed-w': '56px',
        'inbox-list-w': '340px',
        'right-panel-w': '320px',
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
        'level-3': '0 30px 80px rgba(0, 0, 0, 0.08)',
      },
    },
  },
  plugins: [typography],
};

export default config;
