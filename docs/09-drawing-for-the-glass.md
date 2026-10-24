# 09 — Drawing for the glass

How to draw a component so that it reaches the panel losing as little as possible, and knowing beforehand what it will lose. Every rule
here is a measurement, not a taste. The reader is whoever writes or changes a theme (`libs/nspanel-sim/layout/src/themes/<id>.ts` and
`libs/nspanel-sim/themes/<id>/theme.json`). Every theme carries a fixed block at its top that points here, and a test refuses a theme
without it (§9).

## 1. The glass, in numbers

| fact | value |
|---|---|
| screen | 480×320 px, 3.5", ≈165 ppi, **0.146 mm/px** |
| colour | **RGB565**: 32 levels of red and blue, 64 of green |
| text | a bitmap font (`.zi`) in the fixed sizes the theme carries |
| component | a rectangle with attributes; its shortest side **2 px** |
| RAM a page | **3 584 B**, inclusive; 3 588 does not compile |
| components a page | **250**; the 251st is `Too many components.` |
| pages a project | **251** |
| largest picture | between 620 800 and 623 000 px (800×776 compiles, 700×890 does not) |
| picture cost | the codec: 21 B a block of up to 8 runs of ≤ 119 px; raw, 2 B/px |
| touch | a target of 7–12 mm = **46–78 px** |
| long press | 500 ms, timed on the glass |

## 2. Colour

- **Choose colours already quantised.** `theme.json` keeps each colour as `rgb565`, and that number is what the glass shows, not the hex of
  the browser. Two greys that differ by less than 8/255 in red or blue (4/255 in green) **are the same colour** on the screen. The pipeline
  enforces the format; the judgement is not to draw a hierarchy with differences the screen does not have.
- **A state stands 3:1 against what lies under it; a text 4.5:1, or 3:1 when large** (24 px or more): WCAG's measures for an object that
  says something (1.4.11) and for text (1.4.3). Measure in `rgb565`, against the background the thing really sits on: an unlit icon lives on
  a card, not on the page. A label on an accent face takes the page's colour.
- **One component, one background colour and one foreground.** There is no opacity, alpha, shadow, blur or gradient attribute. "Real"
  transparency is painting the page's colour (that is how the slider's rounded ends are made).
- **The slider's pointer is white by choice, not by limit.** With `psta=0` (a flat pointer, which the generator writes), the `pco` asked for
  survives the compile and can be changed at run time. A pointer in the theme's colour is a theme's decision.

## 3. Text and fonts

- **Five roles, closed**: `body`, `title`, `display`, `icon` and `icon-large`. A theme covers each **exactly once** with a `.zi`. There is no
  "a little larger": there is the size of the font the theme carries, and the source fonts only have 24, 32, 48 and 80 px.
- **What does not cross**: `letter-spacing`, `line-height`, weight by CSS, synthetic italics. The headers of the layout files
  (`libs/nspanel-sim/layout/src/themes/<id>.ts`) say what each theme lost on the way; read them before drawing a new one.
- **An icon is a font glyph, not a picture.** A glyph costs no picture bytes and no RAM beyond its Text; a picture of 40×32 costs 2 560 B raw.
- **Text costs RAM by its `txt_maxl`**: a Text costs `10 + txt_maxl`, rounded up to 4. Ten labels of 40 characters are 520 B of the page's
  3 584. Declare the most the content needs, not "100 to be safe".
- **The font has only the glyphs the theme declared.** The three themes' `.zi` files are subsets of 191 glyphs
  (`libs/nspanel-sim/export/scripts/build-theme-fonts.mjs`): they have the hyphen `-` and the degree `°`, and **not** the em dash `—`, the
  en dash `–` or the minus sign `−`. A character outside the set addresses a glyph that does not exist, and the browser does not show it:
  the drawing machine has the whole font.
- **Measure the widest string against the box, not the sample string.** The glass cuts text that does not fit **silently**, at the box's edge
  and in the middle of a letter: it does not wrap, shrink or warn. Run-time text arrives fitted, ending in `..`; a compiled text that does
  not fit is refused by the build. Draw the box for the **typical** text and trust the `..` for the long one.
