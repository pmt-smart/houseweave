import { useEffect, useMemo, useState } from "react";
import { ZiText, integerDeviceScale, useDevicePixelRatio, useZiFont } from "@nspanel-sim/ui";
import { rasterizeZiGlyph, type ZiFont, type ZiGlyph } from "@nspanel-sim/export";
import type { Theme, FontToken } from "@nspanel-sim/core";
import { Badge, Hint, Mono, Section, UseTags } from "./chrome";
import { chrome } from "./chromeTokens";
import { carriedTypefaceOf, fontUrl } from "./fonts";
import { ziAlphaLevels } from "./ziFacts";

// The theme's type, as a catalogue rather than a list of files.
//
// One card per FACE, and the sizes that face carries listed inside it. The
// alternative -- a card per `.zi` -- would make the same typeface look like three
// unrelated things while burying the one
// fact that matters about a size: what it is for. A face is a single decision;
// the sizes are how far that decision was taken.
//
// Each size is shown in the two renderings that exist, the same split as the
// Panel tab:
//
//   React  the theme's own face, as the DOM draws it. What the React panel uses.
//   Real   the `.zi` the panel will carry: that face baked to a bitmap at a
//          fixed height. Coarse because it IS coarse.
//
// Icons live in the Icons section, not here, even though they are `.zi` files
// too: what a reader wants to know about an icon is which drawing it is, and
// that is not a question about type.

/** A sample that exercises what each size is for. */
function sampleFor(zi: ZiFont): string {
  if (zi.glyphs.length <= 16) return zi.glyphs.map((g: ZiGlyph) => String.fromCodePoint(g.code)).join("");
  return "Kitchen  Café  Façade 23°C";
}

function isIconFont(font: FontToken): boolean {
  return (font.include?.icons ?? []).length > 0 || font.include?.iconRoles === true;
}

/**
 * The web face that stands for a `.zi`. Both halves declared, neither guessed.
 *
 * The family is the theme's `typeface`, which is what the React panel draws
 * with; the weight is the font's own `weight`, which the build has already
 * checked against the face name inside the `.zi` itself, and not inferred from
 * the filename: `tailwind-slate`'s 80-pixel clock is `clock-80.zi`, its source
 * entry `1.zi`, neither says "bold", and the `.zi` inside is NotoSans-Bold, so
 * this column would draw Regular where the panel draws Bold.
 */
function webFaceFor(system: Theme, font: FontToken): { fontFamily: string; fontWeight: number } {
  return { fontFamily: system.style.fontFamily, fontWeight: font.weight };
}

// Aligning the two columns on the BASELINE, because aligning them on the box
// does not work.
//
// Both columns get a band of the font's height. Inside that band each side puts
// the baseline where its own metrics say, and they disagree: the 80-pixel `.zi`
// of noto-sans-bold spends 52 pixels above the baseline and 28 below (measured
// off a digit's ink), while the web face's own ascent/descent split is about
// 0.785/0.215. On an 80-pixel band that is nearly nine pixels of difference, and
// it reads exactly as it is -- the Real clock sitting higher than the React one.
//
// So neither side's em box decides. A reference glyph is measured on BOTH sides,
// the size is chosen so its cap is the same height in the two columns, and the
// text is shifted so the two baselines land on the same row.

/** Glyphs that sit on the baseline with a flat top, best first. */
const REF_CHARS = ["H", "0", "1", "A", "E", "n", "x"];

interface ZiCapMetrics {
  /** the character both sides are measured on */
  ref: string;
  /** top of its ink, in panel pixels from the top of the cell */
  capTop: number;
  /** the row under its ink: where the baseline is */
  baseline: number;
}

