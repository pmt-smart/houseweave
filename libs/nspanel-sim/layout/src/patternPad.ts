// The pattern pad, as nodes -- shared by every theme, the way
// `listRow.ts` is.
//
// Nine dots in a 3 x 3 square the finger joins, like a phone's. What the pad
// asks of the glass is not a component's: the finger is followed by the gesture
// block every page already carries (one TouchCap, one 50 ms Timer), which lights
// each dot it reaches and draws the line to it, so the node says where the dots
// are and the compile step writes the tests. Which colours they light in is a
// look, and each theme passes its own.
import type { PatternPadLayout } from "./components.js";
import { colorSwitch, colorToken, numberValue, type Box, type ColorToken, type PanelNode, type Size } from "./node.js";

export const PATTERN_PAD = {
  /** a dot's box: the icon font's own height, and no bigger than that */
  dot: 32,
  /** the largest a cell gets: 96 px, 15 mm on the US portrait */
  maxCell: 96,
} as const;

export interface PatternPadLook {
  /** a dot the finger has not reached */
  dot: ColorToken;
  /** a dot it has, and the line between two */
  lit: ColorToken;
  /** every dot, when the pattern was wrong */
  wrong: ColorToken;
}

/** A cell of the pad: the largest third of its box, up to `maxCell` -- 78 px on the EU panel, 96 on the US. */
export function patternCell(size: Size): number {
  return Math.min(PATTERN_PAD.maxCell, Math.floor(Math.min(size.w, size.h) / 3));
}

/**
 * The pad, centred in its box. A dot's box is small on purpose: only the dot is
 * drawn, so the lines between dots stay visible, and the finger counts as on a
 * dot within a third of a cell of its centre -- not anywhere in the cell. With
 * the cells touching, a whole-cell target would make the corner-to-corner
 * stroke from 1 to 6 impossible without passing through 2 or 5; with the
 * radius, the finger goes between dots, as on a phone.
 */
export function patternPadNodes(props: PatternPadLayout, size: Size, look: PatternPadLook): PanelNode[] {
  const cell = patternCell(size);
  const left = Math.floor((size.w - cell * 3) / 2);
  const top = Math.floor((size.h - cell * 3) / 2);
  const d = Math.min(PATTERN_PAD.dot, cell);
  const dots: Box[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      dots.push({ x: left + c * cell + Math.floor((cell - d) / 2), y: top + r * cell + Math.floor((cell - d) / 2), w: d, h: d });
  const color = props.wrong.kind === "binding"
    ? colorSwitch(props.wrong.path, look.wrong, look.dot, props.wrong.sample)
    : colorToken(numberValue(props.wrong) !== 0 ? look.wrong : look.dot);
  return [{
    kind: "pattern", id: "pad", box: { x: 0, y: 0, w: size.w, h: size.h },
    dots, radius: Math.floor(cell / 3), role: "dotOn", color, lit: look.lit, font: "icon", action: props.drawn,
  }];
}