- **The simulator draws text with the `.zi`**, so what it shows is what the glass shows; the browser's own fonts run 25–28% wider.
- **Text of several lines is written in paragraphs, not lines.** A Text does not wrap, so a body of several lines is several Texts stacked,
  and the build does the breaking: `wrapZiText`, at the width and in the font of the box of **each layout**. The simulator uses the same
  function. A paragraph that breaks into more lines than the screen has is refused by the build.

## 4. Shape and geometry

- **Shortest side 2 px**, and **a border IS a component**. `borderWidth: 1` compiles to nothing. A border is 2 px or does not exist, and
  `core` refuses a theme with `borderWidth` 1 (`border-too-thin`). A node thinner than 2 px that reaches `emit` leaves the page for the
  `dropped` list it returns (`libs/nspanel-sim/layout/src/emit.ts`); only the tests read that list, so such a node vanishes from the glass
  with no warning in the build.
- **A rounded corner only inside a generated picture.** No component has a radius. The slider's pill has round ends because its pixels are
  ours; a card with rounded corners would be a background picture the size of the card.
- **Overlap draws a compiler warning** (`Warning:Component overlap`), and the Nextion decides who paints on top, by order. Do not compose a
  look by overlapping.
- **Nothing drawn after a Text may cross its box.** Every component paints its whole box, and a Text paints its box in its background colour,
  not only where there are letters. The Editor does not warn of a partial crossing; `libs/nspanel-sim/layout/test/nodes.test.mjs` (every
  component of every theme) and `libs/nspanel-sim/export/test/textOnGlass.test.mjs` (the compiled pages) do.
- **A Text drawn over a fill paints the fill's colour.** The same fact from the other side: a Text over a fill of another colour opens a hole.
  A card's name in the card's colour is the pattern, and the tests check the colour under the corners and the middle of every crossing.
- **A Button is flat only when its `style` says so.** The Editor's template gives a Button `style` 4, "3D_Auto", a bevel of a light line on top
  and a dark one below. Every fill and every key of the generator is a Button, written with `style` 0 (`BUTTON_FLAT`, in
  `libs/nspanel-sim/layout/src/emit.ts`).
- **Everything is an axis-aligned rectangle.** Circles, diagonals and thin lines are pictures, or they are not.

## 5. Generated pictures: the codec is ours, and it charges per run

The generator writes the screen's own picture codec. It is lossless (the pixels arrive exact) and charges **21 bytes a block of up to 8 runs
of one colour** (≤ 119 px). That is the rule that changes the drawing most:

- **Prefer vertical change to horizontal.** A flat row of 119 px costs 21 B; a **vertical** gradient (every row flat, the rows different)
  costs almost nothing. A **horizontal** gradient changes colour along the row and pays for every change.
- **Few colours a row.** Brightness (64 greys) comes out at 0.23 of raw; colour temperature at 0.20; hue (250 colours) at 0.80, and at 200 px
  it is not worth it and goes raw. That is not a defect: a rail that changes colour every two pixels has no run to give.
- **Dither costs 4×.** It breaks every run (a block of eight runs of 1 px is 2.5 B/px), so it is on **only where it helps**: a ramp where it
  helps (brightness, colour temperature; never hue) and a width where the banding would show (≥ 4 px a colour). A placement overrides it with
  `render.dither`.
- **An anti-aliased edge is the expensive part of a smooth shape.** Every transition pixel is a new colour. A rail's rounded ends are a few
  dozen pixels against thousands, which is acceptable; an anti-aliased outline around a whole card is not.
- **The ramp is the rail, not the placement.** A slider in a box of 420×78 draws a rail of 32 px, and the picture carries the rest as flat
  rows of the page's colour: a run a row, about 21 B each (`RampPicture.band`). **One picture for both halves** of the Slider (2×), and
  **de-duplicated** by `pictureKey` (N×).
- **Photographs and noise go raw** at 2 B/px. Count 300 kB for a full-screen photograph.

## 6. Touch

- **The minimum target is in millimetres, not design pixels**: 7 mm = 46 px, 9 mm = 58 px, 12 mm = 78 px. The pipeline measures a
  placement's box against the minimum the component declares.