/** Where this `.zi` puts a cap and a baseline. Read off the bitmap, not declared. */
function ziCapMetrics(zi: ZiFont): ZiCapMetrics | undefined {
  const have = new Set(zi.glyphs.map((g: ZiGlyph) => g.code));
  const ref = REF_CHARS.find((c) => have.has(c.codePointAt(0) as number));
  if (ref === undefined) return undefined;
  const r = rasterizeZiGlyph(zi, ref.codePointAt(0) as number);
  let capTop = -1;
  let bottom = -1;
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++)
      if (r.alpha[y * r.width + x] > 0) {
        if (capTop < 0) capTop = y;
        bottom = y;
        break;
      }
  if (capTop < 0) return undefined;
  return { ref, capTop, baseline: bottom + 1 };
}

interface FaceProbe {
  /** cap height of the reference glyph at 100px */
  cap: number;
  /** the face's own ascent and descent at 100px */
  asc: number;
  desc: number;
}

/** The same three numbers for the web face. Measured; a missing webfont remeasures. */
function useFaceProbe(fontFamily: string, fontWeight: number, ref: string): FaceProbe {
  const [probe, setProbe] = useState<FaceProbe>({ cap: 71.4, asc: 106.9, desc: 29.3 });
  useEffect(() => {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      ctx.font = `${fontWeight} 100px ${fontFamily}`;
      const m = ctx.measureText(ref);
      if (m.actualBoundingBoxAscent > 0)
        setProbe({ cap: m.actualBoundingBoxAscent, asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent });
    };
    measure();
    // a webfont that has not arrived yet measures as the fallback
    document.fonts?.ready.then(measure);
    return () => { cancelled = true; };
  }, [fontFamily, fontWeight, ref]);
  return probe;
}

/**
 * The black box both columns draw on: the panel's own background, not the
 * tool's. `height` is given rather than grown into, so the two boxes are the
 * same box -- a comparison between two frames of different sizes is not one.
 */
function Glass({ height, children }: { height: number; children: React.ReactNode }) {
  return (
    <div style={{ background: "#000", borderRadius: chrome.radius.sm, padding: chrome.space.md, overflowX: "auto" }}>
      <div style={{ height, display: "flex", alignItems: "center" }}>{children}</div>
    </div>
  );
}

