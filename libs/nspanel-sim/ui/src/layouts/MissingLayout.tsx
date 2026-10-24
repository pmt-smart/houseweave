// A component the theme in force does not draw.
//
// Said on the glass, in the box the project reserved, rather than rendered as
// nothing. A blank rectangle is indistinguishable from a component that drew
// itself in the background colour, and the difference matters: one is a screen
// to finish and the other is a bug.
export function MissingLayout({ theme, id, variant }: { theme: string; id: string; variant: string }) {
  return (
    <span style={{ font: "10px monospace", color: "#e06c75", display: "block", textAlign: "center", padding: 2 }}>
      {theme}
      <br />
      does not draw {id}
      {variant === "default" ? "" : ` (${variant})`}
    </span>
  );
}