- **The box may be bigger than the drawing.** The slider's touch is 420×78 (12 mm, the ISO/TS 9241-411 minimum its theme declares) and it
  draws a rail of 32 px; the rest is room for the finger, and costs one flat row of the picture a row of the box. The Settings' scrollbar
  takes this to the extreme: a band of 6 px and a pointer of 10 px in a touch box of the whole column, which touches no other touch box.
- **A target against the visible edge counts the bezel.** A finger pressing a target in the corner falls half on the glass and half on the
  bezel, and the half on the bezel presses nothing. The pipeline credits half a fingertip, 5 mm (`EDGE_CREDIT_MM`, in
  `libs/nspanel-sim/core/src/project.ts`), to a box against a visible edge: a target of 12 mm asks for 7 mm of glass there. That is what puts
  the scrollbar in the corner, 48 px wide. It is not measured: the spread of a touch on this glass is still an open question.
- **On a Slider, the bigger box counts only across.** A Slider's touch is the band its pointer runs along: stretching the box along the
  movement takes the pointer with it. For the touch to pass the drawing that way, a separate Hotspot is needed, like the one at the lower
  end of the Settings' scrollbar (`SliderNode.tail`).
- **In a list, the room comes out of the gaps, not the rows.** The rows of a list have the 12 mm (78 px) the theme asks for, and touch each
  other: each row draws only its label, centred, and the eye reads the 78 px step, not the boxes. With 8 px under the header the EU panel
  shows 3 rows (78 + 8 + 3 × 78 = 320), and the US one 5 at the same step. Touch boxes may touch, never overlap.
- **The title is the back button.** A screen that closes has no X: a tap on the title closes, in a target the width of the header. Where the
  title also renames, a tap closes and a long press opens the keyboard.
- **A long press is 500 ms, and the glass's** (a timer on the page). Do not draw an intermediate "pressed" state for it: there is no event.
- **The finger that lands lights its target.** The landing event exists: it is what arms the long-press timer.
  - A key of the keyboard and a row of a list change colour when the finger lands and back when it leaves, painted by the glass itself, with
    no word to the ESP32: the `bco` of what is under the finger goes to the theme's `pressed` on landing, and back to the compiled one on
    release, before the touch's code and outside its guard (`libs/nspanel-sim/layout/src/emit.ts`).
  - In a row every text of it lights, whatever touch the finger took: the name, the value and the icon. On a key, the face and what is
    drawn on it, like the digit and the letters of the keypad.
  - The release goes to the component that took the landing, so a drag that starts on a row leaves it lit until the finger leaves.
  - Every theme declares its `pressed`, a step above its keys: #5A5D5A in lovelace, zinc-600 in shadcn and slate-600 in tailwind, with the
    text above 6.5:1 on it.
  - **A face whose colour the run time changes is a Nextion Button.** The release above gives back the compiled colour, and on a face the run
    time lit it would put the lit one out. A Button has its own pressed colour (`bco2`, and `pco2` for its words), which the glass paints
    while the finger is on it and undoes back to whatever `bco` there is, compiled or written. It is the layout's `button` node: the face,
    the centred words or glyph, and the touch, in one component, with no Hotspot on top, since the upper component takes the touch.
- **A drag sends nothing by itself.** The Nextion sends no Component ID on a Touch Move; the slider reports its value **by hand**, with
  joBr99's recipe (`covx` → `btlen` → `crcrest`/`crcput` → `printh`/`prints`) on release and, when the placement or the panel's setting says
  so, also while dragging, with a Timer of 100 ms of cooldown a slider. A screen that needs "a touch anywhere" uses a **TouchCap**
  (`screen.tap`), not a Hotspot underneath: a touch on a Text with no event does not fall to what is behind it.

## 7. The page budget

- **3 584 B of RAM a page, all included**: `20 + Σ the components' cost + 4·⌊n/4⌋`, plus the globals. A Slider costs 28, a Picture 4, a
  Hotspot 0, a Text `10 + txt_maxl`. The compiler prints the sum on every build (`Page:… Memory Occupied`), and
  `libs/nspanel-sim/export/src/ramBudget.ts` works it out before the compile.
- **A screen full of small text is the most expensive screen**, not the one fullest of pictures: RAM goes by component and by character;
  flash goes by picture pixel and by font glyph.
