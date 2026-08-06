import type { DayPoint } from '@/lib/wellbeing/aggregate';
import {
  WELLBEING_SCALE_MAX,
  WELLBEING_SCALE_MIN,
  formatSleep,
} from '@/lib/wellbeing/scale';

/**
 * Charts, drawn as SVG by hand.
 *
 * A charting library would be the larger dependency in this project's client
 * bundle, for two charts of at most a year of single-value points. Colours are
 * DaisyUI channel variables rather than literals, so the same markup follows
 * silk, bumblebee and autumn instead of pinning one palette into the theme
 * switcher.
 */

const VIEW_W = 720;
const VIEW_H = 190;
const PAD = { top: 14, right: 12, bottom: 24, left: 28 };

const plotW = VIEW_W - PAD.left - PAD.right;
const plotH = VIEW_H - PAD.top - PAD.bottom;

/** Points are placed at band centres, so a line and the bars below it share an x. */
function bandX(index: number, count: number): number {
  const band = plotW / Math.max(count, 1);
  return PAD.left + band * (index + 0.5);
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(day)}/${Number(month)}`;
}

/**
 * Ticks for the x axis: first, last, and a few in between.
 *
 * A label per day is unreadable at 90 days and redundant at 7, so the count is
 * capped and the step derived from it.
 */
function axisTicks(days: DayPoint[]): number[] {
  const n = days.length;
  if (n === 0) return [];
  if (n <= 8) return days.map((_, i) => i);

  const step = Math.ceil(n / 7);
  const ticks: number[] = [];
  for (let i = 0; i < n; i += step) ticks.push(i);
  if (ticks[ticks.length - 1] !== n - 1) ticks.push(n - 1);
  return ticks;
}

type Series = { key: 'mood' | 'energy'; label: string; color: string };

const SERIES: Series[] = [
  { key: 'mood', label: 'Mood', color: 'hsl(var(--p))' },
  { key: 'energy', label: 'Energy', color: 'hsl(var(--s))' },
];

/**
 * Runs of consecutive days that actually hold a value.
 *
 * Splitting here is what stops the line being drawn across a gap. A polyline
 * through every non-null point would connect the 3rd to the 19th and assert a
 * fortnight of steady mood that was never recorded — the one lie a wellbeing
 * chart must not tell, because the missing stretch is usually the bad one.
 */
function segmentsOf(days: DayPoint[], key: Series['key']): Array<Array<{ x: number; y: number }>> {
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];

  const span = WELLBEING_SCALE_MAX - WELLBEING_SCALE_MIN;

  days.forEach((day, index) => {
    const value = day[key];
    if (value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }

    current.push({
      x: bandX(index, days.length),
      y: PAD.top + plotH * (1 - (value - WELLBEING_SCALE_MIN) / span),
    });
  });

  if (current.length > 0) segments.push(current);
  return segments;
}

export function TrendChart({ days }: { days: DayPoint[] }) {
  const ticks = axisTicks(days);
  const gridValues = [1, 2, 3, 4, 5];
  const span = WELLBEING_SCALE_MAX - WELLBEING_SCALE_MIN;

  return (
    <figure className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-base-content/60">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Mood and energy over time, on a scale of 1 to 5"
      >
        {gridValues.map((value) => {
          const y = PAD.top + plotH * (1 - (value - WELLBEING_SCALE_MIN) / span);
          return (
            <g key={value}>
              <line
                x1={PAD.left}
                x2={VIEW_W - PAD.right}
                y1={y}
                y2={y}
                stroke="hsl(var(--bc) / 0.12)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize={10}
                fill="hsl(var(--bc) / 0.45)"
              >
                {value}
              </text>
            </g>
          );
        })}

        {SERIES.map((series) => (
          <g key={series.key}>
            {segmentsOf(days, series.key).map((segment, i) => (
              <polyline
                key={i}
                points={segment.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={series.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {segmentsOf(days, series.key)
              .flat()
              .map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={2.6} fill={series.color} />
              ))}
          </g>
        ))}

        {ticks.map((index) => (
          <text
            key={index}
            x={bandX(index, days.length)}
            y={VIEW_H - 6}
            textAnchor="middle"
            fontSize={10}
            fill="hsl(var(--bc) / 0.45)"
          >
            {shortDate(days[index].date)}
          </text>
        ))}
      </svg>
    </figure>
  );
}

/** Sleep, as bars. Zero-height days are simply absent rather than drawn at the floor. */
export function SleepChart({ days }: { days: DayPoint[] }) {
  const values = days
    .map((d) => d.sleepMinutes)
    .filter((v): v is number => typeof v === 'number');

  if (values.length === 0) {
    return <p className="text-sm text-base-content/50">No sleep logged yet.</p>;
  }

  // Rounded up to the next whole hour, floor of 8, so a run of short nights
  // does not rescale itself into looking like a run of normal ones.
  const maxMinutes = Math.max(8 * 60, Math.ceil(Math.max(...values) / 60) * 60);
  const band = plotW / Math.max(days.length, 1);
  const barW = Math.max(2, Math.min(band * 0.62, 22));
  const ticks = axisTicks(days);

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Hours slept per night"
      >
        {[0, maxMinutes / 2, maxMinutes].map((minutes) => {
          const y = PAD.top + plotH * (1 - minutes / maxMinutes);
          return (
            <g key={minutes}>
              <line
                x1={PAD.left}
                x2={VIEW_W - PAD.right}
                y1={y}
                y2={y}
                stroke="hsl(var(--bc) / 0.12)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 3.5}
                textAnchor="end"
                fontSize={10}
                fill="hsl(var(--bc) / 0.45)"
              >
                {Math.round(minutes / 60)}
              </text>
            </g>
          );
        })}

        {days.map((day, index) => {
          if (day.sleepMinutes === null) return null;
          const height = plotH * (day.sleepMinutes / maxMinutes);
          return (
            <rect
              key={day.date}
              x={bandX(index, days.length) - barW / 2}
              y={PAD.top + plotH - height}
              width={barW}
              height={height}
              rx={2}
              fill="hsl(var(--a))"
              opacity={0.85}
            >
              <title>{`${day.date}: ${formatSleep(day.sleepMinutes)}`}</title>
            </rect>
          );
        })}

        {ticks.map((index) => (
          <text
            key={index}
            x={bandX(index, days.length)}
            y={VIEW_H - 6}
            textAnchor="middle"
            fontSize={10}
            fill="hsl(var(--bc) / 0.45)"
          >
            {shortDate(days[index].date)}
          </text>
        ))}
      </svg>
    </figure>
  );
}

/** A compact 7-point trace for the dashboard widget — no axes, no labels. */
export function Sparkline({ days, className }: { days: DayPoint[]; className?: string }) {
  const span = WELLBEING_SCALE_MAX - WELLBEING_SCALE_MIN;
  const W = 120;
  const H = 28;

  // Same rule as the full chart: unlogged days break the line rather than
  // being drawn through. A widget is glanced at, not studied, so a smoothed-over
  // gap here is likelier to mislead than one on the page.
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];

  days.forEach((day, index) => {
    if (day.mood === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({
      x: (W / Math.max(days.length, 1)) * (index + 0.5),
      y: H - 3 - ((H - 6) * (day.mood - WELLBEING_SCALE_MIN)) / span,
    });
  });
  if (current.length > 0) segments.push(current);

  const last = segments[segments.length - 1]?.at(-1);
  if (!last) return null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label="Recent mood trend">
      {segments.map((segment, i) => (
        <polyline
          key={i}
          points={segment.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="hsl(var(--p))"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      <circle cx={last.x} cy={last.y} r={2.2} fill="hsl(var(--p))" />
    </svg>
  );
}
