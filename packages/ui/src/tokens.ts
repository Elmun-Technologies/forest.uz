/** JS mirror of theme.css for places CSS variables can't reach (charts, canvas heatmaps, OG images). */
export const colors = {
  forest: '#334229',
  ink: '#141712',
  ink2: '#3F453B',
  canvas: '#EEEFEA',
  panel: '#FFFFFF',
  muted: '#5E6459',
  subtle: '#8D9586',
  line: '#DADDD3',
  sage: '#D5DDC8',
  sage50: '#F1F5EC',
  good: '#1F6B35',
  goodBg: '#E8F2EA',
  warn: '#6B4E00',
  warnBg: '#FFF4D6',
  critical: '#8A1C12',
  criticalBg: '#FBEAE8',
  live: '#3E8E4E',
} as const;

/** Validated colour-blind-safe categorical order (docs/11). */
export const chartColors = ['#3A7D44', '#2F6DB5', '#C9692C', '#8E5BB5', '#A3851F'] as const;
