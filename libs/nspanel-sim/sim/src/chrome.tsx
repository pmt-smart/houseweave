import type { CSSProperties, ReactNode } from "react";
import { chrome } from "./chromeTokens";

// Primitives for the simulator chrome. See chromeTokens.ts for why this
// is a system separate from the panel's.
//
// Inline styles, with no CSS-in-JS and no MUI here, on purpose: MUI is
// already in the bundle wrapped in the PANEL's theme
// (ui/components/Screen.tsx mounts a ThemeProvider), and using MUI in
// the chrome too would make both visual languages share one theme —
// exactly the mixing these tokens exist to prevent. The chrome is small
// enough not to need more than this.

// ---------------------------------------------------------------- Tabs

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export interface TabsProps<T extends string> {
  /** pushed to the far end of the bar: choices that apply to the whole tool */
  right?: ReactNode;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}

/** Top-level navigation, one level only — the simulator's three areas. */
export function Tabs<T extends string>({ items, value, onChange, right }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: chrome.space.xs,
        borderBottom: `1px solid ${chrome.color.border}`,
        padding: `0 ${chrome.space.xl}px`,
        background: chrome.color.surface,
        alignItems: "center",
      }}
    >
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            style={{
              appearance: "none",
              background: "none",
              border: "none",
              // An underline marks the active tab rather than a fill, so
              // the tab bar does not compete visually with the device,
              // which is the subject of the screen.
              borderBottom: `2px solid ${active ? chrome.color.accent : "transparent"}`,
              color: active ? chrome.color.text : chrome.color.textMuted,
              font: `${active ? chrome.font.weight.medium : chrome.font.weight.regular} ${chrome.font.size.md}px ${chrome.font.family}`,
              padding: `${chrome.space.md}px ${chrome.space.md}px ${chrome.space.md - 2}px`,
              marginBottom: -1,
              cursor: "pointer",
            }}
          >
            {it.label}
          </button>
        );
      })}
      {right ? <div style={{ marginLeft: "auto", display: "flex", gap: chrome.space.lg, alignItems: "center" }}>{right}</div> : null}
    </div>
  );
}

// --------------------------------------------------- Picker

export interface PickerOption {
  id: string;
  label: string;
  /** shown after the label, dimmer: what distinguishes this option from its siblings */
  hint?: string;
}

export interface PickerProps {
  label: string;
  value: string;
  options: readonly PickerOption[];
  onChange: (id: string) => void;
}

/**
 * A dropdown for choosing WHICH theme or WHICH project is on screen.
 *
 * A native <select> on purpose. The content it lists comes from files on disk
 * (sim/src/content.ts), so the list grows without anyone touching this code, and
 * a custom menu would have to reimplement keyboard handling and long lists for
 * no gain.
 *
 * It lives INSIDE the tab whose content it governs, not in the tab bar: there,
 * on the Panel tab the theme picker would change nothing on screen, and on the
 * Theme tab the project picker would change nothing either. A control
 * that does nothing where it is shown is worse than no control -- it invites the
 * reader to look for an effect that is not there.
 */
export function Picker({ label, value, options, onChange }: PickerProps) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: chrome.space.sm, color: chrome.color.textMuted, font: `${chrome.font.weight.regular} ${chrome.font.size.sm}px ${chrome.font.family}` }}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "none",
          background: chrome.color.bg,
          color: chrome.color.text,
          border: `1px solid ${chrome.color.border}`,
          borderRadius: chrome.radius.sm,
          font: `${chrome.font.weight.medium} ${chrome.font.size.sm}px ${chrome.font.family}`,
          padding: `${chrome.space.xs}px ${chrome.space.sm}px`,
          cursor: "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.hint ? ` — ${o.hint}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

// --------------------------------------------------- SegmentedControl

export interface SegmentedControlProps<T extends string> {
  options: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** "row" (default) sits options side by side; "column" stacks them —
   * for a track too narrow to fit them on one line. */
  direction?: "row" | "column";
}

/**
 * An exclusive choice among a few options (device, housing, screen). All
 * options stay visible — a `<select>` hides them until opened, and here
 * comparing them side by side is precisely the point.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  direction = "row",
}: SegmentedControlProps<T>) {
  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: direction,
        // a row wider than its room wraps inside it rather than running past
        // the edge, where a centred row loses its start out of reach
        flexWrap: "wrap",
        maxWidth: "100%",
        background: chrome.color.surfaceSunken,
        border: `1px solid ${chrome.color.border}`,
        borderRadius: chrome.radius.md,
        padding: 2,
        gap: 2,
      }}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            style={{
              appearance: "none",
              border: "none",
              borderRadius: chrome.radius.sm,
              background: active ? chrome.color.accent : "transparent",
              color: active ? chrome.color.accentText : chrome.color.textMuted,
              font: `${active ? chrome.font.weight.medium : chrome.font.weight.regular} ${chrome.font.size.sm}px ${chrome.font.family}`,
              padding: `${chrome.space.sm - 2}px ${chrome.space.md}px`,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------- ToggleButton

export interface ToggleButtonProps {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  children: ReactNode;
}

/**
 * One view option, on or off. Same visual language as an active
 * SegmentedControl segment, because it is the same idea with a single
 * option: pressed is filled, unpressed is quiet.
 */