function ColumnTitle({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <div style={{ marginBottom: chrome.space.xs }}>
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

/** One size of one face, in both renderings. */
function SizeRow({ system, font, text, onText, carriedName }: {
  system: Theme;
  font: FontToken;
  text: string | undefined;
  onText: (t: string | undefined) => void;
  /** the face name inside this `.zi`, read from the file by the build */
  carriedName?: string;
}) {
  const url = fontUrl(system, font);
  const { font: zi, error } = useZiFont(url);
  const [zoom, setZoom] = useState(1);
  const face = webFaceFor(system, font);

  // ONE scale for both columns, and it is the Real column's that decides: the
  // bitmap can only be drawn at a whole number of DEVICE pixels per panel pixel,
  // so on a 1.25 display one panel pixel occupies 0.8 CSS pixels and the React
  // column follows rather than keeping 1.0 and drawing a fifth larger.
  const dpr = useDevicePixelRatio();
  const cssPerPanelPx = integerDeviceScale(zoom, dpr) / dpr;
  const box = font.height * cssPerPanelPx;

  const zm = useMemo(() => (zi ? ziCapMetrics(zi) : undefined), [zi]);
  const probe = useFaceProbe(face.fontFamily, face.fontWeight, zm?.ref ?? "H");
  const capCss = zm ? (zm.baseline - zm.capTop) * cssPerPanelPx : box * 0.714;
  const size = (capCss / probe.cap) * 100;
  const k = size / 100;
  const domBaseline = (box - (probe.asc + probe.desc) * k) / 2 + probe.asc * k;
  const wantBaseline = zm ? zm.baseline * cssPerPanelPx : domBaseline;

  const shown = text ?? (zi ? sampleFor(zi) : "Kitchen  Café  Façade 23°C");

  return (
    <div style={{ borderTop: `1px solid ${chrome.color.border}`, paddingTop: chrome.space.md, marginTop: chrome.space.md }}>
      <div style={{ display: "flex", alignItems: "center", gap: chrome.space.sm, flexWrap: "wrap" }}>
        <span style={{ font: `${chrome.font.weight.medium} ${chrome.font.size.md}px ${chrome.font.family}`, color: chrome.color.text }}>
          {font.height} px
        </span>
        <UseTags use={font.use} />
        {zi && <Badge tone="ok">{zi.glyphs.length} glyphs</Badge>}
        <Badge>{font.encoding}</Badge>
        {url === undefined && <Badge tone="danger">file missing</Badge>}
        {error && <Badge tone="danger">{error}</Badge>}
      </div>
      {font.notes && (
        <div style={{ marginTop: chrome.space.xs }}>
          <Hint>{font.notes}</Hint>
        </div>
      )}
      <Mono>
        {font.id} · {font.file}
      </Mono>

      <div style={{ marginTop: chrome.space.sm, display: "grid", gridTemplateColumns: "1fr 1fr", gap: chrome.space.md, alignItems: "start" }}>
        {/* `minWidth: 0` on both: a grid track is `auto` by default, so the
            widest run would push the card past the page instead of scrolling
            inside its own black box */}
        <div style={{ minWidth: 0 }}>
          <ColumnTitle hint={`${system.typeface.family} ${face.fontWeight}`}>React</ColumnTitle>
          <Glass height={box}>
            <div
              style={{
                fontFamily: face.fontFamily,
                fontWeight: face.fontWeight,
                fontSize: size,
                lineHeight: `${box}px`,
                transform: `translateY(${(wantBaseline - domBaseline).toFixed(2)}px)`,
                color: "#fff",
                whiteSpace: "pre",
              }}
            >
              {shown}
            </div>
          </Glass>
        </div>
        <div style={{ minWidth: 0 }}>
          <ColumnTitle
            hint={
              zi
                ? `${carriedName ?? font.file.split("/").pop()} · ${font.height} px · ${ziAlphaLevels(zi)} levels of alpha`
                : `${font.file.split("/").pop()} · ${font.height} px`
            }
          >
            Real
          </ColumnTitle>
          <Glass height={box}>
            {zi ? <ZiText font={zi} text={shown} zoom={zoom} pco={0xffff} /> : <Hint>{error ?? "loading…"}</Hint>}
          </Glass>
        </div>
      </div>

      <div style={{ marginTop: chrome.space.sm, display: "flex", gap: chrome.space.md, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ font: `${chrome.font.size.xs}px ${chrome.font.family}`, color: chrome.color.textMuted, display: "flex", gap: chrome.space.xs, alignItems: "center" }}>
          zoom
          <input type="range" min={1} max={4} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          {/* the factor actually drawn, not the one asked for: the bitmap can
              only land on whole device pixels, so on a 1.25 display 1x is 0.8 */}
          {cssPerPanelPx === 1 ? `${zoom}×` : `${cssPerPanelPx.toFixed(2)}× drawn`}
        </label>
        <input
          value={text ?? ""}
          placeholder="type a label to test it in every size"
          onChange={(e) => onText(e.target.value === "" ? undefined : e.target.value)}
          style={{
            flex: "1 1 240px",
            background: chrome.color.surface,
            color: chrome.color.text,
            border: `1px solid ${chrome.color.border}`,
            borderRadius: chrome.radius.sm,
            padding: `${chrome.space.xs}px ${chrome.space.sm}px`,
            font: `${chrome.font.size.xs}px ${chrome.font.mono}`,
          }}
        />
      </div>
      {zi && <MissingGlyphs zi={zi} text={text} />}
    </div>
  );
}

/**
 * What the typed label would lose. This is the point of showing type at all: the
 * subset is a real limit, and a character the font lacks does not fall back to
 * anything on the panel -- it simply is not drawn. The React column will happily
 * show it, which is exactly the trap.
 */
function MissingGlyphs({ zi, text }: { zi: ZiFont; text: string | undefined }) {
  if (!text) return null;
  const have = new Set(zi.glyphs.map((g: ZiGlyph) => g.code));
  const missing = [...new Set([...text].map((c) => c.codePointAt(0) as number))].filter((c) => !have.has(c));
  if (missing.length === 0) return null;
  return (
    <div style={{ marginTop: chrome.space.sm }}>
      <Badge tone="danger">
        {missing.length} character{missing.length > 1 ? "s" : ""} the React column shows and the panel cannot:{" "}
        {missing.map((c) => `${String.fromCodePoint(c)} (U+${c.toString(16).toUpperCase().padStart(4, "0")})`).join(", ")}
      </Badge>
    </div>
  );
}

/** One face, with every size the theme cut from it. */
function FaceCard({ system, weight, fonts, carried }: {
  system: Theme;
  weight: number;
  fonts: FontToken[];
  carried?: Record<string, { ziName: string; weight: number }>;
}) {
  // one field for the whole face: typing a label is a question about the FACE
  // ("does my room name fit?"), and asking it once per size is asking it once
  const [text, setText] = useState<string | undefined>(undefined);
  const family = system.typeface.family;
  const everyUse = [...new Set(fonts.flatMap((f) => f.use))];
  // what the `.zi` files of this face actually are, read from the files
  const carriedNames = [...new Set(fonts.map((f) => carried?.[f.id]?.ziName).filter(Boolean))] as string[];

  return (
    <div
      style={{
        background: chrome.color.surfaceRaised,
        border: `1px solid ${chrome.color.border}`,
        borderRadius: chrome.radius.sm,
        padding: chrome.space.md,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: chrome.space.sm, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: system.style.fontFamily,
            fontWeight: weight,
            fontSize: chrome.font.size.lg,
            color: chrome.color.text,
          }}
        >
          {family} {weight}
        </span>
        <Badge>{fonts.length === 1 ? "1 size" : `${fonts.length} sizes`}</Badge>
        <UseTags use={everyUse} />
      </div>
      {carriedNames.length > 0 && (
        <div style={{ marginTop: chrome.space.xs, display: "flex", gap: chrome.space.sm, alignItems: "center", flexWrap: "wrap" }}>
          <Hint>asked for {family}; the panel will carry</Hint>
          {carriedNames.map((n) => (
            <Badge key={n} tone={squash(n).startsWith(squash(family)) ? "ok" : "warn"}>
              {n}
            </Badge>
          ))}
        </div>
      )}
      {fonts
        .slice()
        .sort((a, b) => a.height - b.height)
        .map((f) => (
          <SizeRow key={f.id} system={system} font={f} text={text} onText={setText} carriedName={carried?.[f.id]?.ziName} />
        ))}
    </div>
  );
}

/** "NotoSans-Bold" and "noto-sans-24-sp5" both squash to start with notosans. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function TypeSection({ theme }: { theme: Theme }) {
  const carried = carriedTypefaceOf(theme)?.fonts;
  const text = theme.fonts.filter((f) => !isIconFont(f));
  // by weight, because that is what makes two `.zi` different FACES rather than
  // two sizes of one. The family is the theme's single `style.fontFamily`.
  const byWeight = new Map<number, FontToken[]>();
  for (const f of text) {
    const w = webFaceFor(theme, f).fontWeight;
    byWeight.set(w, [...(byWeight.get(w) ?? []), f]);
  }

  return (
    <Section
      title="Type"
      description="One card per face, with the sizes this theme cut from it — a size is not a different typeface, it is how far one decision was taken, and the tags say what each is for. Each size appears in the two renderings that exist: React is the face as the DOM draws it, Real is the .zi the panel will carry, decoded here glyph by glyph. Real looks smooth because the format IS smooth — a .zi stores three bits of coverage per pixel, so eight levels of alpha, not black and white. Comparing the two is the point: a label that fits in the browser may not fit on glass, and a character the subset lacks is simply not drawn there."
    >
      <div style={{ display: "grid", gap: chrome.space.md }}>
        {[...byWeight.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([weight, fonts]) => (
            <FaceCard key={weight} system={theme} weight={weight} fonts={fonts} carried={carried} />
          ))}
        {text.length === 0 && <Hint>This theme declares no text fonts.</Hint>}
      </div>
    </Section>
  );
}
