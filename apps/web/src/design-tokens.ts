/**
 * FlowX Control Room 设计令牌 — 编程式访问。
 *
 * 与 globals.css 中的 CSS 自定义属性保持同步。
 */

export const color = {
  primary: { default: '0 0% 7%', foreground: '0 0% 100%', hover: '0 0% 16%', soft: '0 0% 94%' },
  secondary: { default: '220 14% 96%', foreground: '222 47% 11%' },
  danger: { default: '0 72% 51%', foreground: '0 0% 100%' },
  success: { default: '158 64% 38%', foreground: '0 0% 100%' },
  warning: { default: '31 92% 45%', foreground: '24 10% 10%' },
  muted: { default: '220 14% 96%', foreground: '215 16% 42%' },
  accent: { default: '173 44% 94%', foreground: '173 61% 24%' },
  background: '220 20% 97%',
  foreground: '222 47% 11%',
  surface: { default: '0 0% 100%', foreground: '222 47% 11%', subtle: '220 20% 98%' },
  card: { default: '0 0% 100%', foreground: '222 47% 11%' },
  popover: { default: '0 0% 100%', foreground: '222 47% 11%' },
  border: '220 13% 88%',
  borderStrong: '220 10% 74%',
  input: '220 13% 82%',
  ring: '0 0% 7%',
} as const;

export const fontSize = {
  xs: { size: '12px', lineHeight: '16px' },
  sm: { size: '13px', lineHeight: '18px' },
  base: { size: '14px', lineHeight: '20px' },
  lg: { size: '16px', lineHeight: '24px' },
  xl: { size: '18px', lineHeight: '26px' },
  '2xl': { size: '24px', lineHeight: '30px' },
} as const;

export const space = {
  1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 7: '28px', 8: '32px',
  9: '36px', 10: '40px', 11: '44px', 12: '48px', 13: '52px', 14: '56px', 15: '60px', 16: '64px',
} as const;

export const radius = { sm: '4px', md: '6px', lg: '8px' } as const;

export const shadow = {
  sm: '0 1px 2px rgba(15, 23, 42, 0.04)',
  md: '0 8px 24px rgba(15, 23, 42, 0.08)',
  lg: '0 16px 40px rgba(15, 23, 42, 0.12)',
} as const;

export const transition = { theme: '150ms ease' } as const;
