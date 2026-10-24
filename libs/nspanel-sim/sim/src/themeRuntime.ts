// Everything each theme needs in order to draw, loaded once per project.
//
// A project may name several, and a placement keeps its own —
// so this is a map and not a single value. Getting that wrong would make
// "mixing" mean borrowing a shape and repainting it in the other system's
// colours, which is not mixing.
import { useEffect, useMemo, useState } from "react";
import {
  loadZiFont, panelPaletteFromTokens, rgb565ToHex,
  type ThemeRuntime, type IconRole, type PanelIconSet, type PanelFontSet, type ZiFont,
} from "@nspanel-sim/ui";
import type { Theme } from "@nspanel-sim/core";
import { layoutStyle } from "@nspanel-sim/layout";
import { fontUrl, iconFontUrls, iconRolesOf } from "./fonts";

/**
 * Loads several `.zi` at once.
 *
 * One effect over a list rather than a hook per font: the number of design
 * systems on screen changes with the project, and a hook called in a loop over
 * a changing list is the classic way to break the rules of hooks. `loadZiFont`
 * caches by URL, so switching between projects that share a font costs nothing.
 */
export function useZiFonts(urls: readonly (string | undefined)[]): Record<string, ZiFont> {
  const key = urls.filter(Boolean).join("|");
  const [fonts, setFonts] = useState<Record<string, ZiFont>>({});
  useEffect(() => {
    let live = true;
    const wanted = key ? key.split("|") : [];
    Promise.all(
      wanted.map((url) => loadZiFont(url).then((font) => [url, font] as const).catch(() => undefined)),
    ).then((pairs) => {
      if (!live) return;
      setFonts(Object.fromEntries(pairs.filter((p): p is readonly [string, ZiFont] => p !== undefined)));
    });
    return () => { live = false; };
  }, [key]);
  return fonts;
}

export interface ThemeRuntimes {
  byId: Record<string, ThemeRuntime>;
  /** every icon font asked for has arrived */
  ready: boolean;
}

export function useThemeRuntimes(systems: readonly Theme[]): ThemeRuntimes {
  // every icon font of every theme: size is a font choice, so a design
  // system carrying 32 and 48 needs both loaded before a component can pick --
  // and every TEXT font too, because the panel tree draws text from the `.zi`
  // (`ZiTextInBox`): the browser's font was 25-28 % wider than the glass
  const urls = systems.flatMap((d) => [...iconFontUrls(d), ...d.fonts.map((f) => fontUrl(d, f))]);
  const fonts = useZiFonts(urls);

  return useMemo(() => {
    const byId: Record<string, ThemeRuntime> = {};
    let ready = true;
    for (const ds of systems) {
      const urls = iconFontUrls(ds);
      const loaded = urls.map((u) => fonts[u]).filter((f): f is ZiFont => f !== undefined);
      if (loaded.length < urls.length) ready = false;
      const textFonts = ds.fonts.map((token) => {
        const url = fontUrl(ds, token);
        return { token, url, zi: url === undefined ? undefined : fonts[url] };
      });
      if (textFonts.some((t) => t.url !== undefined && t.zi === undefined)) ready = false;

      const codes: PanelIconSet["codes"] = {};
      const names: PanelIconSet["names"] = {};
      const paths: PanelIconSet["paths"] = {};
      for (const [role, entry] of Object.entries(iconRolesOf(ds))) {
        codes[role as IconRole] = entry.code;
        names[role as IconRole] = entry.name;
        paths[role as IconRole] = entry.path;
      }
      byId[ds.id] = {
        palette: panelPaletteFromTokens(ds.colors.map((c) => ({ id: c.id, hex: rgb565ToHex(c.rgb565) }))).palette,
        // a layout that stacks text needs the type's height, and it is the
        // theme's answer, not the component's
        style: layoutStyle(ds.style, ds.fonts),
        icons: { fonts: loaded, codes, names, paths },
        // A layout asks for a ROLE; this is where the theme answers with its own
        // cut. Read straight off the font tokens, and carrying the `.zi` itself,
        // so both columns draw the glyphs the panel draws.
        fonts: Object.fromEntries(textFonts.map(({ token, zi }) => [token.role, { height: token.height, weight: token.weight, zi }])) as PanelFontSet,
      };
    }
    return { byId, ready };
  }, [systems, fonts]);
}
