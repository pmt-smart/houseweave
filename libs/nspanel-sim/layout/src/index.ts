// The declaration both renderers read.
//
// `ui/` turns a node list into DOM, `export/` turns the same list into Nextion
// records, and this package knows about neither -- no React, no `.tft` format,
// no filesystem. That is the whole constraint, and it is what stops a third
// implementation of a screen from appearing.

export * from "./node.js";
export * from "./paint.js";
export * from "./components.js";
export * from "./format.js";
export * from "./registry.js";
export * from "./emit.js";
export * from "./wire.js";
export * from "./keyboard.js";
export * from "./screenTemplates.js";
export * from "./scrollbar.js";
export * from "./listRow.js";
export * from "./patternPad.js";
export * from "./qr.js";
export * from "./qrCode.js";

// By name as well as through the registry: a theme's React wrapper knows which
// theme it is and should say so, rather than looking itself up in a table.
export * as lovelaceJobr99 from "./themes/lovelace-jobr99.js";
export * as shadcnDark from "./themes/shadcn-dark.js";
export * as tailwindSlate from "./themes/tailwind-slate.js";
