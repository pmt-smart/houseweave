// How a touch gets off the glass.
//
// Measured, not invented. The frame is joBr99's and our own
// `berry/nextion_driver.be` already decodes it -- it splits on `55 BB`, takes
// `msg[4..-3]` as the payload and hands it to `on_event("customrecv", ...)`. So
// the transport is proven on both ends and nothing here is a new protocol; what
// IS ours is the payload vocabulary, and that is a definition rather than a
// guess because we generate the page and the Berry from one manifest.
//
//   55 BB | len (u16 LE) | payload (ASCII) | crc (u16 LE)
//
// The CRC is CRC-16/MODBUS over everything before it: reflected polynomial
// 0xA001, init 0xFFFF, which is `crc16` in the driver and `crcrest 1,0xffff`
// on the Nextion side.
//
// WHERE WE DIVERGE FROM HIM, and it is a real simplification. His payloads are
// built at run time -- `tSend.txt="event,buttonPress2,"+entn1.txt+",button"`,
// then `btlen`, `crcrest`, four `crcput` and four `prints` -- because his pages
// are generic and the entity is only known on the panel. Ours are known at
// COMPILE time, so the whole frame is a constant and the component's event is a
// single `printh` of literal bytes. No scratch Text component per page, no CRC
// instructions on the glass, and nothing to get wrong at run time.

/** CRC-16/MODBUS: reflected 0xA001, init 0xFFFF. `crc16` in nextion_driver.be. */
export function crc16Modbus(bytes: readonly number[]): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc & 0xffff;
}

/**
 * What a component says when it is touched.
 *
 * The objname and the page rather than the semantic event: the page carries no
 * knowledge of what "open the light detail" means, and the mapping stays in the
 * manifest, in one place, read by the generated Berry. It is also shorter on the
 * wire, which matters because the panel's serial buffer is 1024 bytes
 *.
 */
export function touchPayload(page: string, objname: string, gesture: "tap" | "hold" | "show" | "left" | "right" | "up" | "down" | "touch" | "version"): string {
  return `ev,${page},${objname},${gesture}`;
}

/**
 * The objname a PAGE reports under, for the one event a page has of its own:
 * `show`, sent from its `load` handler. Not a component's name -- no
 * component may be called this, because a Nextion objname is letters, digits
 * and underscore and this has none of the digits every placement's name ends
 * in (`objectName`).
 */
export const PAGE_OBJNAME = "page";

/** The whole frame as bytes: header, length, payload, CRC. */
export function encodeFrame(payload: string): number[] {
  const body: number[] = [];
  for (let i = 0; i < payload.length; i++) {
    const code = payload.charCodeAt(i);
    if (code > 0x7f) throw new RangeError(`payload is ASCII only: ${JSON.stringify(payload)}`);
    body.push(code);
  }
  const frame = [0x55, 0xbb, body.length & 0xff, (body.length >> 8) & 0xff, ...body];
  const crc = crc16Modbus(frame);
  return [...frame, crc & 0xff, (crc >> 8) & 0xff];
}

/**
 * The frame as one Nextion instruction.
 *
 * `printh` takes literal hex bytes, which is exactly what a compile-time-known
 * frame is. Uppercase because that is how the Editor writes its own.
 */
export function printhFrame(payload: string): string {
  return `printh ${encodeFrame(payload).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ")}`;
}

/**
 * How long a press has to last to be a long press, in milliseconds.
 *
 * 500, measured: joBr99's `tmLP` timer carries `tim = 244,1`, which is 0x01F4.
 * Worth stating because the panel DOES discriminate the two by itself -- press
 * arms the timer, release disarms it, and if it fires it was a hold. An earlier
 * comment in `emit.ts` claimed this was impossible without the ESP32, and his
 * own file disproves it.
 */
export const HOLD_MS = 500;

/**
 * How often a slider may report while the finger drags, in milliseconds.
 *
 * A Nextion fires a Touch Move event at its touch scan rate and sends nothing
 * by itself during the drag ("Touch Move has no Send Component
 * ID", to protect the 1024-byte serial buffer). Reporting by hand on every
 * event would be dozens of frames a second; joBr99 gates his value reports
 * with a 100 ms Timer (`tmCooldown`, tim=100), and so do we -- a Timer per
 * slider that re-arms the report when it fires.
 */
export const SLIDE_COOLDOWN_MS = 100;

/**
 * The gestures whose frame carries a value after the fourth comma.
 *
 * `tap` and `hold` are here for the touches that CARRY a number they did not
 * make: a row of a paged list reports which page the list is on, read off the
 * page-rail's own slider at the moment of the touch (`EmitOptions.carry`). The
 * glass is where that page lives, so the other side never has to remember it.
 */
