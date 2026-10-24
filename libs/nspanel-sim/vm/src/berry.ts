// The Berry VM of Tasmota, in WebAssembly (wasm/berry.mjs, built by
// scripts/build-wasm.mjs from the firmware submodule's sources).
//
// This is only the machine: run a chunk, call a global, a file system for
// load() and persist, and the one native function the Berry side has for asking
// the page anything, `_host(op, arg)`. The Tasmota layer (tasmota/*.be) and the
// panel's own files are Berry, loaded into it (panel.ts).
import createBerryModule, { type BerryModule } from "../wasm/berry.mjs";

/** What the button driver compiled into the VM asks of Tasmota's core (native/tasmota_core.cpp). */
export interface CoreHooks {
  millis(): number;
  power(device: number, state: number, source: number): void;
  beep(count: number): void;
  log(level: number, message: string): void;
  rules(subtopic: string, json: string): void;
  nvmLoad(ns: string, key: string): string | null;
  nvmSave(ns: string, key: string, hex: string): void;
}

export interface BerryOptions {
  /** a line Berry printed */
  print?: (line: string) => void;
  /** Berry's `_host(op, arg)`: a string back, or null for nil */
  host?: (op: string, arg: string | null) => string | null | undefined;
  core?: CoreHooks;
}

export class Berry {
  readonly module: BerryModule;

  private constructor(module: BerryModule) {
    this.module = module;
  }

  static async create(options: BerryOptions = {}): Promise<Berry> {
    const print = options.print ?? ((line: string) => console.log(line));
    const module = await createBerryModule({ print, printErr: print });
    const vm = new Berry(module);
    vm.setHost(options.host ?? (() => null));
    if (options.core) vm.setCore(options.core);
    module.ccall("bh_init", "number", [], []);
    return vm;
  }

  setHost(host: (op: string, arg: string | null) => string | null | undefined) {
    this.module.berryHost = host;
  }

  setCore(core: CoreHooks) {
    const m = this.module;
    m.coreMillis = () => core.millis();
    m.corePower = (d, s, src) => core.power(d, s, src);
    m.coreBeep = (n) => core.beep(n);
    m.coreLog = (l, msg) => core.log(l, msg);
    m.coreRules = (t, j) => core.rules(t, j);
    m.coreNvmLoad = (ns, k) => core.nvmLoad(ns, k);
    m.coreNvmSave = (ns, k, h) => core.nvmSave(ns, k, h);
  }

  /** a C string, or null for NULL: ccall's "string" makes both "" */
  private text(ptr: number): string | null {
    return ptr === 0 ? null : this.module.UTF8ToString(ptr);
  }

  /**
   * How the compiler takes the chunks and files that come after: globals by name
   * and strict mode, the REPL's -g and -s. Both are off after create(), as the
   * REPL starts; the device has both on, and SimPanel sets them so.
   */
  compiler(options: { namedGlobals: boolean; strict: boolean }) {
    this.module.ccall("bh_compiler", null, ["number", "number"], [options.namedGlobals ? 1 : 0, options.strict ? 1 : 0]);
  }

  /** A chunk of Berry: 0, or Berry's error code with error() saying what (it is printed too). */
  run(source: string, name = "chunk"): number {
    return this.module.ccall("bh_run", "number", ["string", "string"], [source, name]);
  }

  /** A global function called with one string: its result as a string, or null for nil or an error. */
  call(fn: string, arg = ""): string | null {
    return this.text(this.module.ccall("bh_call", "number", ["string", "string"], [fn, arg]));
  }

  /** What the last run() or call() raised, "" when nothing. */
  error(): string {
    return this.module.ccall("bh_error", "string", [], []);
  }

  // --- the file system the VM sees: load(), persist, the panel's configuration --------------

  writeFile(path: string, data: string | Uint8Array) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) this.mkdirp(dir);
    this.module.FS.writeFile(path, data);
  }

  readFile(path: string): string {
    return this.module.FS.readFile(path, { encoding: "utf8" });
  }

  exists(path: string): boolean {
    return this.module.FS.analyzePath(path).exists;
  }

  remove(path: string) {
    if (this.exists(path)) this.module.FS.unlink(path);
  }

  /** a file moved to another name, over the one that is there, as rename(2) does */
  rename(from: string, to: string) {
    this.module.FS.rename(from, to);
  }

  list(dir = "/"): string[] {
    return this.module.FS.readdir(dir).filter((n: string) => n !== "." && n !== "..");
  }

  mkdirp(dir: string) {
    let at = "";
    for (const part of dir.split("/").filter(Boolean)) {
      at += "/" + part;
      if (!this.exists(at)) this.module.FS.mkdir(at);
    }
  }

  // --- the panel's button driver, from the firmware's own source (native/tasmota_core.cpp) ---

  /** FUNC_PRE_INIT: it reads its settings back from the NVS */
  buttonsInit(devices: number) {
    this.module.ccall("bh_btn_init", null, ["number"], [devices]);
  }

  /** One scan of a button, as support_button.ino makes one: true when the driver took it. */
  buttonScan(index: number, pressed: boolean): boolean {
    return this.module.ccall("bh_btn_scan", "number", ["number", "number"], [index, pressed ? 1 : 0]) === 1;
  }

  /** A command of the driver, split as Tasmota splits one: its response, or null when not its own. */
  buttonCommand(name: string, index: number, usridx: boolean, payload: number, data: string): string | null {
    return this.text(this.module.ccall("bh_btn_command", "number", ["string", "number", "number", "number", "string"],
      [name, index, usridx ? 1 : 0, payload, data]));
  }
}
