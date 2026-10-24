# Control fonts

Six `.zi` files made on purpose with the **Nextion Editor's own Font Creator** (1.68.1), each with **one character of a known shape**. They are
what the encoding of a glyph was read against, and the font tests decode them.

Unlike the rest of the fixtures, these **are committed**: they are tiny (104 to 257 bytes) and are the only outside evidence that fixes the
*values* of the pixels. The downloaded fixtures go in `cache/`, outside git.

| file | typeface | character | height | antialiased | what it fixes |
|---|---|---|---|---|---|
| `wd16bw.zi` | Wingdings | `n` (a full square) | 16 | no | the low families: it decodes into an exact 9×8 rectangle |
| `wd16aa.zi` | Wingdings | `n` | 16 | yes | that the mode is per **glyph**: `0x01` even with antialiasing on, since a rectangle has no soft edge |
| `ar16bw.zi` | Arial | `o` | 16 | no | — |
| `ar16aa.zi` | Arial | `o` | 16 | yes | that at 16 px the Editor does not produce partial alpha at all |
| `ar48bw.zi` | Arial | `o` | 48 | no | the clean ring that fixed the family `11 www bbb` |
| `ar48aa.zi` | Arial | `o` | 48 | yes | **the only glyph of the set with partial alpha** (78 of 1 152 pixels): it fixes the alpha's direction and the order of the pair |