export type ValueGesture = "change" | "slide" | "text" | "tap" | "hold";

/**
 * The start of a value-carrying payload: `ev,<page>,<objname>,<gesture>,` --
 * the value is appended ON THE GLASS, so this is a prefix and not a payload.
 */
export function valuePayloadPrefix(page: string, objname: string, gesture: ValueGesture): string {
  return `ev,${page},${objname},${gesture},`;
}

/**
 * The Nextion instructions that send a frame whose payload ends in a number
 * the glass knows and we do not -- a slider's position.
 *
 * `printhFrame` will not do: its bytes are compile-time constants, and the
 * value is not. So the frame is built on the glass the way joBr99 builds his
 * (`event,buttonPress2,…,number-set,` + `covx hSpeed.val`), instruction for
 * instruction from his Touch Release handlers:
 *
 *   covx      the number as text, into a scratch string
 *   btlen     the payload's length into sys0
 *   crcrest / crcputh / crcputs   the CRC-16/MODBUS over 55 BB, length, payload
 *   printh / prints               header, length, payload, CRC
 *
 * `sendVar` and `tmpVar` are two string Variables on the same page (his are
 * `tSend`, a Vari with txt_maxl 200, and `tTmp`); the emitter asks the page for
 * them once and every slider on it shares them. The frame that comes out is
 * exactly what `encodeFrame` would have produced for the same payload, CRC
 * included -- `berry/nextion_driver.be` does not verify the CRC today, but the
 * wire carries a correct one so that it may.
 */
export function valueFrameLines(page: string, objname: string, gesture: ValueGesture, valueExpr: string, sendVar: string, tmpVar: string): string[] {
  return [
    `${sendVar}.txt="${valuePayloadPrefix(page, objname, gesture)}"`,
    `covx ${valueExpr},${tmpVar}.txt,0,0`,
    `${sendVar}.txt+=${tmpVar}.txt`,
    `btlen ${sendVar}.txt,sys0`,
    `crcrest 1,0xffff`,
    `crcputh 55 bb`,
    `crcputs sys0,2`,
    `crcputs ${sendVar}.txt,0`,
    `printh 55 bb`,
    `prints sys0,2`,
    `prints ${sendVar}.txt,0`,
    `prints crcval,2`,
  ];
}

/**
 * The instructions that send what the keyboard typed.
 *
 * `valueFrameLines` with the `covx` taken out: the payload already ends in a
 * string, so there is nothing to convert. Everything else is the same recipe,
 * because it is the same frame.
 *
 * The value is appended raw. It is the payload's last field, and the reader
 * takes all of it after the fourth comma (berry/panel_runtime.be), so a comma
 * typed stays in the text. No keyboard has a double quote, the symbols' page
 * included, so
 * nothing typed can end a Nextion string early.
 */
export function textFrameLines(page: string, objname: string, textVar: string, sendVar: string, tmpVar: string): string[] {
  void tmpVar;
  return [
    `${sendVar}.txt="${valuePayloadPrefix(page, objname, "text")}"`,
    `${sendVar}.txt+=${textVar}.txt`,
    `btlen ${sendVar}.txt,sys0`,
    `crcrest 1,0xffff`,
    `crcputh 55 bb`,
    `crcputs sys0,2`,
    `crcputs ${sendVar}.txt,0`,
    `printh 55 bb`,
    `prints sys0,2`,
    `prints ${sendVar}.txt,0`,
    `prints crcval,2`,
  ];
}

/**
 * The Berry side of `textFrameLines`: `ev,<page>,<objname>,text,<string>` split
 * into the manifest key and the text, which is everything after the fourth
 * comma and is NOT required to be a number.
 */
export function splitTextPayload(payload: string): { key: string; text: string } | null {
  if (!payload.startsWith("ev,")) return null;
  const rest = payload.slice(3);
  let seen = 0, cut = -1;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === ",") { seen++; if (seen === 3) { cut = i; break; } }
  }
  if (cut < 0) return null;
  return { key: rest.slice(0, cut), text: rest.slice(cut + 1) };
}

/**
 * The Berry side of `valueFrameLines`: `ev,<page>,<objname>,<gesture>,<n>` split
 * into the manifest key and the number. Kept here so the test that proves the
 * two agree lives beside them.
 */
export function splitValuePayload(payload: string): { key: string; value: number } | null {
  if (!payload.startsWith("ev,")) return null;
  const rest = payload.slice(3);
  const parts = rest.split(",");
  if (parts.length !== 4) return null;
  const value = Number(parts[3]);
  if (!Number.isInteger(value)) return null;
  return { key: parts.slice(0, 3).join(","), value };
}
