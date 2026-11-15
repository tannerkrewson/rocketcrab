import { useCallback, useEffect, useRef } from "react";

/**
 * Starts a pointer drag whose move and release listeners live on `window`, so
 * the drag keeps tracking when the pointer leaves the handle. Starting a new
 * drag ends the previous one, and unmounting mid-drag removes the listeners
 * rather than leaving them to call setState on an unmounted component.
 */
export function useWindowPointerDrag(): (onMove: (event: PointerEvent) => void) => void {
  const endActiveDrag = useRef<(() => void) | null>(null);

  useEffect(() => {
    const activeDrag = endActiveDrag;
    return () => activeDrag.current?.();
  }, []);

  return useCallback((onMove: (event: PointerEvent) => void) => {
    endActiveDrag.current?.();
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      endActiveDrag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    endActiveDrag.current = onEnd;
  }, []);
}
