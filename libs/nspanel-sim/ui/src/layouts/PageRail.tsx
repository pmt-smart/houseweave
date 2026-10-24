// `page-rail`, for every theme. See `Label.tsx` for why this is one file.
//
// A paged list's scrollbar: one vertical slider whose range is the list's
// pages, so the pointer lands on whole pages (`layout/src/scrollbar.ts`).
//
// The page turns when the finger LETS GO, and only then -- the same rule the
// glass runs, where the slider reports on Touch Release and the runtime writes
// the next rows into the same slots. During the drag the pointer moves and the
// rows stay: rewriting every row at the drag's cadence would be serial traffic
// for pages the finger is only passing through.
import { useEffect, useState } from "react";
import { layoutFor, literalNumber } from "@nspanel-sim/layout";
import { PanelNodes, usePlacement } from "../PanelNodes";
import { usePanelStyle } from "../panelStyle";
import { useThemeId } from "../registry";
import { MissingLayout } from "./MissingLayout";
import type { PageRailProps } from "../contracts";

export function PageRail({ page, pageCount, onChange }: PageRailProps) {
  const theme = useThemeId();
  const { size } = usePlacement();
  const style = usePanelStyle();
  // where the pointer is while the finger is down; the page itself only
  // changes on release
  const [dragging, setDragging] = useState<number | null>(null);
  useEffect(() => setDragging(null), [page]);
  const layout = layoutFor(theme, "page-rail", "default");
  if (!layout) return <MissingLayout theme={theme} id="page-rail" variant="default" />;
  const props = {
    page: literalNumber(dragging ?? page ?? 0),
    pageCount: literalNumber(pageCount),
    change: onChange ? ({ kind: "report", event: "list.page" } as const) : undefined,
  };
  return (
    <PanelNodes
      nodes={layout(props, size, style)}
      onSlide={(_, value) => setDragging(value)}
      onSlideCommitted={(_, value) => {
        setDragging(null);
        if (value !== page) onChange?.(value);
      }}
    />
  );
}
