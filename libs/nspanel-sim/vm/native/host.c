/*
 * The Berry VM of Tasmota, embedded in the simulator.
 *
 * Nothing of the panel's behaviour is written here. This file makes the VM
 * (firmware/tasmota/lib/libesp32/berry, the fork Tasmota runs on the ESP32),
 * gives it ONE native function, `_host(op, arg)`, that asks the page hosting
 * it, and lets that page run a chunk of Berry or call a global. The Tasmota
 * layer on top (vm/tasmota/*.be) is Berry, and the panel's own code is loaded
 * as it is on the device.
 *
 * Strings cross the boundary as UTF-8. Anything binary -- the bytes on the
 * Nextion's UART -- crosses as hex, so a NUL never ends a string early.
 */
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <emscripten.h>
#include "berry.h"
#include "be_mapping.h"
#include "be_vm.h"

static bvm *vm = NULL;
static char last_error[1024];

/* the page's answer to `_host(op, arg)`: a string, or nil */
EM_JS(char *, js_host, (const char *op, const char *arg, int has_arg), {
  const r = Module.berryHost(UTF8ToString(op), has_arg ? UTF8ToString(arg) : null);
  return r === null || r === undefined ? 0 : stringToNewUTF8(String(r));
});

static int m_host(bvm *vm) {
  int top = be_top(vm);
  const char *op = top >= 1 ? be_tostring(vm, 1) : "";
  int has = top >= 2 && !be_isnil(vm, 2);
  const char *arg = has ? be_tostring(vm, 2) : NULL;
  char *r = js_host(op, arg, has);
  if (r) {
    be_pushstring(vm, r);
    free(r);
  } else {
    be_pushnil(vm);
  }
  be_return(vm);
}

/* An uncaught exception: kept for the page, and dumped as the REPL dumps one. */
static void keep_error(void) {
  snprintf(last_error, sizeof(last_error), "%s: %s", be_tostring(vm, -2), be_tostring(vm, -1));
  be_dumpexcept(vm);
}

/* the VM, for the drivers compiled beside this that register natives in it (radio_core.cpp) */
bvm *bh_vm(void) { return vm; }

EMSCRIPTEN_KEEPALIVE int bh_init(void) {
  if (vm) be_vm_delete(vm);
  vm = be_vm_new();
  be_set_ctype_func_handler(vm, be_call_ctype_func);
  /* `import x` finds x.be at the root of the file system, as on the device */
  be_module_path_set(vm, "/");
  be_regfunc(vm, "_host", m_host);
  last_error[0] = 0;
  return 0;
}

/*
 * How the compiler takes what it is given from now on, as the REPL's -g and -s
 * set it. Tasmota sets both on the device (xdrv_52_9_berry.ino): globals by
 * name, and strict, which refuses an undeclared global and a redefined builtin.
 */
EMSCRIPTEN_KEEPALIVE void bh_compiler(int named_globals, int strict) {
  if (named_globals) comp_set_named_gbl(vm); else comp_clear_named_gbl(vm);
  if (strict) comp_set_strict(vm); else comp_clear_strict(vm);
}

/* Runs a chunk of source: 0, or a Berry error code with bh_error() saying what. */
EMSCRIPTEN_KEEPALIVE int bh_run(const char *source, const char *name) {
  int top = be_top(vm);
  last_error[0] = 0;
  int res = be_loadbuffer(vm, name, source, strlen(source));
  if (res == BE_OK) res = be_pcall(vm, 0);
  if (res == BE_EXCEPTION) keep_error();
  else if (res != BE_OK) snprintf(last_error, sizeof(last_error), "%s", be_tostring(vm, -1));
  be_pop(vm, be_top(vm) - top);
  return res;
}

/* Calls a global function with one string argument; its result as a string, or NULL. */
EMSCRIPTEN_KEEPALIVE const char *bh_call(const char *fn, const char *arg) {
  static char *out = NULL;
  free(out);
  out = NULL;
  last_error[0] = 0;
  int top = be_top(vm);
  be_getglobal(vm, fn);
  if (be_isnil(vm, -1)) {
    snprintf(last_error, sizeof(last_error), "no global %s", fn);
    be_pop(vm, be_top(vm) - top);
    return NULL;
  }
  be_pushstring(vm, arg ? arg : "");
  int res = be_pcall(vm, 1);
  if (res == BE_OK) {
    if (!be_isnil(vm, top + 1)) out = strdup(be_tostring(vm, top + 1));
  } else if (res == BE_EXCEPTION) {
    keep_error();
  }
  be_pop(vm, be_top(vm) - top);
  return out;
}

EMSCRIPTEN_KEEPALIVE const char *bh_error(void) { return last_error; }
