export const COLORS = {
  primary: "#1DB67D",
  primaryHover: "#27C98C",
  card: "#0F1B2A",
  border: "#1B3145",
  text: "#E7EDF4",
} as const;

export const SIDEBAR_COLLAPSED = 80;
export const SIDEBAR_EXPANDED = 280;

/* ─── Unified Lendscope JS-side palette ─────────────────────────────────────
   For dynamic styling (SVG fills, computed colors, JSON style structs) only.
   Static styling should use Tailwind tokens from globals.css. Hex values here
   mirror the @theme inline tokens so colors match across the whole app.
   ──────────────────────────────────────────────────────────────────────── */

export const C = {
  // Surfaces
  bg: "#020814",
  surface: "#0D1826",
  card: "#0D1826",
  cardAlt: "#0A1220",

  // Borders
  border: "#172A3F",
  borderLit: "#1E3048",

  // Accent (green)
  accent: "#1DB67D",
  green: "#1DB67D",
  accentSoft: "#25D28F",
  greenSoft: "#25D28F",
  accentDim: "#158A5E",
  accentTint: "rgba(29,182,125,0.06)",
  accentBord: "rgba(29,182,125,0.22)",
  active: "rgba(29,182,125,0.10)",

  // Status
  warn: "#E5A93E",
  yellow: "#E5A93E",
  amber: "#E5A93E",
  danger: "#E5534B",
  red: "#E5534B",
  cyan: "#3AAFCF",

  // Text (brightest → faintest)
  textBright: "#F3F7FC",
  text: "#E7EDF4",
  textDim: "#8A9DB5",
  textSec: "#8A9DB5",
  textMuted: "#5B7088",
  textFaint: "#3E5470",

  // Overlays
  white04: "rgba(255,255,255,0.04)",
  white08: "rgba(255,255,255,0.08)",

  shadow: "0 8px 24px rgba(0,0,0,0.22)",
} as const;
