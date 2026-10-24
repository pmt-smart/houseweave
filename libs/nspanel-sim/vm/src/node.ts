// The VM under node, for the tests and scripts: a folder of this machine
// mounted where Berry looks for it.
import { Berry, type BerryOptions } from "./berry.js";

export async function loadBerry(options: BerryOptions = {}) {
  const vm = await Berry.create(options);
  return Object.assign(vm, {
    /** a real folder at a virtual path: the VM's paths are its own */
    mount(virtual: string, real: string) {
      vm.mkdirp(virtual);
      vm.module.FS.mount(vm.module.NODEFS, { root: real }, virtual);
    },
  });
}
