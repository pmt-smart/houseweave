// Design system for the simulator CHROME — the web interface around the
// device (tabs, controls, configuration panels).
//
// DELIBERATELY separate from the panel's theme
// (ui/src/theme.ts). This is not careless duplication: they are two
// systems under opposite constraints, and mixing them degrades both.
//
//   Panel (ui/src/theme.ts): 69 x 49 mm seen at arm's length, RGB565
//   (65k colours, no fine gradients), finger touch with a 12-15 mm
//   minimum target, and colours pinned to REAL values already in
//   production in the Berry code. Optimised for legibility, not for
//   information density.
//
//   Chrome (this file): a desktop monitor, 24-bit colour, mouse and
//   keyboard. It can be dense, it can use subtle tone, and it must NOT
//   imitate the panel — if the chrome looks like the panel, it becomes
//   ambiguous what is the simulation and what is the tool (the web UI
//   need not follow the panel's design).
//
// Hence the chrome is cool-neutral while the panel is dark green-grey,
// and the chrome uses system-ui while the panel uses Roboto (the font
// of the "ha-dark" theme the panel inherits).

export const chrome = {
  color: {
    bg: "#0f1113",
    surface: "#17191c",
    surfaceRaised: "#1e2126",
    surfaceSunken: "#0b0d0f",
    border: "#2a2e34",
    borderStrong: "#3b424b",
    text: "#e6e8ea",
    textMuted: "#9aa2ad",
    textFaint: "#6b7480",
    accent: "#4da3ff",
    accentText: "#0b0d0f",
    accentSoft: "rgba(77,163,255,0.12)",
    ok: "#5cb98a",
    warn: "#d9a441",
    danger: "#dd7160",
  },
  // A scale of 4 — enough steps for hierarchy without turning every
  // gap into a case-by-case decision.
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 4, md: 6, pill: 999 },
  font: {
    family: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    // Mono for technical values only (hex, px, mm) — it aligns in a
    // column and does not get confused with a label.
    mono: 'ui-monospace, "Cascadia Mono", "Consolas", monospace',
    size: { xs: 11, sm: 12, md: 13, lg: 15, xl: 19 },
    weight: { regular: 400, medium: 500, bold: 600 },
  },
} as const;
