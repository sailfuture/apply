"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Two small trend charts for the admin dashboard, drawn as inline SVG
 * — no charting dependency. Both take a 30-point series aligned to a
 * `days` array of `YYYY-MM-DD` UTC strings.
 *
 * Form follows event density (see `/api/admin/dashboard-trends`):
 *   - `TrendBarChart` — per-day counts (inquiries). Dense, so bars.
 *   - `TrendAreaChart` — a running total (roster size). Sparse
 *     events, so the cumulative curve rather than mostly-empty bars.
 *
 * Chart conventions (fixed, matching the house data-viz rules):
 * bars ≤24px with a 4px rounded top and square baseline, a 2px
 * surface gap between neighbours; 2px lines with round joins; end
 * markers ≥8px carrying a 2px surface ring; hairline solid gridlines;
 * one series per chart so no legend is needed (the card title names
 * it); axis/label text in muted ink, never the series color.
 *
 * Colors are passed in by the caller and are validated against a
 * white card surface: blue `#2a78d6` and green `#008300` both clear
 * 3:1 contrast, with CVD separation ΔE 26.5 between them.
 */

/**
 * Geometry. The viewBox width tracks the container's MEASURED pixel
 * width so one viewBox unit is one CSS pixel — a fixed viewBox with
 * `preserveAspectRatio="none"` would stretch the coordinate system
 * horizontally and turn the circular end-markers into ellipses.
 */
const VB_H = 190;
const FALLBACK_W = 720;
const PAD = { top: 14, right: 12, bottom: 24, left: 34 };
const PLOT_H = VB_H - PAD.top - PAD.bottom;
const plotW = (w: number) => Math.max(40, w - PAD.left - PAD.right);

/** Container width in CSS pixels, tracked through resizes. */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_W);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

const GRID = "#e1e0d9";
const AXIS = "#c3c2b7";
const MUTED = "#898781";
const SURFACE = "#ffffff";

/** Round a max up to a clean axis top so ticks land on nice numbers. */
function niceMax(raw: number): number {
  if (raw <= 4) return Math.max(4, raw);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    const candidate = mult * pow;
    if (candidate >= raw) return candidate;
  }
  return 10 * pow;
}

/** "Aug 1" from a `YYYY-MM-DD` string, parsed as UTC so the label
 *  always matches the bucket the server computed. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Which x positions get a date label. The step scales with the window
 * so any length lands on ~6 labels — a fixed every-7th rule gives 2
 * labels at 7 days and 13 (overlapping) at 90.
 *
 * The trailing guard drops a tick that would sit too close to the
 * always-labelled final day; without it the last two labels collide
 * (at 30 points, indexes 28 and 29 are ~13px apart).
 */
function isLabelledDay(i: number, total: number): boolean {
  const step = Math.max(1, Math.round(total / 5));
  const clearOfEnd = i < total - Math.ceil(step * 0.6);
  return (i % step === 0 && clearOfEnd) || i === total - 1;
}

/** Column path: rounded at the data end, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return [
    `M${x},${y + h}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + w - r},${y}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

/** Shared hover plumbing: maps a pointer position to a series index.
 *  The viewBox is 1:1 with CSS pixels, so the pointer offset IS the
 *  plot coordinate. */
function useHoverIndex(count: number, width: number) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [index, setIndex] = useState<number | null>(null);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || count === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = e.clientX - rect.left;
    const t = (x - PAD.left) / plotW(width);
    const i = Math.round(t * (count - 1));
    setIndex(Math.max(0, Math.min(count - 1, i)));
  }

  return { svgRef, index, onMove, clear: () => setIndex(null) };
}

/** Screen-reader table — the non-visual equivalent of the plot, so
 *  the data is never gated behind color or hover. */
