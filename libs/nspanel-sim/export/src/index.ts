// Nextion exporter — everything this repo knows about the bytes the panel
// eats, as code that runs anywhere: the `.tft` container and its three
// checksums (`tftFormat.ts`), the form the panel stores it in
// (`tftPack.ts`), the `.HMI` reader and writer (`hmi.ts`,
// `hmiWrite.ts`), the picture codec (`pictureCodec.ts`), the `.zi` fonts
// and the Editor's measured text geometry (`font.ts`, `textRaster.ts`),
// and the limits a project has to satisfy before anyone flashes anything
// (`attrRanges.ts`, `ramBudget.ts`, `projectLimits.ts`, `preflight.ts`).
//
// Two rules hold this package's shape, and both are load-bearing rather
// than tidiness:
//
//   - it never imports `core/` — it describes the Editor and the format,
//     and has to stand up for someone who does not know this project;
//   - it never imports `node:` — so the same validation runs in the
//     browser, in the build scripts and in the tests, instead of three
//     copies that diverge on the first correction.
//
// The pipeline that USES it (project -> `.HMI` -> Sandbox -> `.tft`) lives
// in `scripts/`, which may import `node:` freely.

export const NSPANEL_SIM_EXPORT_VERSION = "0.0.0";

export * from "./tftFormat.js";
export * from "./tftPack.js";
export * from "./patchText.js";
export * from "./component.js";
export * from "./preflight.js";
export * from "./pictures.js";
export * from "./pictureCodec.js";
export * from "./geometryPatch.js";
export * from "./hmi.js";
export * from "./hmiWrite.js";
export * from "./nameHash.js";
export * from "./font.js";
export * from "./textRaster.js";
export * from "./attrLayout.js";
export * from "./ramBudget.js";
export * from "./attrRanges.js";
export * from "./projectLimits.js";
export * from "./hmiTemplates.generated.js";
export * from "./derivedGlyphs.js";