- **A large font weighs in flash**: NotoSans-Regular at 48 px is 1.8 MB of the `.tft`. The `display` role of 80 px is for the clock; do not use
  it for a label.

## 8. What does not exist, in one list

So that no time goes into drawing them: **opacity, shadow, blur, native gradient, native rounded corner, a 1 px border, `letter-spacing`,
`line-height`, synthetic weight or italics, transforms, property animation, per-pixel colour outside a picture, an intermediate "pressed"
event, picture scaling** (the Nextion does not resize: the width is the one the project drew).

## 9. The block at the top of every theme

In **two places**, because they are two different people.

### 9.1 In the theme's document (`libs/nspanel-sim/themes/<id>/theme.json`)

A theme added to the platform is a JSON document, and whoever writes one may never open a `.ts` file. The document carries the rules in
`drawing`, right after `description`, before the colours and the fonts they govern:

```json
{
  "schemaVersion": 7,
  "id": "shadcn-dark",
  "name": "shadcn dark",
  "description": "…",
  "drawing": [
    "READ docs/09-drawing-for-the-glass.md before drawing for this theme. The short form, each line measured:",
    "colour    RGB565: 32 levels of R/B, 64 of G; no alpha, shadow, blur or gradient attribute",
    "text      five font roles, fixed sizes; no tracking, leading or synthetic weight",
    "shape     a rectangle with sides >= 2 px; a border IS a component; radius only inside a picture",
    "pictures  the codec pays per run: flat rows and vertical change are cheap, dither is 4x, hue is rich",
    "touch     7-12 mm = 46-78 px of target; the box may be bigger than the drawing",
    "budget    3 584 B of RAM a page; a Text costs 10 + txt_maxl, a Slider 28, an icon glyph nothing"
  ],
  "colors": [ … ]
}
```

Copied, not linked, on purpose: a theme **travels**. It can be handed to another repository, or to a model, with nothing else attached.

`parseTheme` compares it line by line with `DRAWING_RULES` (`libs/nspanel-sim/core/src/theme.ts`) and refuses two things: a theme **without**
the block (`missing-drawing-rules`) and a theme whose block **drifted** (`stale-drawing-rules`), the worse of the two, because a stale block
still reads as current. The refusal carries the text to paste; the proofs are in `libs/nspanel-sim/core/test/model.test.mjs`.

The simulator shows the block at the top of the **Themes** tab, above the palette, read from the selected theme's document: what appears is
what that theme really carries.

### 9.2 In the layout file (`libs/nspanel-sim/layout/src/themes/<id>.ts`)

The same content, for whoever changes the geometry:

```
// DRAWING FOR THE GLASS -- read docs/09-drawing-for-the-glass.md
// before changing a layout here. The short form, each line measured:
//   colour     RGB565: 32 levels of R/B, 64 of G; no alpha, shadow, blur or gradient attribute
//   text       five font roles, fixed sizes; no tracking, leading or synthetic weight
//   shape      a rectangle with sides >= 2 px; a border IS a component; radius only inside a picture
//   pictures   the codec pays per run: flat rows and vertical change are cheap, dither is 4x, hue is rich
//   touch      7-12 mm = 46-78 px of target; the box may be bigger than the drawing
//   budget     3 584 B of RAM a page; a Text costs 10 + txt_maxl, a Slider 28, an icon glyph nothing
```

A test in `libs/nspanel-sim/layout/test/nodes.test.mjs` refuses a theme file without the first line of that block. Together, the two make
"by default" true for the **next** theme too: neither a document nor a layout comes into the repository without the rules on top.

## 10. What the pipeline guarantees, and what stays with whoever draws

| guaranteed by the pipeline (refused before the compile) | the judgement of whoever draws |
|---|---|
| colour in `rgb565`, font roles each covered once | a hierarchy with differences the screen shows |
| a side ≥ 2 px, a box inside the screen, the minimum touch target | a box bigger than the drawing where the finger needs it |
| RAM a page, components a page and pages a project, picture size | a text's `txt_maxl` the size of its content |
| a picture in its smaller form (codec or raw), de-duplicated by identity | ramp and dither by placement (`render`) |
| events with constant bytes, a long press of 500 ms | not drawing a state that has no event |
