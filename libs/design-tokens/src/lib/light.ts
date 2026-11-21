import { baseTokens } from './base.ts';

/**
 * Theme-variant tokens resolved for the light theme.
 * Aligned with the @threadplane/angular/chat UI's polished consumer aesthetic
 * (pure-white surfaces, near-black text, neutral grays) so embedded
 * chat surfaces visually unify with cockpit chrome and the marketing
 * website.
 */
export const lightOverrides = Object.freeze({
  // Surfaces
  canvas: 'rgb(255, 255, 255)',
  surface: 'rgb(255, 255, 255)',
  surfaceTinted: 'rgb(251, 251, 251)',
  surfaceDim: 'rgb(245, 245, 245)',
  border: 'rgb(229, 229, 229)',
  borderStrong: 'rgb(200, 200, 200)',

  // Text
  textPrimary: '#0A0A0A',
  textSecondary: 'rgb(70, 70, 70)',
  textMuted: 'rgb(115, 115, 115)',
  textInverted: 'rgb(255, 255, 255)',

  // Legacy surface aliases
  bg: 'rgb(255, 255, 255)',
  sidebarBg: 'rgba(255, 255, 255, 0.45)',

  // Semantic accent is the interactive INK (links, focus, borders) and stays
  // dark: aviation yellow is 1.84:1 on white and cannot carry text. The tints
  // below are backgrounds, so they carry the yellow instead — which is the
  // shape [data-ui="pill"][data-variant="accent"] already has: accent-surface
  // behind, accent ink on top.
  accent: baseTokens.brand.accent,
  accentHover: '#0E1B2E',
  accentGlow: 'rgba(255, 175, 0, 0.28)',
  accentBorder: 'rgba(255, 175, 0, 0.35)',
  accentBorderHover: 'rgba(255, 175, 0, 0.55)',
  accentSurface: 'rgba(255, 175, 0, 0.10)',
} as const);

export type LightOverrides = typeof lightOverrides;
