import { useMemo, useState } from "react";
import { ZiGlyphView, iconCell, integerDeviceScale, useDevicePixelRatio, useZiFont } from "@nspanel-sim/ui";
import type { Theme, FontToken } from "@nspanel-sim/core";
import { Badge, Hint, Section } from "./chrome";
import { ziAlphaLevels } from "./ziFacts";
import { chrome } from "./chromeTokens";
import { fontUrl, iconRolesOf } from "./fonts";

// The theme's icons: the whole set at once, each drawing exactly once.
//
// Once, and that is the point. The theme carries its icons at more than one
// height, and a drawing can fill more than one role -- the joBr99 theme uses one
// filled bulb for both `lightOn` and `lightOff` and changes only the colour,
// which is what the firmware does. Neither of those makes a second icon.
//
// Neither of those is shown here either. The heights are a fact about the FONTS
// (Type says which sizes exist) and the roles are a fact about the SCREENS -- a
// role is what a screen asks for, not a property of the drawing. Putting both in
// this section turned a set of nine icons into a wall, which is the opposite of
// what a catalogue is for.
//
// Both renderings, as everywhere else:
//
//   React  the vector path, which is what the React panel draws.
//   Real   the glyph the panel will carry, at the chosen size.
//
// The two are the same icon by construction: the theme names a Material Design
// Icon once and the build emits both forms (`icon-roles.generated.json`).

interface IconEntry {
  name: string;
  code: number;
  path: string;
}

/** Full-width black box, so the two rows line up icon by icon. */
function Gallery({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#000", borderRadius: chrome.radius.sm, padding: chrome.space.md, overflowX: "auto" }}>
      <div style={{ display: "flex", gap: chrome.space.md, alignItems: "flex-end", minHeight: 24 }}>{children}</div>
    </div>
  );
}

function ColumnTitle({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <div style={{ marginBottom: chrome.space.xs, marginTop: chrome.space.md }}>
      <span
        style={{
          font: `${chrome.font.weight.medium} ${chrome.font.size.xs}px ${chrome.font.family}`,
          color: chrome.color.text,
          letterSpacing: 0.4,
        }}
      >
        {children}
      </span>{" "}
      <span style={{ font: `${chrome.font.size.xs}px ${chrome.font.family}`, color: chrome.color.textMuted }}>
        {hint}
      </span>
    </div>
  );
}

export function IconsSection({ theme }: { theme: Theme }) {
  const sizes = useMemo(
    () =>
      theme.icons.fonts
        .map((id) => theme.fonts.find((f) => f.id === id))
        .filter((f): f is FontToken => f !== undefined)
        .sort((a, b) => a.height - b.height),
    [theme],
  );

  // by drawing, not by role: one bulb filling two roles is one icon
  const icons = useMemo(() => {
    const byCode = new Map<number, IconEntry>();
    for (const entry of Object.values(iconRolesOf(theme)))
      if (!byCode.has(entry.code))
        byCode.set(entry.code, { name: entry.name, code: entry.code, path: entry.path });
    return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [theme]);

  // the smallest the theme carries, because it is the one every component can
  // reach for: which heights exist is Type's subject, not this section's
  const size = sizes[0];
  const [zoom, setZoom] = useState(1);
  const { font: zi, error } = useZiFont(size ? fontUrl(theme, size) : undefined);

  // ONE scale for both rows, and it is the Real row's that decides: the bitmap
  // can only be drawn at a whole number of device pixels per panel pixel.
  const dpr = useDevicePixelRatio();
  const cssPerPanelPx = integerDeviceScale(zoom, dpr) / dpr;

  return (
    <Section
      title="Icons"
      description="The whole set, each drawing once. A drawing carried at more than one height is still one icon, and one that fills more than one role is still one icon. React is the vector the DOM draws; Real is the glyph the panel will carry — the actual .zi, decoded here, which is why it looks as smooth as it does: the format stores three bits of coverage per pixel, so a glyph has eight levels of alpha and genuinely soft edges."
    >
      <div style={{ display: "flex", gap: chrome.space.md, alignItems: "center", flexWrap: "wrap" }}>
        <Badge tone="ok">
          {icons.length} drawing{icons.length === 1 ? "" : "s"}
        </Badge>
        <label
          style={{
            font: `${chrome.font.size.xs}px ${chrome.font.family}`,
            color: chrome.color.textMuted,
            display: "flex",
            gap: chrome.space.xs,
            alignItems: "center",
          }}
        >
          zoom
          <input type="range" min={1} max={4} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          {/* the factor actually drawn, not the one asked for */}
          {cssPerPanelPx === 1 ? `${zoom}×` : `${cssPerPanelPx.toFixed(2)}× drawn`}
        </label>
      </div>

      <ColumnTitle hint="Material Design Icons · vector paths">React</ColumnTitle>
      <Gallery>
        {icons.map((i) => {
          // the cell the panel gives this glyph, so the vector occupies the box
          // the panel will occupy rather than a square of our choosing
          const cell = iconCell(zi, i.code, size?.height ?? 32);
          return (
            <svg
              key={i.code}
              viewBox="0 0 24 24"
              width={cell.w * cssPerPanelPx}
              height={cell.h * cssPerPanelPx}
              preserveAspectRatio="xMidYMid slice"
              // a flex child shrinks by default, so at a zoom wider than the box
              // the vectors would be squeezed together while the Real row scrolls --
              // two rows that do not line up, which is the one thing they are
              // here to do
              style={{ display: "block", flexShrink: 0 }}
            >
              <title>{i.name}</title>
              <path d={i.path} fill="#fff" />
            </svg>
          );
        })}
        {icons.length === 0 && (
          <Hint>This theme&apos;s icon roles have not been generated. Run npm run build-fonts in export/.</Hint>
        )}
      </Gallery>

      <ColumnTitle
        hint={zi ? `${size?.file.split("/").pop() ?? ""} · ${ziAlphaLevels(zi)} levels of alpha` : "no icon font"}
      >
        Real
      </ColumnTitle>
      <Gallery>
        {zi ? (
          icons.map((i) => (
            <div key={i.code} style={{ flexShrink: 0 }}>
            <ZiGlyphView
              font={zi}
              code={i.code}
              color="#fff"
              zoom={zoom}
              title={i.name}
            />
            </div>
          ))
        ) : (
          <Hint>{error ?? "loading…"}</Hint>
        )}
      </Gallery>

    </Section>
  );
}
