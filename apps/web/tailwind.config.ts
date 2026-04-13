import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: {
        '2xl': '1440px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--color-success-default))',
          foreground: 'hsl(var(--color-success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--color-warning-default))',
          foreground: 'hsl(var(--color-warning-foreground))',
        },
        danger: {
          DEFAULT: 'hsl(var(--color-danger-default))',
          foreground: 'hsl(var(--color-danger-foreground))',
        },
        surface: {
          DEFAULT: 'hsl(var(--color-surface-default))',
          foreground: 'hsl(var(--color-surface-foreground))',
          subtle: 'hsl(var(--color-surface-subtle))',
        },
      },
      borderRadius: {
        lg: 'var(--radius-lg)',
        md: 'var(--radius-md)',
        sm: 'var(--radius-sm)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      fontSize: {
        xs: ['var(--font-size-xs)', { lineHeight: 'var(--font-size-xs--line-height)' }],
        sm: ['var(--font-size-sm)', { lineHeight: 'var(--font-size-sm--line-height)' }],
        base: ['var(--font-size-base)', { lineHeight: 'var(--font-size-base--line-height)' }],
        lg: ['var(--font-size-lg)', { lineHeight: 'var(--font-size-lg--line-height)' }],
        xl: ['var(--font-size-xl)', { lineHeight: 'var(--font-size-xl--line-height)' }],
        '2xl': ['var(--font-size-2xl)', { lineHeight: 'var(--font-size-2xl--line-height)' }],
      },
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        7: 'var(--space-7)',
        8: 'var(--space-8)',
        9: 'var(--space-9)',
        10: 'var(--space-10)',
        11: 'var(--space-11)',
        12: 'var(--space-12)',
        13: 'var(--space-13)',
        14: 'var(--space-14)',
        15: 'var(--space-15)',
        16: 'var(--space-16)',
      },
    },
  },
  plugins: [animate],
};

export default config;