export function ToggleButton({ pressed, onChange, children }: ToggleButtonProps) {
  return (
    <button
      onClick={() => onChange(!pressed)}
      aria-pressed={pressed}
      style={{
        appearance: "none",
        border: `1px solid ${pressed ? chrome.color.accent : chrome.color.border}`,
        borderRadius: chrome.radius.md,
        background: pressed ? chrome.color.accent : chrome.color.surfaceSunken,
        color: pressed ? chrome.color.accentText : chrome.color.textMuted,
        font: `${pressed ? chrome.font.weight.medium : chrome.font.weight.regular} ${chrome.font.size.sm}px ${chrome.font.family}`,
        padding: `${chrome.space.sm - 2}px ${chrome.space.md}px`,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------- Section

export interface SectionProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}

/** A content block with a title and an optional explanation. */
export function Section({ title, description, children, style }: SectionProps) {
  return (
    <section
      style={{
        background: chrome.color.surface,
        border: `1px solid ${chrome.color.border}`,
        borderRadius: chrome.radius.md,
        padding: chrome.space.lg,
        marginBottom: chrome.space.lg,
        ...style,
      }}
    >
      <h2
        style={{
          margin: 0,
          font: `${chrome.font.weight.bold} ${chrome.font.size.lg}px ${chrome.font.family}`,
          color: chrome.color.text,
        }}
      >
        {title}
      </h2>
      {description !== undefined && (
        <div
          style={{
            marginTop: chrome.space.xs,
            font: `${chrome.font.size.sm}px/1.5 ${chrome.font.family}`,
            color: chrome.color.textMuted,
            maxWidth: 640,
          }}
        >
          {description}
        </div>
      )}
      <div style={{ marginTop: chrome.space.lg }}>{children}</div>
    </section>
  );
}

// --------------------------------------------------------------- Field

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}

/** Label on top, control below, optional hint underneath. */
export function Field({ label, hint, children }: FieldProps) {
  return (
    <div style={{ marginBottom: chrome.space.lg }}>
      <div
        style={{
          font: `${chrome.font.weight.medium} ${chrome.font.size.sm}px ${chrome.font.family}`,
          color: chrome.color.textMuted,
          marginBottom: chrome.space.sm,
        }}
      >
        {label}
      </div>
      {children}
      {hint !== undefined && (
        <div
          style={{
            marginTop: chrome.space.sm,
            font: `${chrome.font.size.xs}px/1.5 ${chrome.font.family}`,
            color: chrome.color.textFaint,
            maxWidth: 640,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- Badge

export type BadgeTone = "neutral" | "ok" | "warn" | "danger";

const BADGE_COLOR: Record<BadgeTone, string> = {
  neutral: chrome.color.textMuted,
  ok: chrome.color.ok,
  warn: chrome.color.warn,
  danger: chrome.color.danger,
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  const c = BADGE_COLOR[tone];
  return (
    <span
      style={{
        display: "inline-block",
        border: `1px solid ${c}`,
        borderRadius: chrome.radius.pill,
        color: c,
        font: `${chrome.font.weight.medium} ${chrome.font.size.xs}px ${chrome.font.family}`,
        padding: `2px ${chrome.space.sm}px`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// ----------------------------------------------------------- Mono/Hint

/** A technical value (hex, px, mm) — monospaced so it aligns in a column. */
export function Mono({ children }: { children: ReactNode }) {
  return (
    <span style={{ font: `${chrome.font.size.sm}px ${chrome.font.mono}`, color: chrome.color.text }}>
      {children}
    </span>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        font: `${chrome.font.size.xs}px/1.5 ${chrome.font.family}`,
        color: chrome.color.textFaint,
        maxWidth: 640,
      }}
    >
      {children}
    </div>
  );
}

// --------------------------------------------------- SelectorBar

/**
 * The row at the top of a tab that says WHAT this tab is showing, and lets it be
 * changed. One component so the two tabs that have one look identical: the
 * choice is the same kind of choice, and a reader who learns it once should not
 * have to learn it again one tab over.
 */
export function SelectorBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: chrome.space.lg,
        flexWrap: "wrap",
        background: chrome.color.surfaceSunken,
        border: `1px solid ${chrome.color.border}`,
        borderRadius: chrome.radius.md,
        padding: `${chrome.space.sm}px ${chrome.space.md}px`,
        marginBottom: chrome.space.xl,
      }}
    >
      {children}
      {note ? (
        <span style={{ color: chrome.color.textMuted, font: `${chrome.font.size.xs}px ${chrome.font.family}` }}>{note}</span>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- UseTags

/**
 * What an element is FOR, as the theme declares it.
 *
 * The reason this exists as its own thing: the Themes tab is a catalogue where
 * every element appears exactly once. A colour used by both a title and a
 * button's caption is ONE colour, not two entries, and a size of type is not
 * duplicated because two components reach for it. So "where may this be used"
 * has to travel WITH the element, and it has to look different from a fact about
 * the element (`24 px`, `utf-8`) -- filled rather than outlined, so a reader can
 * tell a suggestion from a measurement at a glance.
 */
export function UseTags({ use }: { use: readonly string[] }) {
  if (use.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: chrome.space.xs, flexWrap: "wrap" }}>
      {use.map((u) => (
        <span
          key={u}
          style={{
            display: "inline-block",
            background: chrome.color.accentSoft,
            border: `1px solid transparent`,
            borderRadius: chrome.radius.pill,
            color: chrome.color.accent,
            font: `${chrome.font.weight.medium} ${chrome.font.size.xs}px ${chrome.font.family}`,
            padding: `2px ${chrome.space.sm}px`,
            whiteSpace: "nowrap",
          }}
        >
          {u}
        </span>
      ))}
    </span>
  );
}
