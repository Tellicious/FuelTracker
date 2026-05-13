import { useEffect, useMemo, useRef, useState } from 'react';

export type ChartSeries = 'gas' | 'equiv' | 'elec';

export interface ChartPoint {
  date: string;
  gas: number | null;        // primary unit (km/l or l/100km)
  equivalent: number | null; // primary unit (km/l or l/100km)
  elec?: number | null;      // kWh/100 km (right axis)
}

export type Scale = '1M' | '3M' | '6M' | '1Y' | 'ALL' | 'CUSTOM';

interface Props {
  points: ChartPoint[];
  unitLabel: string; // unit for left axis (e.g. "km/l" or "l/100km")
  scale: Scale;
  onScaleChange: (s: Scale) => void;
  /** Optional custom range, used when scale === 'CUSTOM'. ISO YYYY-MM-DD. */
  customFrom?: string | null;
  customTo?: string | null;
  onCustomRangeChange?: (from: string | null, to: string | null) => void;
  /** Which series this vehicle type *could* show. */
  showGas?: boolean;
  showEquiv?: boolean;
  showElec?: boolean;
  /** Which series the user currently wants visible. Toggleable via legend. */
  visible: Record<ChartSeries, boolean>;
  onVisibleChange: (next: Record<ChartSeries, boolean>) => void;
}

const SCALES: Scale[] = ['1M', '3M', '6M', '1Y', 'ALL', 'CUSTOM'];

const COLORS: Record<ChartSeries, string> = {
  gas: 'var(--chart-gas)',
  equiv: 'var(--chart-equiv)',
  elec: 'var(--chart-elec)',
};

// ---------- viewport math ----------

interface Viewport {
  from: number; // unix ms
  to: number;   // unix ms
}

const DAY_MS = 86_400_000;
const MIN_VIEWPORT_WIDTH_MS = 7 * DAY_MS;
const PAN_PAD_MS = 30 * DAY_MS;
const PAN_PIXEL_THRESHOLD = 6;
const WHEEL_ZOOM_FACTOR = 1.15;

/**
 * Derive the viewport from the props-driven scale. For relative scales (1M,
 * 3M, …) the viewport is anchored to "now"; for CUSTOM the explicit dates
 * are used; for ALL it's the data's full extent.
 */
function viewportFromProps(
  scale: Scale,
  customFrom: string | null | undefined,
  customTo: string | null | undefined,
  dataBounds: { min: number; max: number } | null,
): Viewport | null {
  if (!dataBounds) return null;
  if (scale === 'ALL') return { from: dataBounds.min, to: dataBounds.max };
  if (scale === 'CUSTOM') {
    const from = customFrom
      ? new Date(customFrom + 'T00:00:00').getTime()
      : dataBounds.min;
    const to = customTo
      ? new Date(customTo + 'T23:59:59.999').getTime()
      : dataBounds.max;
    return { from, to };
  }
  const days = scale === '1M' ? 30 : scale === '3M' ? 90 : scale === '6M' ? 182 : 365;
  return { from: Date.now() - days * DAY_MS, to: Date.now() };
}

/**
 * Constrain a viewport so it doesn't get absurdly narrow, absurdly wide, or
 * pan entirely outside the data + a comfortable pad.
 */
function clampViewport(
  v: Viewport,
  dataBounds: { min: number; max: number } | null,
): Viewport {
  if (!dataBounds) return v;
  const dataSpan = dataBounds.max - dataBounds.min;
  const maxWidth = Math.max(dataSpan, MIN_VIEWPORT_WIDTH_MS) * 1.5 + 2 * PAN_PAD_MS;

  let width = v.to - v.from;
  width = Math.max(MIN_VIEWPORT_WIDTH_MS, Math.min(maxWidth, width));

  let from = (v.from + v.to) / 2 - width / 2;
  let to = from + width;

  const minFrom = dataBounds.min - PAN_PAD_MS;
  const maxTo = dataBounds.max + PAN_PAD_MS;
  if (from < minFrom) {
    from = minFrom;
    to = from + width;
  }
  if (to > maxTo) {
    to = maxTo;
    from = to - width;
  }
  return { from, to };
}

