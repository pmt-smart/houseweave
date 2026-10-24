// The simulator's content, loaded from the repository rather than compiled in.
//
// Design systems and projects are JSON documents on disk. Vite
// picks them up at build time with import.meta.glob, so adding one is adding a
// file — no code to edit — and saving it reloads the page.
//
// Everything is validated here, at the door, with the same `core` validator the
// headless build uses. A document that does not parse does NOT take the tool
// down: it lands in `problems`, the rest keeps working, and the dropdown shows
// what is broken. The alternative — throwing at import time — turns one bad
// character into a blank page.
import {
  parseTheme, parseProject, checkProjectAgainstThemes, checkPlacements,
  ValidationError, formatIssue,
  type Theme, type Project,
} from "@nspanel-sim/core";

const themeFiles = import.meta.glob("../../themes/*/theme.json", { eager: true, import: "default" });
const projectFiles = import.meta.glob("../../projects/*/project.json", { eager: true, import: "default" });

export interface ContentProblem {
  /** the file, as written in the glob, so the message points at something openable */
  file: string;
  lines: string[];
}

function shortPath(key: string): string {
  return key.replace(/^\.\.\/\.\.\//, "");
}

function describe(e: unknown, file: string): ContentProblem {
  if (e instanceof ValidationError) return { file, lines: e.issues.map(formatIssue) };
  return { file, lines: [`  ${(e as Error).message}`] };
}

const problems: ContentProblem[] = [];

/**
 * Which directory each theme came from. The id and the folder name
 * happen to match today, but nothing enforces that, and the font files are
 * found by folder -- so the mapping is recorded rather than assumed.
 */
export const themeDirs = new Map<string, string>();

export const themes: Theme[] = Object.entries(themeFiles)
  .map(([key, raw]) => {
    const file = shortPath(key);
    try {
      const parsed = parseTheme(raw, file);
      const dir = /themes\/([^/]+)\//.exec(file)?.[1];
      if (dir !== undefined) themeDirs.set(parsed.id, dir);
      return parsed;
    } catch (e) {
      problems.push(describe(e, file));
      return null;
    }
  })
  .filter((d): d is Theme => d !== null)
  .sort((a, b) => a.name.localeCompare(b.name));

export const projects: Project[] = Object.entries(projectFiles)
  .map(([key, raw]) => {
    const file = shortPath(key);
    try {
      const project = parseProject(raw, file);
      // layer 2 of the funnel: the project against the themes it uses.
      // Parsing alone cannot do this, because a component id is only wrong once
      // you know which themes are on the table.
      checkProjectAgainstThemes(project, themes);
      // layer 3: what each placement has to satisfy -- the touch minimum its own
      // theme declares, the props its component cannot work without, and
      // not covering another placement.
      checkPlacements(project, themes);
      return project;
    } catch (e) {
      problems.push(describe(e, file));
      return null;
    }
  })
  .filter((p): p is Project => p !== null)
  .sort((a, b) => a.name.localeCompare(b.name));

export const contentProblems: readonly ContentProblem[] = problems;

export function themeById(id: string): Theme | undefined {
  return themes.find((d) => d.id === id);
}

export function projectById(id: string): Project | undefined {
  return projects.find((p) => p.id === id);
}

/** The themes a project draws from, in the order it declares them. */
export function themesOf(project: Project): Theme[] {
  return project.themes.map(themeById).filter((d): d is Theme => d !== undefined);
}
