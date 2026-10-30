/**
 * Astryx theme registration for the PayAlly widgets.
 *
 * Mirrors what `npx astryx theme` generates, but lives under web/ (not the
 * server's src/) because the widgets are bundled from web/ by esbuild and the
 * server's tsconfig rootDir is ./src — web/ cannot import from ../src.
 *
 * Single theme: stone (the app default).
 */

import { stoneTheme } from "@astryxdesign/theme-stone/built";
import "@astryxdesign/theme-stone/theme.css";
import "@astryxdesign/theme-stone/fonts.css";

export const themes = {
  stone: stoneTheme,
} as const;

export type ThemeSlug = keyof typeof themes;

export const defaultThemeSlug: ThemeSlug = "stone";
