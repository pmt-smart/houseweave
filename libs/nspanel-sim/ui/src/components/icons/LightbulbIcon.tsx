import { PanelIcon } from "../../panelIcons";

// The "lightbulb" glyph.
//
// A theme ships a subsetted `.zi` and the rasterizer draws a glyph from it
// (panelIcons.tsx). So this is a thin shim over the
// ROLE, and which drawing fills it is the theme's answer -- filled in
// the joBr99 one, stroked in the shadcn one, and a different drawing for on and
// off in both of those.
//
// Kept as a component because half the screens call it by name; `on` decides the
// role, and callers that do not know pass the colour, as they always did.
export function LightbulbIcon({ size = 24, color = "currentColor", on = true }: { size?: number; color?: string; on?: boolean }) {
  return <PanelIcon role={on ? "lightOn" : "lightOff"} size={size} color={color} />;
}
