import { useRef, useState } from "react";
import {
  ID1_CARD_WIDTH_MM,
  ID1_CARD_HEIGHT_MM,
  ppiFromCssPxMeasurement,
} from "@nspanel-sim/ui";

// Reference-object calibration. The user holds a real card against the
// screen and adjusts the outline until it matches; the monitor's
// physical PPI falls out of that. See ui/src/devicePreviewMath.ts for
// why this cannot be obtained from an API.
//
// Why a card and not a ruler: an ISO/IEC 7810 ID-1 card (bank card,
// driving licence, ID card, work badge) is 85.60 x 53.98 mm to
// hundredth-of-a-millimetre tolerance, and everyone has one in their
// pocket. A ruler depends on the user lining up the zero and reading a
// fine marking; a card is held up and compared edge to edge, which the
// eye does far better.
//
// Calibrates on WIDTH, not height: it is the longer side (85.6 against
// 53.98 mm), so the same alignment error in mm becomes a smaller
// relative error. The height is drawn alongside purely as a visual
// confirmation — if the width matches and the height does not, either
// browser zoom is anisotropic or the card is not ID-1.

export interface CalibrationCardProps {
  monitorPpi: number;
  /**
   * CSS px per mm as everything else on the page uses it — anchored to
   * the dpr at calibration time, so the card zooms along with the
   * panels instead of being the one thing that refuses to.
   */
  monitorPxPerMm: number;
  /** Live dpr, used to turn a measurement in CSS px into a physical PPI. */
  devicePixelRatio: number;
  /** Stores the measurement together with the zoom it was taken at. */
  onCalibrate: (ppi: number, dpr: number) => void;
}

// Slider range: 60 PPI covers TVs and projectors viewed up close, 400
// covers HiDPI laptops (a 15" "Retina" sits around 220). The step is
// 0.25 because aligning a card edge by eye is off by roughly 0.5 mm in
// 85.6 mm (~0.6%), so a finer step would be invented precision.
const PPI_MIN = 60;
const PPI_MAX = 400;
const PPI_STEP = 0.25;

function clampPpi(ppi: number): number {
  if (!Number.isFinite(ppi)) return PPI_MIN;
  return Math.min(PPI_MAX, Math.max(PPI_MIN, ppi));
}

export function CalibrationCard({
  monitorPpi,
  monitorPxPerMm,
  devicePixelRatio,
  onCalibrate,
}: CalibrationCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const pxPerMm = monitorPxPerMm;
  const cardWidthPx = ID1_CARD_WIDTH_MM * pxPerMm;
  const cardHeightPx = ID1_CARD_HEIGHT_MM * pxPerMm;

  // A cross-check that DELIBERATELY shows the raw pixels alongside: the
  // diagonal the calibrated PPI implies for whatever the browser calls
  // "screen". It only matches the monitor's box if `window.screen` is a
  // single monitor — on a multi-monitor setup it can report the union of
  // the virtual desktop (3277x1728 CSS px spanning the screens), which makes a
  // diagonal-based method wrong by more than 2x without any signal. So
  // this is a diagnostics footer, not an input: the calibration itself
  // never touches `window.screen`.
  const screenW = window.screen?.width ?? 0;
  const screenH = window.screen?.height ?? 0;
  const impliedDiagonalIn =
    screenW > 0 && screenH > 0
      ? (Math.hypot(screenW, screenH) * devicePixelRatio) / monitorPpi
      : null;

  return (
    <div
      style={{
        border: "1px solid #2f3531",
        borderRadius: 4,
        padding: 12,
        marginBottom: 16,
        maxWidth: 560,
        fontSize: 11,
        color: "#8c948a",
      }}
    >
      <div style={{ marginBottom: 8 }}>
        Hold a bank card, driver&rsquo;s licence or ID against the screen and drag the right
        edge (or use the slider) until the outline matches its edges exactly. Any ISO/IEC 7810 ID-1 card works &mdash; they are all
        85.60 &times; 53.98 mm.
      </div>

      <div
        ref={cardRef}
        style={{
          position: "relative",
          width: cardWidthPx,
          height: cardHeightPx,
          // border-box on purpose: the drag measures clientX minus the
          // BOX's rect.left, so the width has to include the border, or
          // 1px is left over on each side — 0.7% of 85.6 mm, a
          // systematic error in the very quantity being calibrated.
          boxSizing: "border-box",
          // 3.18 mm is the middle of the ID-1 corner-radius range
          // (2.88-3.48 mm), to help compare corners as well as edges.
          borderRadius: 3.18 * pxPerMm,
          border: `1px solid ${dragging ? "#8cc6ff" : "#4da3ff"}`,
          background: "rgba(77,163,255,0.06)",
          marginBottom: 10,
        }}
      >
        {/* Drag handle on the right edge — the direct way to do this
            ("stretch until it matches"). The slider below does the same
            with fine precision and from the keyboard; both write the
            same PPI. */}
        <div
          onPointerDown={() => {
            const left = cardRef.current?.getBoundingClientRect().left;
            if (left === undefined) return;
            // No setPointerCapture: the listeners below are already on
            // the window, so dragging keeps working outside the element
            // — and capturing with an invalid pointerId throws.
            setDragging(true);
            const move = (ev: PointerEvent) => {
              const widthPx = ev.clientX - left;
              if (widthPx <= 0) return;
              onCalibrate(
                clampPpi(ppiFromCssPxMeasurement(widthPx, ID1_CARD_WIDTH_MM, devicePixelRatio)),
                devicePixelRatio,
              );
            };
            const up = () => {
              setDragging(false);
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          title="Drag to match your card's width"
          style={{
            position: "absolute",
            top: 0,
            right: -6,
            width: 12,
            height: "100%",
            cursor: "ew-resize",
            touchAction: "none",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="range"
          min={PPI_MIN}
          max={PPI_MAX}
          step={PPI_STEP}
          value={monitorPpi}
          onChange={(e) => onCalibrate(clampPpi(parseFloat(e.target.value)), devicePixelRatio)}
          style={{ flex: "1 1 220px", minWidth: 180 }}
          aria-label="Monitor pixel density (PPI)"
        />
        <label>
          Monitor PPI:{" "}
          <input
            type="number"
            value={Number(monitorPpi.toFixed(2))}
            step={0.25}
            min={PPI_MIN}
            max={PPI_MAX}
            onChange={(e) => onCalibrate(clampPpi(parseFloat(e.target.value)), devicePixelRatio)}
            style={{ width: 70 }}
          />
        </label>
      </div>

      <div style={{ marginTop: 8 }}>
        Calibrated once per monitor and remembered &mdash; browser zoom and OS scaling are
        compensated automatically, so this should not need touching again.
        {impliedDiagonalIn !== null && (
          <div style={{ marginTop: 6, opacity: 0.75 }}>
            Diagnostics: the browser reports its screen as {screenW} &times; {screenH} CSS px at
            dpr {devicePixelRatio}, which at this PPI spans{" "}
            <strong style={{ color: "#c3cbc0" }}>{impliedDiagonalIn.toFixed(1)}&Prime;</strong>. That
            matches your monitor only if it is reported as a single screen &mdash; with several
            monitors this can be the whole virtual desktop. Nothing above depends on it.
          </div>
        )}
      </div>
    </div>
  );
}
