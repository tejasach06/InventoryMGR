export type AccentId = 'orange' | 'blue' | 'violet' | 'emerald' | 'rose' | 'amber';

export const DEFAULT_ACCENT: AccentId = 'orange';
export const ACCENT_STORAGE_KEY = 'inventorymgr-accent';

type AccentVars = { accent: string; hover: string; text: string; onAccent: string };

export const ACCENT_PRESETS: { id: AccentId; label: string; light: AccentVars; dark: AccentVars }[] = [
  { id: 'orange', label: 'Orange', light: { accent: '#f97316', hover: '#ea580c', text: '#c2410c', onAccent: '#1c0a00' }, dark: { accent: '#fb923c', hover: '#fdba74', text: '#fb923c', onAccent: '#1c0a00' } },
  { id: 'blue', label: 'Blue', light: { accent: '#2563eb', hover: '#1d4ed8', text: '#1d4ed8', onAccent: '#ffffff' }, dark: { accent: '#60a5fa', hover: '#93c5fd', text: '#60a5fa', onAccent: '#05142a' } },
  { id: 'violet', label: 'Violet', light: { accent: '#7c3aed', hover: '#6d28d9', text: '#6d28d9', onAccent: '#ffffff' }, dark: { accent: '#a78bfa', hover: '#c4b5fd', text: '#a78bfa', onAccent: '#1a0b2e' } },
  { id: 'emerald', label: 'Emerald', light: { accent: '#059669', hover: '#047857', text: '#047857', onAccent: '#ffffff' }, dark: { accent: '#34d399', hover: '#6ee7b7', text: '#34d399', onAccent: '#032117' } },
  { id: 'rose', label: 'Rose', light: { accent: '#e11d48', hover: '#be123c', text: '#be123c', onAccent: '#ffffff' }, dark: { accent: '#fb7185', hover: '#fda4af', text: '#fb7185', onAccent: '#2a0710' } },
  { id: 'amber', label: 'Amber', light: { accent: '#d97706', hover: '#b45309', text: '#b45309', onAccent: '#1c0a00' }, dark: { accent: '#fbbf24', hover: '#fcd34d', text: '#fbbf24', onAccent: '#241505' } },
];

export function isAccentId(value: unknown): value is AccentId {
  return ACCENT_PRESETS.some((preset) => preset.id === value);
}

export function accentVars(id: AccentId, resolvedTheme: 'light' | 'dark'): AccentVars {
  const preset = ACCENT_PRESETS.find((candidate) => candidate.id === id) ?? ACCENT_PRESETS[0];
  return resolvedTheme === 'dark' ? preset.dark : preset.light;
}
