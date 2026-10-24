// The QR code, as nodes -- shared by every theme, the way
// `patternPad.ts` is.
//
// One Nextion Qrcode, square, centred in its box. The glass encodes the text
// and draws the symbol, so the node says only where it goes, how many bytes it
// may carry and which two colours it is drawn in. A camera reads a code dark on
// light, so a theme picks its darkest and its lightest colour, and the box is
// the quiet zone the symbol needs around it.
import type { QrCodeLayout } from "./components.js";
import type { ColorToken, PanelNode, Size } from "./node.js";

/**
 * How many bytes a QR carries when its placement does not say: 134, a version
 * 6 at level L. The longest `WIFI:` string is 113 bytes, and a
 * Nextion Qrcode reserves page RAM by the QR version its capacity needs:
 * at 134 at most 2 712 bytes, measured to compile beside a
 * page of 868, where 154 -- a version 7, the most our 100 bytes of globals
 * allow -- holds back 2 823, and leaves the US portrait's QR page 3 to 27 bytes
 * short.
 */
export const QR_CAPACITY = 134;

export interface QrCodeLook {
  /** the modules */
  dark: ColorToken;
  /** the ground and the quiet zone around them */
  light: ColorToken;
}

export function qrCodeNodes(props: QrCodeLayout, size: Size, look: QrCodeLook): PanelNode[] {
  const side = Math.min(size.w, size.h);
  return [{
    kind: "qrcode", id: "qCode",
    box: { x: Math.floor((size.w - side) / 2), y: Math.floor((size.h - side) / 2), w: side, h: side },
    value: props.code, capacity: props.capacity ?? QR_CAPACITY, dark: look.dark, light: look.light,
  }];
}
