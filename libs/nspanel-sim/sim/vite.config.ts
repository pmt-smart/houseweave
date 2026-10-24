// The dev server, and one setting that is not cosmetic.
//
// `content.ts` reads the projects and the themes with `import.meta.glob` from
// `../../projects` and `../../themes` -- OUTSIDE this package. Vite's watcher
// does not follow a glob out of the root on its own, so editing a
// `project.json` or a `theme.json` would change nothing on screen until the
// server restarted: the page keeps serving the JSON it compiled at boot, and a
// reload does not help because the module is not invalidated -- a renamed screen
// that will not rename, a theme role that reads as missing while it is on disk,
// a stale module graph. Naming the directories here is what makes an edit to a document
// behave like an edit to a source file.
import { dirname, relative, resolve, sep } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, "..");
// The simulated panel runs the repo's own files (src/panelFiles.ts): the
// panel's Berry (autoexec.be, berry/) and Tasmota's Berry library, from the
// firmware submodule -- all outside this workspace.
const repo = resolve(workspace, "../..");

/**
 * Watch the documents, and reload when one changes.
 *
 * `server.watch.ignored` with a negated pattern does NOT do this: the page keeps
 * its stale copy. What works is asking the
 * watcher for the paths by hand and answering a change with a full reload:
 * these are DATA, eagerly imported, so there is no module to hot-swap, only a
 * page to build again.
 */
const watchDocuments = (paths: string[]) => ({
  name: "nspanel-watch-documents",
  configureServer(server: import("vite").ViteDevServer) {
    for (const path of paths) server.watcher.add(path);
    server.watcher.on("change", (file: string) => {
      if (!paths.some((path) => file.startsWith(path))) return;
      compileFor(file);
      server.moduleGraph.invalidateAll();
      server.ws.send({ type: "full-reload" });
    });
  },
});

/**
 * The panel's files the app takes as text (`?raw`, src/panelFiles.ts), with LF line ends whatever the checkout's. A Windows checkout of the
 * firmware submodule has some files in CRLF and some in LF, which git counts as the same; the Linux one Home Assistant compiles the app from
 * has them as git keeps them. The Berry VM reads both alike, but the bundle would differ from one checkout to another, and the
 * add-on's package script fingerprints it: with LF everywhere, the same source compiles to the same app.
 */
const textWithLf = () => ({
  name: "nspanel-text-with-lf",
  enforce: "pre" as const,
  load(id: string) {
    const file = /^(.*\.(?:be|jsonl))\?raw$/.exec(id)?.[1];
    return file ? `export default ${JSON.stringify(readFileSync(file, "utf8").replace(/\r\n/g, "\n"))};` : null;
  },
});

/**
 * The glass runs what the .tft compiles, so an edit to a project, or to a theme
 * its projects draw with, is compiled again before the page loads: the
 * generator (export/scripts/build-project-hmi.mjs) writes the scenario and the
 * runtime, for both panels, in a fraction of a second each. It runs on the
 * built layout/, core/ and export/ (their dist/), as it always does: an edit to
 * their TypeScript needs their build first.
 */
function compileFor(file: string) {
  const rel = relative(workspace, file).split(sep);
  const projectsDir = resolve(workspace, "projects");
  const ids = rel[0] === "projects" && rel[2] === "project.json" ? [rel[1]]
    : rel[0] === "themes" && rel[2] === "theme.json" ? readdirSync(projectsDir).filter((d) => existsSync(resolve(projectsDir, d, "project.json")))
    : [];
  // not the generator's guard tests' (export/test/buildProjectGuards.test.mjs):
  // each writes a throwaway guard-* project, runs the generator and deletes both,
  // and compiled here too, a scenario of it landed after the test had cleaned up
  for (const id of ids.filter((id) => !id.startsWith("guard-"))) {
    for (const device of ["eu-landscape", "us-portrait"]) {
      const r = spawnSync(process.execPath, ["scripts/build-project-hmi.mjs", id, device], { cwd: resolve(workspace, "export"), encoding: "utf8" });
      if (r.status !== 0) console.error(`[nspanel] ${id} ${device} did not compile:\n${r.stderr || r.stdout}`);
    }
  }
}

export default defineConfig({
  // relative addresses everywhere: in Home Assistant the app is served under the ingress's path, and an absolute /assets/ would miss
  base: "./",
  plugins: [
    textWithLf(),
    react(),
    // an edit to the panel's Berry, to a generated project or to the Tasmota
    // layer is on the simulated panel at once: the page loads, the panel boots
    watchDocuments([
      resolve(workspace, "projects"), resolve(workspace, "themes"),
      resolve(repo, "berry"), resolve(repo, "autoexec.be"),
      resolve(workspace, "export/hmi-scenarios"), resolve(workspace, "vm/tasmota"),
    ]),
  ],
  server: {
    fs: {
      // The globs reach out of the package, and of the workspace for the
      // panel's own files; without this the dev server refuses to serve them.
      allow: [repo],
    },
    // The OTA tab asks HouseWeave's server at relative addresses, as it will
    // when that server serves this app in Home Assistant:
    // here they go to the app's port of the one running on this
    // machine, RELEASE_SERVER, or the bench's, 8098 (its nodes' port is the
    // 8099 the house knows it by).
    proxy: {
      "/api": process.env.RELEASE_SERVER ?? "http://localhost:8098",
      "/ota": process.env.RELEASE_SERVER ?? "http://localhost:8098",
    },
  },
});
