import { describe, expect, it } from "vitest";
import indexHtml from "../../../index.html?raw";
import { installPageZoomGestureGuard } from "./pageZoom";

describe("installPageZoomGestureGuard", () => {
  it("blocks synthetic control-wheel zoom but preserves normal scrolling", () => {
    const target = new EventTarget();
    installPageZoomGestureGuard(target);

    const normalWheel = createWheelEvent(false);
    target.dispatchEvent(normalWheel);
    expect(normalWheel.defaultPrevented).toBe(false);

    const pinchWheel = createWheelEvent(true);
    target.dispatchEvent(pinchWheel);
    expect(pinchWheel.defaultPrevented).toBe(true);
  });

  it("preserves physical control-wheel zoom and resets on blur", () => {
    const target = new EventTarget();
    installPageZoomGestureGuard(target);

    target.dispatchEvent(createKeyboardEvent("keydown", "Control", true));
    const controlWheel = createWheelEvent(true);
    target.dispatchEvent(controlWheel);
    expect(controlWheel.defaultPrevented).toBe(false);

    target.dispatchEvent(new Event("blur"));
    const wheelAfterBlur = createWheelEvent(true);
    target.dispatchEvent(wheelAfterBlur);
    expect(wheelAfterBlur.defaultPrevented).toBe(true);
  });

  it("blocks Safari gesture zoom and removes every listener on cleanup", () => {
    const target = new EventTarget();
    const cleanup = installPageZoomGestureGuard(target);

    const gesture = new Event("gesturestart", { cancelable: true });
    target.dispatchEvent(gesture);
    expect(gesture.defaultPrevented).toBe(true);

    cleanup();
    const wheelAfterCleanup = createWheelEvent(true);
    target.dispatchEvent(wheelAfterCleanup);
    expect(wheelAfterCleanup.defaultPrevented).toBe(false);
  });
});

describe("page viewport", () => {
  it("disables touch scaling in the main document", () => {
    expect(indexHtml).toContain("maximum-scale=1.0");
    expect(indexHtml).toContain("user-scalable=no");
  });
});

function createWheelEvent(ctrlKey: boolean): WheelEvent {
  const event = new Event("wheel", { cancelable: true });
  Object.defineProperty(event, "ctrlKey", { value: ctrlKey });
  return event as WheelEvent;
}

function createKeyboardEvent(
  type: "keydown" | "keyup",
  key: string,
  ctrlKey: boolean,
): KeyboardEvent {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    ctrlKey: { value: ctrlKey },
    key: { value: key },
  });
  return event as KeyboardEvent;
}
