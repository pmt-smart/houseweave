# The `lovelace-jobr99` theme's fonts

**Generated files: do not edit by hand.** Each is a subset of a font that joBr99's reference project already runs on the panel, cut by the
`source` and `include` fields of the [`theme.json`](../theme.json).

```bash
node ../../../export/scripts/build-theme-fonts.mjs lovelace-jobr99
```

`--check` checks without writing. It needs the fixtures (`npm run fetch-fixtures` in the `export/` package); the generated files are committed
so that the simulator and the generator work without them.

## Why a subset

The whole fonts of joBr99's project have **7 120 glyphs each**, 6 400 of them icons, and the bold at 80 px alone passes 2.5 MB. A panel with
3 584 bytes of RAM a page does not need the whole Unicode repertoire; it needs the characters the components draw. The five files here add up to
**47 KB**.

| file | source | cut | glyphs |
|---|---|---|---|
| `noto-sans-24.zi` | `jobr99/nspanel.HMI` `3.zi` (`noto-sans-24-sp5`) | ASCII + Latin-1 | 191 |
| `noto-sans-32.zi` | `jobr99/nspanel.HMI` `2.zi` (`noto-sans-32-sp5`) | ASCII + Latin-1 | 191 |
| `noto-sans-bold-80.zi` | `jobr99/nspanel.HMI` `1.zi` (`NotoSans-Bold`) | digits and `:` | 12 |
| `icons-32.zi` | `jobr99/nspanel.HMI` `4.zi` | the theme's icon roles, by name | |
| `icons-48.zi` | `jobr99/nspanel.HMI` `5.zi` | the theme's icon roles, by name | |

The Latin-1 range is not decoration: it is what puts **"Café"** and **"23°C"** on the screen, with the pages encoded in UTF-8.

## Icons are glyphs, chosen by name

On this panel **an icon is a glyph**, not a picture ([docs/09](../../../../../docs/09-drawing-for-the-glass.md)). The `theme.json` lists the icons
by their **Material Design Icons name**, never by codepoint, and the generator resolves them through the same mapping joBr99's backend uses
(`reference/joBr99/luibackend/icon_mapping.py`). Adding an icon is adding a name to the JSON and running the script.

## Provenance and licence

The fonts are **Noto Sans** (SIL Open Font License 1.1) and the icon set is **Material Design Icons** (Apache 2.0), as packaged in joBr99's
project. The files here are cuts of the same data, with no change to the drawing.
