#!/usr/bin/env node
// Checks every relative Markdown link in the repository's documentation
// and fails (exit 1) if any target file is missing.
//
//   node scripts/check-doc-links.mjs
//
// Scope: all *.md files outside node_modules, dist, the Tasmota submodule,
// the vendored reference copies and each machine's own tools (.tools). External links (http/https/mailto)
// and in-page anchors (#...) are not checked; a trailing ":line" or
// ":line-line" suffix on a path (the clickable-reference convention used
// in docs/) is stripped before the existence check. Links inside fenced
// code blocks are ignored.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// tmp/ holds throwaway clones of other repos (gitignored), not our docs; .tools/
// holds what each machine installs for itself (gitignored), whose
// packages bring their own READMEs
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "firmware", "reference", "tmp", ".tools"]);

function* markdownFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* markdownFiles(full);
    else if (entry.endsWith(".md")) yield full;
  }
}

const LINK = /\]\(([^)\s]+?)(?:#[^)]*)?\)/g;
let files = 0;
let broken = 0;

for (const file of markdownFiles(root)) {
  files++;
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const match of text.matchAll(LINK)) {
    let target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    target = target.replace(/:\d+(?:-\d+)?$/, "");
    const resolved = path.resolve(path.dirname(file), target);
    if (!existsSync(resolved)) {
      broken++;
      console.log(`BROKEN  ${path.relative(root, file)}  ->  ${match[1]}`);
    }
  }
}

console.log(`${files} markdown files checked; broken links: ${broken}`);
process.exit(broken ? 1 : 0);
