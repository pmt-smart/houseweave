// `keyboard`, for every theme and both its layouts. See `Label.tsx` for why
// this is one file.
//
// The only component whose state lives outside the panel runtime, and that is
// not an exception -- it is the same division the hardware makes. On the glass
// the line being typed lives in a Variable and every key edits it without
// telling anyone; only OK sends a frame. So the caller owns the line here too,
// and hears about it when it is finally committed.
//
// The rules a key applies -- `applyKey` for QWERTY, `applyCycleKey` for the
// keypad's multi-tap -- come from `@nspanel-sim/layout`, which is also what the
// emitter's Nextion instructions per key are generated from: two machines, one
// definition of what a key means.
import { useEffect, useRef, useState } from "react";
import {
  applyCycleKey, applyKey, keyCap, layoutFor, literal, literalNumber,
  type MultiTap,
} from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import type { KeyboardProps } from "../contracts";

export function Keyboard({
  value, max, onChange, caps: capsProp, onCapsChange, onCommit, onCancel, onSwitchTo, ways,
}: KeyboardProps) {
  const theme = useThemeId();
  const { size, variant } = usePlacement();
  const style = usePanelStyle();
  // Controlled when the caller wants the line, local when it does not. The
  // simulator wants it: the same screen is drawn three times, side by side, and
  // three copies of a half-typed name is the disagreement those columns exist
  // to rule out.
  const [own, setOwn] = useState(value);
  const line = onChange ? value : own;
  const setLine = (next: (l: string) => string) => {
    if (onChange) onChange(next(value));
    else setOwn(next);
  };
  const [ownCaps, setOwnCaps] = useState(false);
  const caps = onCapsChange ? (capsProp ?? false) : ownCaps;
  const setCaps = (next: boolean) => (onCapsChange ? onCapsChange(next) : setOwnCaps(next));
  // Where the multi-tap is between presses. A ref and not state: nothing on
  // screen depends on it, and a render per keystroke to store a deadline would
  // be a render for nothing.
  const tap = useRef<MultiTap | null>(null);
  // While a keypad's character can still change, the caret is off, as on the glass: this is
  // the window's end, which draws it again
  const [open, setOpen] = useState(0);
  useEffect(() => {
    if (open === 0) return;
    const t = setTimeout(() => setOpen(0), Math.max(0, open - Date.now()));
    return () => clearTimeout(t);
  }, [open]);

  const layout = layoutFor(theme, "keyboard", variant);
  if (!layout) return <MissingLayout theme={theme} id="keyboard" variant={variant} />;

  // the ways the project binds, as the layout reads them: a key that switches is drawn for each (`waysOf`)
  const way = (to: "letters" | "keypad" | "symbols") => (ways === undefined || ways.includes(to) ? { kind: "navigate" as const, screen: to } : undefined);
  const nodes = layout({ value: literal(line), max: literalNumber(max), toLetters: way("letters"), toKeypad: way("keypad"), toSymbols: way("symbols") }, size, style).map((node) =>
    // CAPS on the glass rewrites the captions in place; here the nodes are
    // rebuilt on every render, so the same thing is one substitution.
    node.kind === "key" && node.capsCap !== undefined
      ? { ...node, cap: caps ? node.capsCap : node.cap }
      : node.kind === "field" && open !== 0 ? { ...node, caretOff: true } : node,
  );

  return (
    <PanelNodes
      nodes={nodes}
      onKey={(key) => {
        if (key.role === "caps") { setCaps(!caps); return; }
        if (key.role === "layout") { if (key.to) onSwitchTo?.(key.to); return; }
        if (key.role === "cancel") { onCancel?.(); return; }
        if (key.role === "commit") {
          // Empty is refused on the glass and blank-only by the runtime; both
          // refusals leave the keyboard open, so both are one test here.
          if (line.trim() !== "") onCommit?.(line.trim());
          return;
        }
        if (key.role === "cycle" && key.cycle) {
          const next = applyCycleKey(line, { id: key.id, cycle: key.cycle }, tap.current, max, Date.now(), caps);
          tap.current = next.tap;
          setLine(() => next.line);
          setOpen(next.tap ? next.tap.until : 0);
          return;
        }
        // Any other key ends whatever cycle was open: the character it put there
        // is final, and the next press on that key starts a new one.
        tap.current = null;
        setOpen(0);
        setLine((l) => applyKey(l, { role: key.role, cap: keyCap(key, caps) }, max));
      }}
    />
  );
}