function SeriesTable({
  caption,
  days,
  values,
  unit,
}: {
  caption: string;
  days: string[];
  values: number[];
  unit: string;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">{unit}</th>
        </tr>
      </thead>
      <tbody>
        {days.map((d, i) => (
          <tr key={d}>
            <th scope="row">{shortDate(d)}</th>
            <td>{values[i] ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tooltip({
  x,
  width,
  label,
  value,
}: {
  /** Plot x in CSS pixels. */
  x: number;
  width: number;
  label: string;
  value: string;
}) {
  // The translate flips near the edges so the tooltip stays inside
  // the card instead of overflowing it.
  const pct = width > 0 ? (x / width) * 100 : 50;
  const flip = pct > 70 ? "-100%" : pct < 12 ? "0%" : "-50%";
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border bg-white px-2 py-1 text-xs shadow-sm"
      style={{ left: `${pct}%`, transform: `translateX(${flip})` }}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-1.5 font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/* ────────────────────────── Bar chart ────────────────────────── */

export function TrendBarChart({
  days,
  values,
  color,
  unitLabel,
  className,
}: {
  days: string[];
  values: number[];
  color: string;
  /** Plural noun for the tooltip + screen-reader table ("inquiries"). */
  unitLabel: string;
  className?: string;
}) {
  const { ref: boxRef, width } = useContainerWidth();
  const { svgRef, index, onMove, clear } = useHoverIndex(days.length, width);
  const max = useMemo(
    () => niceMax(Math.max(1, ...values)),
    [values]
  );
  const band = plotW(width) / Math.max(1, days.length);
  // 2px surface gap between neighbours; never wider than the 24px cap.
  const barW = Math.min(24, Math.max(2, band - 2));

  const ticks = [0, max / 2, max];

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      {index !== null ? (
        <Tooltip
          x={PAD.left + band * index + band / 2}
          width={width}
          label={shortDate(days[index])}
          value={`${values[index] ?? 0} ${unitLabel}`}
        />
      ) : null}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${VB_H}`}
        className="h-[190px] w-full"
        role="img"
        aria-label={`Daily ${unitLabel} over the last ${days.length} days`}
        onMouseMove={onMove}
        onMouseLeave={clear}
      >
        {/* Gridlines + y ticks */}
        {ticks.map((t) => {
          const y = PAD.top + PLOT_H - (t / max) * PLOT_H;
          return (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y}
                y2={y}
                stroke={t === 0 ? AXIS : GRID}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PAD.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                fill={MUTED}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {Math.round(t)}
              </text>
            </g>
          );
        })}

        {/* Columns */}
        {values.map((v, i) => {
          const h = max === 0 ? 0 : (v / max) * PLOT_H;
          const x = PAD.left + band * i + (band - barW) / 2;
          const y = PAD.top + PLOT_H - h;
          const active = index === i;
          return (
            <g key={days[i]}>
              {/* Full-height hit target so thin/zero bars stay hoverable */}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={PLOT_H}
                fill="transparent"
              />
              {v > 0 ? (
                <path
                  d={columnPath(x, y, barW, h)}
                  fill={color}
                  opacity={index === null || active ? 1 : 0.45}
                />
              ) : null}
            </g>
          );
        })}

        {/* X labels — every 7th day plus the last, so ~5 labels. */}
        {days.map((d, i) =>
          isLabelledDay(i, days.length) ? (
            <text
              key={d}
              x={PAD.left + band * i + band / 2}
              y={VB_H - 8}
              textAnchor="middle"
              fontSize={9}
              fill={MUTED}
            >
              {shortDate(d)}
            </text>
          ) : null
        )}
      </svg>
      <SeriesTable
        caption={`Daily ${unitLabel}, last ${days.length} days`}
        days={days}
        values={values}
        unit={unitLabel}
      />
    </div>
  );
}

/* ──────────────────────── Cumulative area ─────────────────────── */

export function TrendAreaChart({
  days,
  values,
  color,
  unitLabel,
  className,
}: {
  days: string[];
  /** Running total per day (already cumulative). */
  values: number[];
  color: string;
  unitLabel: string;
  className?: string;
}) {
  const { ref: boxRef, width } = useContainerWidth();
  const { svgRef, index, onMove, clear } = useHoverIndex(days.length, width);
  const rawMax = Math.max(1, ...values);
  const max = niceMax(rawMax);
  // Cumulative series rarely start at zero — floor the axis a little
  // below the minimum so the growth is visible instead of a flat line
  // pinned to the top of the plot.
  const min = Math.min(...values);
  const floor = Math.max(0, Math.floor((min - (max - min) * 0.35) / 5) * 5);
  const span = Math.max(1, max - floor);

  const xAt = (i: number) =>
    PAD.left + (i / Math.max(1, days.length - 1)) * plotW(width);
  const yAt = (v: number) =>
    PAD.top + PLOT_H - ((v - floor) / span) * PLOT_H;

  const linePath = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(v)}`)
    .join(" ");
  const areaPath =
    values.length > 0
      ? `${linePath} L${xAt(values.length - 1)},${PAD.top + PLOT_H} L${xAt(0)},${
          PAD.top + PLOT_H
        } Z`
      : "";

  const lastIdx = values.length - 1;
  const ticks = [floor, floor + span / 2, max];

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      {index !== null ? (
        <Tooltip
          x={xAt(index)}
          width={width}
          label={shortDate(days[index])}
          value={`${values[index] ?? 0} ${unitLabel}`}
        />
      ) : null}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${VB_H}`}
        className="h-[190px] w-full"
        role="img"
        aria-label={`${unitLabel} over the last ${days.length} days`}
        onMouseMove={onMove}
        onMouseLeave={clear}
      >
        {ticks.map((t, i) => {
          const y = yAt(t);
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y}
                y2={y}
                stroke={i === 0 ? AXIS : GRID}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PAD.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                fill={MUTED}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {Math.round(t)}
              </text>
            </g>
          );
        })}

        {/* Area wash at ~10%, then the 2px line on top. */}
        <path d={areaPath} fill={color} opacity={0.1} />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Hover crosshair + the hovered point */}
        {index !== null ? (
          <>
            <line
              x1={xAt(index)}
              x2={xAt(index)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke={AXIS}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={xAt(index)}
              cy={yAt(values[index])}
              r={4.5}
              fill={color}
              stroke={SURFACE}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}

        {/* End marker + direct label — the one value worth labelling. */}
        {lastIdx >= 0 ? (
          <>
            <circle
              cx={xAt(lastIdx)}
              cy={yAt(values[lastIdx])}
              r={4}
              fill={color}
              stroke={SURFACE}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={xAt(lastIdx) - 6}
              y={yAt(values[lastIdx]) - 8}
              textAnchor="end"
              fontSize={11}
              fontWeight={600}
              fill="#0b0b0b"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {values[lastIdx]}
            </text>
          </>
        ) : null}

        {days.map((d, i) =>
          isLabelledDay(i, days.length) ? (
            <text
              key={d}
              x={xAt(i)}
              y={VB_H - 8}
              textAnchor={
                i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"
              }
              fontSize={9}
              fill={MUTED}
            >
              {shortDate(d)}
            </text>
          ) : null
        )}
      </svg>
      <SeriesTable
        caption={`${unitLabel} by day, last ${days.length} days`}
        days={days}
        values={values}
        unit={unitLabel}
      />
    </div>
  );
}
