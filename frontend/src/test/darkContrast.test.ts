// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

function hexToRgb(hex: string): [number, number, number] {
  const cleanHex = hex.replace('#', '').trim();
  const num = parseInt(cleanHex, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Dark mode contrast contract', () => {
  const cssPath = path.resolve(__dirname, '../app/globals.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Extract html.dark sections
  const getProp = (block: string, prop: string): string => {
    const match = block.match(new RegExp(`${prop}:\\s*(#[0-9a-fa-f]{6})`));
    if (!match) throw new Error(`Property ${prop} not found in block`);
    return match[1];
  };

  // Find neutral dark block (contains --color-text-secondary)
  const neutralBlockMatch = cssContent.match(/html\.dark\s*\{[^}]*--color-text-secondary:[^}]*\}/);
  if (!neutralBlockMatch) throw new Error('Neutral html.dark block not found');
  const neutralBlock = neutralBlockMatch[0];

  const textPrimary = getProp(neutralBlock, '--color-text-primary');
  const textSecondary = getProp(neutralBlock, '--color-text-secondary');
  const textTertiary = getProp(neutralBlock, '--color-text-tertiary');
  const surface = getProp(neutralBlock, '--color-surface');
  const surfaceTertiary = getProp(neutralBlock, '--color-surface-tertiary');

  // Find semantic dark block (contains --color-status-running-bg)
  const semanticBlockMatch = cssContent.match(/html\.dark\s*\{[^}]*--color-status-running-bg:[^}]*\}/);
  if (!semanticBlockMatch) throw new Error('Semantic html.dark block not found');
  const semanticBlock = semanticBlockMatch[0];

  it('verifies neutral dark text contrast ratios >= 6.0 and hierarchy', () => {
    const secOnSurf = contrastRatio(textSecondary, surface);
    const secOnSurfTert = contrastRatio(textSecondary, surfaceTertiary);
    const tertOnSurf = contrastRatio(textTertiary, surface);
    const tertOnSurfTert = contrastRatio(textTertiary, surfaceTertiary);

    expect(secOnSurf).toBeGreaterThanOrEqual(6.0);
    expect(secOnSurfTert).toBeGreaterThanOrEqual(6.0);
    expect(tertOnSurf).toBeGreaterThanOrEqual(6.0);
    expect(tertOnSurfTert).toBeGreaterThanOrEqual(6.0);

    const primOnSurf = contrastRatio(textPrimary, surface);
    expect(primOnSurf).toBeGreaterThan(secOnSurf);
    expect(secOnSurf).toBeGreaterThan(tertOnSurf);
  });

  it('verifies semantic badge background/foreground ratios >= 5.5', () => {
    const bgMatches = [
      ...semanticBlock.matchAll(/--color-([a-z_]+-[a-z0-9_]+)-bg:\s*(#[0-9a-fa-f]{6})/g),
    ];

    expect(bgMatches.length).toBeGreaterThan(0);

    for (const match of bgMatches) {
      const nameName = match[1]; // e.g. status-running
      const bgHex = match[2];
      const fgHex = getProp(semanticBlock, `--color-${nameName}`);

      const ratio = contrastRatio(fgHex, bgHex);
      expect(ratio, `Contrast ratio for ${nameName} fg (${fgHex}) vs bg (${bgHex})`).toBeGreaterThanOrEqual(5.5);
    }
  });
});
