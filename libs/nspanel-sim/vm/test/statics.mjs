// The statics of a firmware's classes, read whole. The firmware keeps them in its
// flash, where a write does not raise but hangs or crashes the device, and no try
// catches it. Here the classes are files, and a write would work: a
// test reads them as the device came up, and again after it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../dist/files-node.js";

/** the classes of berry/ files, by the line each file names its own with */
export function classesOf(files) {
  return files.map((f) => /^#@\s*solidify:(\w+)/m.exec(readFileSync(join(REPO, "berry", f), "utf8"))[1]);
}

/** a function for the device's VM, `_statics`, that gives every static of the classes, one a line */
export function staticsScript(classes) {
  return `def _statics(_)
    import introspect
    import global
    var out = []
    for name: ${JSON.stringify(classes)}
        var c = global.(name)
        for m: introspect.members(c)
            var v = introspect.get(c, m)
            var t = type(v)
            if t != "function" && t != "closure" && t != "var"  out.push(name + "." + m + " = " + str(v)) end
        end
    end
    return out.concat("\\n")
end`;
}
