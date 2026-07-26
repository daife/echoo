import { describe, expect, it } from "vitest";
import {
  clampMediaScale,
  clampMediaTransform,
  distanceBetween,
  midpointBetween,
  zoomMediaTransform,
} from "./mediaViewerTransform";

describe("media viewer transforms", () => {
  it("limits zoom to the supported range", () => {
    expect(clampMediaScale(0.25)).toBe(1);
    expect(clampMediaScale(2.5)).toBe(2.5);
    expect(clampMediaScale(8)).toBe(4);
  });

  it("keeps the focal point stable while zooming", () => {
    expect(
      zoomMediaTransform(
        { scale: 1, x: 0, y: 0 },
        2,
        { x: 300, y: 200 },
        { width: 400, height: 400 },
        { width: 400, height: 300 },
      ),
    ).toEqual({ scale: 2, x: -100, y: 0 });
  });

  it("clamps panning to the scaled media bounds and resets at 1x", () => {
    expect(
      clampMediaTransform(
        { scale: 3, x: 900, y: -900 },
        { width: 400, height: 300 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ scale: 3, x: 250, y: -150 });
    expect(
      clampMediaTransform(
        { scale: 1, x: 40, y: -20 },
        { width: 400, height: 300 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("calculates pinch distance and midpoint", () => {
    expect(distanceBetween({ x: 10, y: 20 }, { x: 40, y: 60 })).toBe(50);
    expect(midpointBetween({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual({
      x: 25,
      y: 40,
    });
  });
});
