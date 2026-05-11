import { useEffect, useState, type CSSProperties, type RefObject } from "react";

const CONTEXT_MENU_MARGIN = 12;
const FALLBACK_MENU_WIDTH = 220;
const FALLBACK_MENU_HEIGHT = 120;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getViewportAwarePosition(x: number, y: number, width: number, height: number) {
  const maxLeft = Math.max(CONTEXT_MENU_MARGIN, window.innerWidth - width - CONTEXT_MENU_MARGIN);
  const maxTop = Math.max(CONTEXT_MENU_MARGIN, window.innerHeight - height - CONTEXT_MENU_MARGIN);

  return {
    left: clamp(x, CONTEXT_MENU_MARGIN, maxLeft),
    top: clamp(y, CONTEXT_MENU_MARGIN, maxTop),
  };
}

export function useViewportContextMenuStyle<T extends HTMLElement>(
  anchor: { x: number; y: number } | null,
  ref: RefObject<T | null>,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();

  useEffect(() => {
    if (!anchor) {
      setStyle(undefined);
      return;
    }

    let rafId = 0;

    const updatePosition = () => {
      const width = ref.current?.offsetWidth ?? FALLBACK_MENU_WIDTH;
      const height = ref.current?.offsetHeight ?? FALLBACK_MENU_HEIGHT;
      const next = getViewportAwarePosition(anchor.x, anchor.y, width, height);
      setStyle(next);
    };

    setStyle({ top: anchor.y, left: anchor.x, visibility: "hidden" });
    rafId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor?.x, anchor?.y, ref]);

  return style;
}