/** Format an ISO timestamp as a YYYY-MM-DD string suitable for <input type=date>. */
function isoDate(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Pick ~4 "nice" tick values using a 1-2-5 step. */
function niceTicks(min: number, max: number, target = 4): number[] {
  if (!isFinite(min) || !isFinite(max)) return [0, 1];
  if (max <= min) return [min, min + 1];
  const range = max - min;
  const roughStep = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const norm = roughStep / mag;
  const niceMul = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  const step = niceMul * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + 1e-9; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks;
}

function fmtTick(v: number): string {
  if (Math.abs(v) >= 100) return Math.round(v).toString();
  if (Math.abs(v) >= 10) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Pick x-axis date ticks: 3-6 evenly spaced across the viewport, year-aware
 * label format. When the range spans more than ~13 months we include the year
 * ('Jan ’25'); on very short zooms we add day-of-month.
 */
function dateTicks(minT: number, maxT: number): { iso: string; label: string }[] {
  if (maxT <= minT) return [];
  const spanDays = (maxT - minT) / DAY_MS;
  const crossYears = spanDays > 400 ||
    new Date(minT).getFullYear() !== new Date(maxT).getFullYear();

  const count = spanDays <= 60 ? 4 : 5;

  const out: { iso: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const t = minT + ((maxT - minT) * i) / Math.max(count - 1, 1);
    const d = new Date(t);
    const month = d.toLocaleString('en-GB', { month: 'short' });
    const day = d.getDate();
    const yr = String(d.getFullYear()).slice(-2);
    const label = crossYears
      ? `${month} ’${yr}`
      : spanDays <= 60
        ? `${month} ${day}`
        : month;
    out.push({ iso: d.toISOString(), label });
  }
  return out;
}

function fmtDateLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtVal(v: number, decimals = 1): string {
  return v.toFixed(decimals);
}

export function LineChart({
  points,
  unitLabel,
  scale,
  onScaleChange,
  customFrom = null,
  customTo = null,
  onCustomRangeChange,
  showGas = true,
  showEquiv = true,
  showElec = false,
  visible,
  onVisibleChange,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);

  // -------- Data bounds & full range (for the date pickers) --------
  const sortedPoints = useMemo(
    () => [...points].sort((a, b) => (a.date < b.date ? -1 : 1)),
    [points],
  );
  const dataBounds = useMemo(() => {
    if (sortedPoints.length === 0) return null;
    return {
      min: new Date(sortedPoints[0].date).getTime(),
      max: new Date(sortedPoints[sortedPoints.length - 1].date).getTime(),
    };
  }, [sortedPoints]);
  const fullRange = useMemo(() => {
    if (!dataBounds) return null;
    return {
      min: isoDate(new Date(dataBounds.min)),
      max: isoDate(new Date(dataBounds.max)),
    };
  }, [dataBounds]);

  // -------- Viewport: starts from props, mutates during gestures --------
  const propViewport = useMemo(() => {
    const raw = viewportFromProps(scale, customFrom, customTo, dataBounds);
    return raw ? clampViewport(raw, dataBounds) : null;
  }, [scale, customFrom, customTo, dataBounds]);
  const [localViewport, setLocalViewport] = useState<Viewport | null>(propViewport);
  // Whenever the props-derived viewport changes (user picked a scale,
  // switched vehicles, edited the date inputs), sync our local copy.
  useEffect(() => {
    setLocalViewport(propViewport);
  }, [propViewport]);
  const viewport = localViewport;

  // Geometry. Larger left/right padding to host axis ticks + titles.
  const W = 360;
  const H = 230;
  const pad = { l: 42, r: 42, t: 20, b: 40 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  // -------- Gesture refs: pinch / pan / wheel --------
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointersRef = useRef<Map<number, { x: number }>>(new Map());
  const gestureRef = useRef<{
    kind: 'pan' | 'pinch';
    startViewport: Viewport;
    startCenterX: number; // pointer x at gesture start (chart coords)
    startPinchSpan: number; // |x1 - x2| at start of pinch
    armed: boolean; // for pan: true once user moves past the threshold
    committed: boolean; // for pan: true if we actually panned (vs. just tapped)
  } | null>(null);

  /** Convert a client x (from PointerEvent) to chart coordinate space (0..W). */
  const clientToChartX = (clientX: number): number => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  };

  /** Convert a chart-space x to a timestamp inside the current viewport. */
  const chartXToTime = (chartX: number, v: Viewport): number => {
    const frac = (chartX - pad.l) / innerW;
    return v.from + frac * (v.to - v.from);
  };

  /** Commit a (gesture-driven) viewport up to the parent as CUSTOM mode. */
  const commitViewport = (v: Viewport) => {
    if (!onCustomRangeChange) return;
    onCustomRangeChange(isoDate(new Date(v.from)), isoDate(new Date(v.to)));
    if (scale !== 'CUSTOM') onScaleChange('CUSTOM');
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!viewport) return;
    const x = clientToChartX(e.clientX);
    pointersRef.current.set(e.pointerId, { x });
    // Pointer capture on SVG elements throws on some older Safari versions;
    // it's a nice-to-have for desktop drag-outside-element, not essential.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (pointersRef.current.size === 1) {
      // Start tentative pan — won't actually pan until threshold is exceeded,
      // so a tap-on-a-dot still triggers the tooltip.
      gestureRef.current = {
        kind: 'pan',
        startViewport: { ...viewport },
        startCenterX: x,
        startPinchSpan: 0,
        armed: false,
        committed: false,
      };
    } else if (pointersRef.current.size === 2) {
      const [p1, p2] = [...pointersRef.current.values()];
      gestureRef.current = {
        kind: 'pinch',
        startViewport: { ...viewport },
        startCenterX: (p1.x + p2.x) / 2,
        startPinchSpan: Math.max(Math.abs(p1.x - p2.x), 1),
        armed: true,
        committed: false,
      };
      setHover(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    if (!gestureRef.current || !viewport) return;

    const x = clientToChartX(e.clientX);
    pointersRef.current.set(e.pointerId, { x });
    const g = gestureRef.current;

    if (g.kind === 'pan' && pointersRef.current.size === 1) {
      const dx = x - g.startCenterX;
      if (!g.armed) {
        if (Math.abs(dx) < PAN_PIXEL_THRESHOLD) return;
        g.armed = true;
        setHover(null); // pan supersedes tooltip hover
      }
      const startWidth = g.startViewport.to - g.startViewport.from;
      const dt = (dx / innerW) * startWidth;
      const next = clampViewport(
        { from: g.startViewport.from - dt, to: g.startViewport.to - dt },
        dataBounds,
      );
      g.committed = true;
      setLocalViewport(next);
    } else if (g.kind === 'pinch' && pointersRef.current.size >= 2) {
      const [p1, p2] = [...pointersRef.current.values()];
      const span = Math.max(Math.abs(p1.x - p2.x), 1);
      const factor = g.startPinchSpan / span; // spread fingers → factor < 1 → zoom in
      const startWidth = g.startViewport.to - g.startViewport.from;
      const newWidth = startWidth * factor;
      // Keep the time-point that was originally under the gesture's centroid
      // sitting at wherever that centroid is right now (in chart coords).
      const centerTime = chartXToTime(g.startCenterX, g.startViewport);
      const centerXNow = (p1.x + p2.x) / 2;
      const centerFracNow = (centerXNow - pad.l) / innerW;
      const from = centerTime - centerFracNow * newWidth;
      const next = clampViewport({ from, to: from + newWidth }, dataBounds);
      g.committed = true;
      setLocalViewport(next);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const wasGestureCommitted = gestureRef.current?.committed ?? false;
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      if (wasGestureCommitted && localViewport) commitViewport(localViewport);
    } else if (pointersRef.current.size === 1) {
      // Transitioning from 2-finger pinch back to 1-finger pan: rebase.
      const remaining = [...pointersRef.current.values()][0];
      gestureRef.current = {
        kind: 'pan',
        startViewport: localViewport ?? viewport!,
        startCenterX: remaining.x,
        startPinchSpan: 0,
        armed: true,
        committed: wasGestureCommitted,
      };
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<SVGSVGElement>) => {
    const wasGestureCommitted = gestureRef.current?.committed ?? false;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      if (wasGestureCommitted && localViewport) commitViewport(localViewport);
    }
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!viewport) return;
    e.preventDefault();
    const x = clientToChartX(e.clientX);
    const factor = e.deltaY > 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
    const centerTime = chartXToTime(x, viewport);
    const newWidth = (viewport.to - viewport.from) * factor;
    const centerFrac = (x - pad.l) / innerW;
    const from = centerTime - centerFrac * newWidth;
    const next = clampViewport({ from, to: from + newWidth }, dataBounds);
    setLocalViewport(next);
    commitViewport(next);
  };

  const selector = (
    <ScaleSelector
      scale={scale}
      onChange={onScaleChange}
      customFrom={customFrom}
      customTo={customTo}
      onCustomRangeChange={onCustomRangeChange}
      fullRange={fullRange}
    />
  );

  // -------- Filter points by current viewport --------
  const data = useMemo(() => {
    if (!viewport) return [];
    return sortedPoints.filter((p) => {
      const t = new Date(p.date).getTime();
      return t >= viewport.from && t <= viewport.to;
    });
  }, [sortedPoints, viewport]);

  // Resolve effective series visibility (user toggle ∧ vehicle-type relevance).
  const onGas = (showGas ?? true) && visible.gas;
  const onEquiv = (showEquiv ?? true) && visible.equiv;
  const onElec = (showElec ?? false) && visible.elec;

  if (!viewport) {
    return (
      <div className="chart-wrap">
        <div className="empty">No data in this range yet.</div>
        {selector}
      </div>
    );
  }

  // Axes follow the VIEWPORT, not the visible data — so when zoomed/panned
  // into a gap the axes still render at the chosen extent rather than
  // collapsing onto whichever points happen to fall inside.
  const minT = viewport.from;
  const maxT = viewport.to;
  const tRange = Math.max(maxT - minT, 1);

  // ---- Left axis (km/l-like, gas + equivalent) ----
  const leftVals: number[] = [];
  for (const p of data) {
    if (onGas && p.gas != null) leftVals.push(p.gas);
    if (onEquiv && p.equivalent != null) leftVals.push(p.equivalent);
  }
  // ---- Right axis (kWh/100 km, electricity) ----
  const rightVals: number[] = [];
  for (const p of data) {
    if (onElec && p.elec != null) rightVals.push(p.elec);
  }

  const allSeriesOff = !onGas && !onEquiv && !onElec;
  if (allSeriesOff) {
    return (
      <div className="chart-wrap">
        <SeriesToggles
          showGas={showGas}
          showEquiv={showEquiv}
          showElec={showElec}
          visible={visible}
          onVisibleChange={onVisibleChange}
          unitLabel={unitLabel}
        />
        <div className="empty" style={{ padding: '20px 8px' }}>
          Toggle a series on to see the chart.
        </div>
        {selector}
      </div>
    );
  }
  // When viewport is over a gap with no data points, we still render the
  // axes (so the user has a frame of reference to pan/zoom out of).

  const leftActive = leftVals.length > 0;
  const rightActive = rightVals.length > 0;

  const leftTicks = leftActive ? niceTicks(Math.min(...leftVals), Math.max(...leftVals), 4) : [];
  const rightTicks = rightActive
    ? niceTicks(Math.min(...rightVals), Math.max(...rightVals), 4)
    : [];
  const leftMin = leftActive ? leftTicks[0] : 0;
  const leftMax = leftActive ? leftTicks[leftTicks.length - 1] : 1;
  const rightMin = rightActive ? rightTicks[0] : 0;
  const rightMax = rightActive ? rightTicks[rightTicks.length - 1] : 1;

  const x = (iso: string) =>
    pad.l + ((new Date(iso).getTime() - minT) / tRange) * innerW;
  const yLeft = (v: number) =>
    pad.t + innerH - ((v - leftMin) / Math.max(leftMax - leftMin, 1e-9)) * innerH;
  const yRight = (v: number) =>
    pad.t + innerH - ((v - rightMin) / Math.max(rightMax - rightMin, 1e-9)) * innerH;

  const buildPath = (
    selector: (p: ChartPoint) => number | null,
    yScale: (v: number) => number,
  ): string => {
    let d = '';
    let pen = false;
    for (const p of data) {
      const v = selector(p);
      if (v == null) {
        pen = false;
        continue;
      }
      const cmd = pen ? 'L' : 'M';
      d += `${cmd} ${x(p.date).toFixed(1)} ${yScale(v).toFixed(1)} `;
      pen = true;
    }
    return d;
  };

  const gasPath = onGas ? buildPath((p) => p.gas, yLeft) : '';
  const equivPath = onEquiv ? buildPath((p) => p.equivalent, yLeft) : '';
  const elecPath = onElec ? buildPath((p) => p.elec ?? null, yRight) : '';

  // X-axis ticks
  const xTicks = dateTicks(minT, maxT);

  // Tooltip
  const hovered = hover != null ? data[hover] : null;
  // Anchor point: prefer gas, then equivalent, then elec (whichever is visible & present)
  let anchorX = 0;
  let anchorY = 0;
  if (hovered) {
    anchorX = x(hovered.date);
    if (onGas && hovered.gas != null) anchorY = yLeft(hovered.gas);
    else if (onEquiv && hovered.equivalent != null) anchorY = yLeft(hovered.equivalent);
    else if (onElec && hovered.elec != null) anchorY = yRight(hovered.elec);
    else anchorY = pad.t + innerH / 2;
  }

  // Tooltip card content. Labels are abbreviated for the compact card —
  // the full legend pills above the chart still spell them out.
  const tipRows: { label: string; value: string; color: string }[] = [];
  if (hovered) {
    if (onGas && hovered.gas != null) {
      tipRows.push({
        label: 'Gas',
        value: `${fmtVal(hovered.gas)} ${unitLabel}`,
        color: COLORS.gas,
      });
    }
    if (onEquiv && hovered.equivalent != null) {
      tipRows.push({
        label: 'Equiv',
        value: `${fmtVal(hovered.equivalent)} ${unitLabel}`,
        color: COLORS.equiv,
      });
    }
    if (onElec && hovered.elec != null) {
      tipRows.push({
        label: 'Elec',
        value: `${fmtVal(hovered.elec)} kWh/100km`,
        color: COLORS.elec,
      });
    }
  }
  const TIP_W = 142;
  const TIP_ROW_H = 13;
  const TIP_HEADER_H = 17;
  const TIP_PAD_Y = 5;
  const TIP_H = TIP_PAD_Y + TIP_HEADER_H + tipRows.length * TIP_ROW_H + TIP_PAD_Y;
  let tipX = anchorX + 10;
  let tipY = anchorY - TIP_H / 2;
  if (tipX + TIP_W > W - 4) tipX = anchorX - TIP_W - 10;
  if (tipX < 4) tipX = 4;
  if (tipY < pad.t) tipY = pad.t;
  if (tipY + TIP_H > H - 4) tipY = H - 4 - TIP_H;

  return (
    <div className="chart-wrap">
      <SeriesToggles
        showGas={showGas}
        showEquiv={showEquiv}
        showElec={showElec}
        visible={visible}
        onVisibleChange={onVisibleChange}
        unitLabel={unitLabel}
      />

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="auto"
        style={{ display: 'block', touchAction: 'pan-y', userSelect: 'none' }}
        preserveAspectRatio="xMidYMid meet"
        onPointerLeave={() => setHover(null)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
      >
        {/* Left axis title — anchored at the left axis, extending rightward */}
        {leftActive && (
          <text
            x={pad.l}
            y={pad.t - 6}
            fontSize={10}
            fill="var(--muted)"
            fontFamily="var(--font-mono)"
          >
            {unitLabel}
          </text>
        )}
        {/* Right axis title — anchored at the right axis, extending leftward */}
        {rightActive && (
          <text
            x={W - pad.r}
            y={pad.t - 6}
            fontSize={10}
            fill="var(--muted)"
            textAnchor="end"
            fontFamily="var(--font-mono)"
          >
            kWh/100 km
          </text>
        )}

        {/* Horizontal gridlines (driven by the left axis when present, else right) */}
        {(leftActive ? leftTicks : rightTicks).map((t, i) => {
          const yy = leftActive ? yLeft(t) : yRight(t);
          return (
            <line
              key={`g-${i}`}
              x1={pad.l}
              x2={pad.l + innerW}
              y1={yy}
              y2={yy}
              stroke="var(--line)"
              strokeWidth={i === 0 ? 1 : 0.5}
              strokeDasharray={i === 0 ? '' : '2 4'}
              opacity={0.55}
            />
          );
        })}

        {/* Left tick labels */}
        {leftActive &&
          leftTicks.map((t) => (
            <text
              key={`lt-${t}`}
              x={pad.l - 6}
              y={yLeft(t)}
              fontSize={10}
              fill="var(--muted)"
              textAnchor="end"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
            >
              {fmtTick(t)}
            </text>
          ))}

        {/* Right tick labels */}
        {rightActive &&
          rightTicks.map((t) => (
            <text
              key={`rt-${t}`}
              x={W - pad.r + 6}
              y={yRight(t)}
              fontSize={10}
              fill="var(--muted)"
              textAnchor="start"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
            >
              {fmtTick(t)}
            </text>
          ))}

        {/* Y axes lines */}
        <line
          x1={pad.l}
          x2={pad.l}
          y1={pad.t}
          y2={pad.t + innerH}
          stroke="var(--line)"
          strokeWidth={1}
        />
        {rightActive && (
          <line
            x1={pad.l + innerW}
            x2={pad.l + innerW}
            y1={pad.t}
            y2={pad.t + innerH}
            stroke="var(--line)"
            strokeWidth={1}
          />
        )}
        {/* X axis */}
        <line
          x1={pad.l}
          x2={pad.l + innerW}
          y1={pad.t + innerH}
          y2={pad.t + innerH}
          stroke="var(--line)"
          strokeWidth={1}
        />

        {/* X-axis ticks */}
        {xTicks.map((tk, i) => {
          const xx = x(tk.iso);
          return (
            <g key={`xt-${i}`}>
              <line
                x1={xx}
                x2={xx}
                y1={pad.t + innerH}
                y2={pad.t + innerH + 4}
                stroke="var(--line)"
                strokeWidth={1}
              />
              <text
                x={xx}
                y={pad.t + innerH + 16}
                fontSize={10}
                fill="var(--muted)"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
              >
                {tk.label}
              </text>
            </g>
          );
        })}

        {/* Series lines — kept thin & rounded for an elegant look. Gas is
            the primary metric so it gets a touch more weight than the others. */}
        {elecPath && (
          <path
            d={elecPath}
            fill="none"
            stroke={COLORS.elec}
            strokeWidth={1}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {equivPath && (
          <path
            d={equivPath}
            fill="none"
            stroke={COLORS.equiv}
            strokeWidth={1}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {gasPath && (
          <path
            d={gasPath}
            fill="none"
            stroke={COLORS.gas}
            strokeWidth={1.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Markers — small, only hovered grows. */}
        {onGas &&
          data.map((p, i) =>
            p.gas == null ? null : (
              <circle
                key={`g-${i}`}
                cx={x(p.date)}
                cy={yLeft(p.gas)}
                r={hover === i ? 3.2 : 1.5}
                fill={COLORS.gas}
                stroke={COLORS.gas}
                strokeWidth={0.5}
                style={{ cursor: 'pointer' }}
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
              />
            ),
          )}
        {onEquiv &&
          data.map((p, i) =>
            p.equivalent == null ? null : (
              <circle
                key={`eq-${i}`}
                cx={x(p.date)}
                cy={yLeft(p.equivalent)}
                r={hover === i ? 3 : 1.4}
                fill={COLORS.equiv}
                stroke={COLORS.equiv}
                strokeWidth={0.5}
                style={{ cursor: 'pointer' }}
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
              />
            ),
          )}
        {onElec &&
          data.map((p, i) =>
            p.elec == null ? null : (
              <circle
                key={`el-${i}`}
                cx={x(p.date)}
                cy={yRight(p.elec)}
                r={hover === i ? 3 : 1.4}
                fill={COLORS.elec}
                stroke={COLORS.elec}
                strokeWidth={0.5}
                style={{ cursor: 'pointer' }}
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
              />
            ),
          )}

        {/* Hover crosshair vertical */}
        {hovered && (
          <line
            x1={anchorX}
            x2={anchorX}
            y1={pad.t}
            y2={pad.t + innerH}
            stroke="var(--muted)"
            strokeWidth={0.5}
            strokeDasharray="2 3"
            opacity={0.4}
            pointerEvents="none"
          />
        )}

        {/* Tooltip card */}
        {hovered && tipRows.length > 0 && (
          <g pointerEvents="none">
            <rect
              x={tipX}
              y={tipY}
              width={TIP_W}
              height={TIP_H}
              rx={6}
              fill="var(--surface)"
              stroke="var(--line)"
              strokeWidth={0.5}
              opacity={0.97}
            />
            <text
              x={tipX + 8}
              y={tipY + TIP_PAD_Y + 10}
              fontSize={9.5}
              fontWeight={600}
              fill="var(--text)"
            >
              {fmtDateLong(hovered.date)}
            </text>
            {tipRows.map((row, i) => {
              const rowY = tipY + TIP_PAD_Y + TIP_HEADER_H + i * TIP_ROW_H;
              return (
                <g key={i}>
                  <circle
                    cx={tipX + 11}
                    cy={rowY + 1}
                    r={2.5}
                    fill={row.color}
                  />
                  <text
                    x={tipX + 18}
                    y={rowY + 4}
                    fontSize={9.5}
                    fill="var(--text)"
                  >
                    {row.label}
                  </text>
                  <text
                    x={tipX + TIP_W - 8}
                    y={rowY + 4}
                    fontSize={9.5}
                    fill="var(--text)"
                    textAnchor="end"
                    fontFamily="var(--font-mono)"
                  >
                    {row.value}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>

      <div className="chart-hint">
        Drag to pan · pinch or scroll to zoom
      </div>

      {selector}
    </div>
  );
}

function SeriesToggles({
  showGas,
  showEquiv,
  showElec,
  visible,
  onVisibleChange,
  unitLabel,
}: {
  showGas?: boolean;
  showEquiv?: boolean;
  showElec?: boolean;
  visible: Record<ChartSeries, boolean>;
  onVisibleChange: (next: Record<ChartSeries, boolean>) => void;
  unitLabel: string;
}) {
  const toggle = (k: ChartSeries) => onVisibleChange({ ...visible, [k]: !visible[k] });
  const Pill = ({
    on,
    color,
    label,
    sub,
    onClick,
  }: {
    on: boolean;
    color: string;
    label: string;
    sub: string;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="chart-pill"
      aria-pressed={on}
      style={{
        opacity: on ? 1 : 0.4,
        borderColor: on ? color : 'var(--line)',
      }}
    >
      <span
        className="chart-pill-dot"
        style={{ background: color }}
      />
      <span className="chart-pill-label">{label}</span>
      <span className="chart-pill-sub">{sub}</span>
    </button>
  );
  return (
    <div className="chart-toggles">
      {showGas && (
        <Pill
          on={visible.gas}
          color={COLORS.gas}
          label="Gas"
          sub={unitLabel}
          onClick={() => toggle('gas')}
        />
      )}
      {showEquiv && (
        <Pill
          on={visible.equiv}
          color={COLORS.equiv}
          label="Equivalent"
          sub={unitLabel}
          onClick={() => toggle('equiv')}
        />
      )}
      {showElec && (
        <Pill
          on={visible.elec}
          color={COLORS.elec}
          label="Electricity"
          sub="kWh/100 km"
          onClick={() => toggle('elec')}
        />
      )}
    </div>
  );
}

function ScaleSelector({
  scale,
  onChange,
  customFrom,
  customTo,
  onCustomRangeChange,
  fullRange,
}: {
  scale: Scale;
  onChange: (s: Scale) => void;
  customFrom?: string | null;
  customTo?: string | null;
  onCustomRangeChange?: (from: string | null, to: string | null) => void;
  fullRange: { min: string; max: string } | null;
}) {
  // When the user picks "Custom" with no range set yet, pre-fill it with the
  // data's full extent so the chart doesn't blank out.
  const pickCustom = () => {
    if (scale === 'CUSTOM') return;
    if (onCustomRangeChange && fullRange && !customFrom && !customTo) {
      onCustomRangeChange(fullRange.min, fullRange.max);
    }
    onChange('CUSTOM');
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="segment">
          {SCALES.map((s) =>
            s === 'CUSTOM' ? (
              <button
                key={s}
                className={s === scale ? 'active' : ''}
                onClick={pickCustom}
                title="Custom date range"
              >
                Custom
              </button>
            ) : (
              <button
                key={s}
                className={s === scale ? 'active' : ''}
                onClick={() => onChange(s)}
              >
                {s}
              </button>
            ),
          )}
        </div>
      </div>

      {scale === 'CUSTOM' && onCustomRangeChange && (
        <div className="chart-range">
          <label className="chart-range-field">
            <span>From</span>
            <input
              type="date"
              value={customFrom ?? ''}
              max={customTo ?? undefined}
              onChange={(e) => onCustomRangeChange(e.target.value || null, customTo ?? null)}
            />
          </label>
          <label className="chart-range-field">
            <span>To</span>
            <input
              type="date"
              value={customTo ?? ''}
              min={customFrom ?? undefined}
              onChange={(e) => onCustomRangeChange(customFrom ?? null, e.target.value || null)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
