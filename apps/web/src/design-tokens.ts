/**
 * FlowX 设计令牌 — 编程式访问
 *
 * 与 globals.css 中的 CSS 自定义属性保持同步。
 * 当 CSS 令牌值更新时，此文件也必须同步更新。
 */

// ===== 颜色令牌（HSL 值） =====

export const color = {
  primary: {
    default: '217.2 91.2% 59.8%',
    foreground: '210 40% 98%',
    hover: '217.2 91.2% 48%',
    soft: '217.2 91.2% 94%',
  },
  secondary: {
    default: '210 40% 96.1%',
    foreground: '222.2 47.4% 11.2%',
  },
  danger: {
    default: '0 72.2% 50.6%',
    foreground: '210 40% 98%',
  },
  success: {
    default: '142 71% 45%',
    foreground: '210 40% 98%',
  },
  warning: {
    default: '38 92% 50%',
    foreground: '222.2 47.4% 11.2%',
  },
  muted: {
    default: '210 40% 96.1%',
    foreground: '215.4 16.3% 46.9%',
  },
  accent: {
    default: '210 40% 96.1%',
    foreground: '222.2 47.4% 11.2%',
  },
  background: '210 40% 98%',
  foreground: '222.2 47.4% 11.2%',
  surface: {
    default: '0 0% 100%',
    foreground: '222.2 47.4% 11.2%',
    subtle: '210 40% 99%',
  },
  card: {
    default: '0 0% 100%',
    foreground: '222.2 47.4% 11.2%',
  },
  popover: {
    default: '0 0% 100%',
    foreground: '222.2 47.4% 11.2%',
  },
  border: '214.3 31.8% 91.4%',
  borderStrong: '214.3 31.8% 80%',
  input: '214.3 31.8% 91.4%',
  ring: '217.2 91.2% 59.8%',
} as const;

// ===== 排版令牌 =====

export const fontSize = {
  xs: { size: '12px', lineHeight: '16px' },
  sm: { size: '13px', lineHeight: '18px' },
  base: { size: '14px', lineHeight: '20px' },
  lg: { size: '16px', lineHeight: '24px' },
  xl: { size: '18px', lineHeight: '28px' },
  '2xl': { size: '24px', lineHeight: '32px' },
} as const;

// ===== 间距令牌 =====

export const space = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  9: '36px',
  10: '40px',
  11: '44px',
  12: '48px',
  13: '52px',
  14: '56px',
  15: '60px',
  16: '64px',
} as const;

// ===== 圆角令牌 =====

export const radius = {
  sm: '10px',
  md: '14px',
  lg: '18px',
} as const;

// ===== 阴影令牌（亮色） =====

export const shadow = {
  sm: '0 1px 2px rgba(15, 23, 42, 0.04)',
  md: '0 12px 32px rgba(15, 23, 42, 0.06)',
  lg: '0 24px 48px rgba(15, 23, 42, 0.08)',
} as const;

// ===== 过渡令牌 =====

export const transition = {
  theme: '150ms ease',
} as const;
