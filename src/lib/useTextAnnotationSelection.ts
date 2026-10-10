import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

type TextSelection = { startOffset: number; endOffset: number; quote: string };

// One selection lifecycle for mouse, keyboard, and native touch selection handles.
export function useTextAnnotationSelection(
  contentRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  sourceId: string,
  setSelection: Dispatch<SetStateAction<TextSelection | null>>,
) {
  useEffect(() => {
    setSelection(null);
    if (!enabled) return;
    let dragging = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capture = () => {
      clearTimeout(timer);
      const root = contentRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.isCollapsed || selection.rangeCount !== 1) {
        setSelection(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        setSelection(null);
        return;
      }
      const quote = selection.toString();
      if (!quote.trim()) { setSelection(null); return; }
      const prefix = document.createRange();
      prefix.selectNodeContents(root);
      prefix.setEnd(range.startContainer, range.startOffset);
      const startOffset = prefix.toString().length;
      const endOffset = startOffset + quote.length;
      setSelection(current => current?.startOffset === startOffset && current.endOffset === endOffset && current.quote === quote
        ? current : { startOffset, endOffset, quote });
    };
    const changed = () => {
      clearTimeout(timer);
      if (!dragging) timer = setTimeout(capture, 100);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !contentRef.current?.contains(event.target as Node)) return;
      clearTimeout(timer);
      // Touch selection handles can continue changing the range after pointerup.
      dragging = event.pointerType !== "touch";
    };
    const up = (event: Event) => {
      if (!dragging && !contentRef.current?.contains(event.target as Node)) return;
      dragging = false;
      capture();
    };
    const cancel = () => {
      dragging = false;
      clearTimeout(timer);
      setSelection(null);
    };
    document.addEventListener("selectionchange", changed);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("mouseup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", changed);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("mouseup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [contentRef, enabled, sourceId, setSelection]);
}
