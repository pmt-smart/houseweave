// The emscripten module built by scripts/build-wasm.mjs: Berry's VM, the bridge
// of native/host.c, the button driver of native/tasmota_core.cpp, and the WiFi
// station and ESP-NOW drivers of native/radio_core.cpp.
export interface BerryModule {
  ccall(name: string, returns: "number" | "string" | null, types: string[], args: unknown[]): any;
  UTF8ToString(ptr: number): string;
  FS: any;
  NODEFS: any;
  /** Berry's `_host(op, arg)`: set by the page */
  berryHost?: (op: string, arg: string | null) => string | null | undefined;
  coreMillis?: () => number;
  corePower?: (device: number, state: number, source: number) => void;
  coreBeep?: (count: number) => void;
  coreLog?: (level: number, message: string) => void;
  coreRules?: (subtopic: string, json: string) => void;
  coreNvmLoad?: (ns: string, key: string) => string | null;
  coreNvmSave?: (ns: string, key: string, hex: string) => void;
  /** an ESP-NOW frame the device sends: true when a unicast is acknowledged, false when it is not, and -1 when the radio has no room for it */
  radioSend?: (from: string, to: string, hex: string, encrypt: number, lmk: string, channel: number) => boolean | number;
  /** a command line the ESP-NOW driver runs for the peer */
  radioCommand?: (line: string) => void;
}
export default function createBerryModule(options?: {
  print?: (line: string) => void;
  printErr?: (line: string) => void;
}): Promise<BerryModule>;
