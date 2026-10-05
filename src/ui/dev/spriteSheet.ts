/**
 * Sprite-sheet frame math for the V42 idle character PoC (Option D).
 *
 * DEV-ONLY. Pure logic, no React Native dependency, so it is unit-testable
 * with vitest. Removable together with src/ui/dev/.
 */

export interface SpriteSheetLayout {
  /** Pixel size of one frame in the sheet. */
  frameWidth: number;
  frameHeight: number;
  /** Grid dimensions of the sheet. */
  columns: number;
  rows: number;
  /** Number of animation frames actually used (<= columns * rows). */
  frameCount: number;
  /** Playback speed of the loop. */
  fps: number;
}

/**
 * Frame index to display at `elapsedMs` milliseconds into the loop.
 * Wraps seamlessly: frame(frameCount * frameDuration) === frame(0).
 */
export function frameIndexAtTime(layout: SpriteSheetLayout, elapsedMs: number): number {
  if (layout.frameCount <= 0 || layout.fps <= 0) return 0;
  const frameDuration = 1000 / layout.fps;
  const t = elapsedMs < 0 ? 0 : elapsedMs;
  return Math.floor(t / frameDuration) % layout.frameCount;
}

/**
 * Pixel offset to apply to the sheet image so that `frameIndex` is visible
 * inside a frameWidth x frameHeight clipping window.
 */
export function frameOffset(
  layout: SpriteSheetLayout,
  frameIndex: number,
): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(layout.frameCount - 1, Math.floor(frameIndex)));
  const col = clamped % layout.columns;
  const row = Math.floor(clamped / layout.columns);
  const x = -col * layout.frameWidth;
  const y = -row * layout.frameHeight;
  // Normalize -0 to +0 so offsets compare cleanly.
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}
