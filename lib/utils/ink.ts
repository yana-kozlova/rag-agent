/**
 * What a handwritten note is before it becomes a picture.
 *
 * Strokes are kept as points rather than drawn straight onto the canvas and
 * forgotten, for three reasons that all turned out to be the same one: undo
 * removes a stroke, the eraser removes the stroke it touches, and the saved
 * image is not the canvas the user sees — it is redrawn dark-on-white and
 * cropped to what was written, because the vision model reads that better than
 * a theme-coloured line on a theme-coloured card. All three need the strokes.
 *
 * Dependency-free: the pad is a client component, and the geometry is tested
 * without a canvas.
 */

/** `[x, y, pressure]` in CSS pixels, pressure in 0..1. */
export type InkPoint = [number, number, number];

export type InkStroke = { points: InkPoint[] };

/** Line width at medium pressure, in CSS pixels. */
export const INK_BASE_WIDTH = 2.2;

/** How close the eraser has to come to a stroke to take it. */
export const ERASER_RADIUS = 12;

/** White space kept around the writing in the saved image. */
export const EXPORT_PADDING = 24;

/** Drawn dark on white whatever the theme — this is what the model reads. */
export const EXPORT_INK = '#111111';
export const EXPORT_PAPER = '#ffffff';

/**
 * Whether a pointer may draw.
 *
 * Once a pen has touched the pad, touch is the heel of the hand resting on the
 * glass — on a tablet both arrive as pointers, and without this the palm draws
 * a second line under every word. A finger still draws until a pen shows up, so
 * the pad works on a phone.
 */
export function acceptsPointer(pointerType: string, penSeen: boolean): boolean {
  return !(pointerType === 'touch' && penSeen);
}

/**
 * Pressure as something to draw with.
 *
 * Only a pen reports a real one. A mouse says 0.5 while pressed, a finger says
 * whatever the driver invents, and some styluses report 0 for the whole stroke
 * — which would otherwise draw the thinnest possible line or none at all.
 */
export function normalizePressure(pressure: number, pointerType: string): number {
  if (pointerType !== 'pen') return 0.5;
  if (!Number.isFinite(pressure) || pressure <= 0) return 0.5;
  return Math.min(pressure, 1);
}

/** Half the base width at a feather touch, one and a half at full pressure. */
export function widthFor(pressure: number, base = INK_BASE_WIDTH): number {
  return base * (0.5 + pressure);
}

function distanceToSegment(
  x: number,
  y: number,
  [ax, ay]: InkPoint,
  [bx, by]: InkPoint
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  // A dot — or two samples on the same pixel — has no direction to project onto.
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/**
 * Whether the eraser at `(x, y)` touches this stroke.
 *
 * Measured against the segments, not the sample points: a fast stroke has its
 * points far apart, and an eraser passing between two of them would otherwise
 * cross the line without taking it.
 */
export function strokeHit(stroke: InkStroke, x: number, y: number, radius = ERASER_RADIUS): boolean {
  const { points } = stroke;
  if (points.length === 0) return false;
  if (points.length === 1) return Math.hypot(x - points[0][0], y - points[0][1]) <= radius;

  for (let i = 1; i < points.length; i++) {
    if (distanceToSegment(x, y, points[i - 1], points[i]) <= radius) return true;
  }
  return false;
}

export type InkBounds = { x: number; y: number; width: number; height: number };

/** The box around everything written, padded. Null when nothing is. */
export function inkBounds(strokes: InkStroke[], padding = EXPORT_PADDING): InkBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const [x, y] of stroke.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (!Number.isFinite(minX)) return null;

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * A draft read back out of storage.
 *
 * Validated point by point: the value is whatever a previous version of this
 * page left behind, and one malformed stroke handed to the canvas throws on
 * every paint until the user clears site data.
 */
export function parseDraft(raw: string | null | undefined): InkStroke[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((stroke) => ({
        points: (Array.isArray(stroke?.points) ? stroke.points : []).filter(
          (p: unknown): p is InkPoint =>
            Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number' && Number.isFinite(n))
        ),
      }))
      .filter((stroke) => stroke.points.length > 0);
  } catch {
    return [];
  }
}

/** The 2D context methods this needs — a subset, so a test can pass a recorder. */
export type InkContext = Pick<
  CanvasRenderingContext2D,
  'beginPath' | 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'stroke' | 'arc' | 'fill'
> & {
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
};

/**
 * Draw strokes, shifted by `(-originX, -originY)`.
 *
 * Each segment is its own path because a canvas path has one width, and the
 * width follows pressure. Segments run between midpoints with the sample as the
 * control point, which is what turns sixty samples a second into a curve
 * instead of a visible polygon.
 */
export function drawStrokes(
  ctx: InkContext,
  strokes: InkStroke[],
  color: string,
  originX = 0,
  originY = 0
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  for (const { points } of strokes) {
    if (points.length === 0) continue;

    if (points.length === 1) {
      const [x, y, p] = points[0];
      ctx.beginPath();
      ctx.arc(x - originX, y - originY, widthFor(p) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    for (let i = 1; i < points.length; i++) {
      const [px, py, pp] = points[i - 1];
      const [cx, cy, cp] = points[i];
      const startX = i === 1 ? px : (points[i - 2][0] + px) / 2;
      const startY = i === 1 ? py : (points[i - 2][1] + py) / 2;
      const last = i === points.length - 1;
      const endX = last ? cx : (px + cx) / 2;
      const endY = last ? cy : (py + cy) / 2;

      ctx.beginPath();
      ctx.lineWidth = widthFor((pp + cp) / 2);
      ctx.moveTo(startX - originX, startY - originY);
      ctx.quadraticCurveTo(px - originX, py - originY, endX - originX, endY - originY);
      ctx.stroke();
    }
  }
}
