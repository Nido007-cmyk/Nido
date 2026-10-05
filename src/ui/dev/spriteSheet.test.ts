import { describe, it, expect } from "vitest";
import { frameIndexAtTime, frameOffset, SpriteSheetLayout } from "./spriteSheet";

// 12-frame idle loop, 4x3 grid of 256px frames @ 12fps — the V42 PoC sheet.
const LAYOUT: SpriteSheetLayout = {
  frameWidth: 256,
  frameHeight: 256,
  columns: 4,
  rows: 3,
  frameCount: 12,
  fps: 12,
};

describe("frameIndexAtTime()", () => {
  it("starts at frame 0", () => {
    expect(frameIndexAtTime(LAYOUT, 0)).toBe(0);
  });

  it("advances one frame per frame-duration", () => {
    expect(frameIndexAtTime(LAYOUT, 84)).toBe(1); // 1000/12 ~= 83.33ms
    expect(frameIndexAtTime(LAYOUT, 500)).toBe(6);
  });

  it("wraps seamlessly at the loop boundary", () => {
    expect(frameIndexAtTime(LAYOUT, 1000)).toBe(0);
    expect(frameIndexAtTime(LAYOUT, 2000)).toBe(0);
    expect(frameIndexAtTime(LAYOUT, 1084)).toBe(1);
  });

  it("never exceeds frameCount - 1", () => {
    for (const t of [0, 1, 83, 999, 1001, 123456]) {
      const f = frameIndexAtTime(LAYOUT, t);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(LAYOUT.frameCount);
    }
  });

  it("handles degenerate layouts without throwing", () => {
    expect(frameIndexAtTime({ ...LAYOUT, frameCount: 0 }, 500)).toBe(0);
    expect(frameIndexAtTime({ ...LAYOUT, fps: 0 }, 500)).toBe(0);
    expect(frameIndexAtTime(LAYOUT, -50)).toBe(0);
  });
});

describe("frameOffset()", () => {
  it("places frame 0 at the origin", () => {
    expect(frameOffset(LAYOUT, 0)).toEqual({ x: 0, y: 0 });
  });

  it("walks the grid row-major", () => {
    expect(frameOffset(LAYOUT, 1)).toEqual({ x: -256, y: 0 });
    expect(frameOffset(LAYOUT, 3)).toEqual({ x: -768, y: 0 });
    expect(frameOffset(LAYOUT, 4)).toEqual({ x: 0, y: -256 });
    expect(frameOffset(LAYOUT, 11)).toEqual({ x: -768, y: -512 });
  });

  it("clamps out-of-range indices into the valid frame range", () => {
    expect(frameOffset(LAYOUT, 99)).toEqual(frameOffset(LAYOUT, 11));
    expect(frameOffset(LAYOUT, -3)).toEqual(frameOffset(LAYOUT, 0));
  });
});
