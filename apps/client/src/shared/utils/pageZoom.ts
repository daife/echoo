export function installPageZoomGestureGuard(
  target: EventTarget = window,
): () => void {
  let controlKeyPressed = false;
  const listenerOptions = { capture: true, passive: false } as const;

  const handleKeyDown: EventListener = (event) => {
    if ((event as KeyboardEvent).key === "Control") {
      controlKeyPressed = true;
    }
  };
  const handleKeyUp: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Control") {
      controlKeyPressed = keyboardEvent.ctrlKey;
    }
  };
  const resetControlKey: EventListener = () => {
    controlKeyPressed = false;
  };
  const preventSyntheticControlWheel: EventListener = (event) => {
    const wheelEvent = event as WheelEvent;
    if (wheelEvent.ctrlKey && !controlKeyPressed) {
      wheelEvent.preventDefault();
    }
  };
  const preventGestureZoom: EventListener = (event) => {
    event.preventDefault();
  };

  target.addEventListener("keydown", handleKeyDown, listenerOptions);
  target.addEventListener("keyup", handleKeyUp, listenerOptions);
  target.addEventListener("blur", resetControlKey, listenerOptions);
  target.addEventListener(
    "wheel",
    preventSyntheticControlWheel,
    listenerOptions,
  );
  target.addEventListener("gesturestart", preventGestureZoom, listenerOptions);
  target.addEventListener("gesturechange", preventGestureZoom, listenerOptions);

  return () => {
    target.removeEventListener("keydown", handleKeyDown, listenerOptions);
    target.removeEventListener("keyup", handleKeyUp, listenerOptions);
    target.removeEventListener("blur", resetControlKey, listenerOptions);
    target.removeEventListener(
      "wheel",
      preventSyntheticControlWheel,
      listenerOptions,
    );
    target.removeEventListener(
      "gesturestart",
      preventGestureZoom,
      listenerOptions,
    );
    target.removeEventListener(
      "gesturechange",
      preventGestureZoom,
      listenerOptions,
    );
  };
}

export function buildPageZoomGestureGuardScript(): string {
  return `(${installPageZoomGestureGuard.toString()})();`;
}
