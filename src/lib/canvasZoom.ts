import type { Core } from "cytoscape";

export const CANVAS_FIT_PADDING = 36;
export const DEFAULT_CANVAS_MIN_ZOOM = 0.1;

export function canvasHasVisiblePins(cy: Core): boolean {
  return cy.nodes(":visible").some(node => node.data("pinned") === true);
}

export function canvasMinimumZoom(width: number, height: number, graphWidth: number, graphHeight: number, padding = CANVAS_FIT_PADDING): number {
  const fit = Math.min(
    Math.max(1, width - 2 * padding) / Math.max(1, graphWidth),
    Math.max(1, height - 2 * padding) / Math.max(1, graphHeight),
  );
  return Number.isFinite(fit) && fit > 0
    ? Math.min(DEFAULT_CANVAS_MIN_ZOOM, fit * 0.75)
    : DEFAULT_CANVAS_MIN_ZOOM;
}

/** Recalculate limits without fitting or recentering the user's viewport. */
export function updateCanvasZoomBounds(cy: Core, padding = CANVAS_FIT_PADDING): void {
  if (cy.destroyed() || cy.width() <= 0 || cy.height() <= 0) return;
  const elements = cy.elements(":visible");
  const bounds = elements.boundingBox();
  const calculatedMinimum = elements.length
    ? canvasMinimumZoom(cy.width(), cy.height(), bounds.w, bounds.h, padding)
    : DEFAULT_CANVAS_MIN_ZOOM;
  // A smaller layout must not zoom the camera in underneath pinned items.
  const minimum = canvasHasVisiblePins(cy) ? Math.min(calculatedMinimum, cy.zoom()) : calculatedMinimum;
  cy.minZoom(minimum);
  const zoom = Math.max(minimum, Math.min(cy.maxZoom(), cy.zoom()));
  if (zoom !== cy.zoom()) {
    cy.zoom({ level: zoom, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }
}

/** Batch geometry updates; observe the container as well as graph changes. */
export function observeCanvasZoomBounds(cy: Core, onChange: () => void): () => void {
  let frame: number | undefined;
  const schedule = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      updateCanvasZoomBounds(cy);
      onChange();
    });
  };
  const events = "add remove position style layoutstop resize";
  cy.on(events, schedule);
  const observer = new ResizeObserver(() => { cy.resize(); schedule(); });
  const container = cy.container();
  if (container) observer.observe(container);
  schedule();
  return () => {
    observer.disconnect();
    cy.removeListener(events, schedule);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}

export function canvasZoomPercent(zoom: number): number {
  return Number((zoom * 100).toPrecision(4));
}
