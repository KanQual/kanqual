export type CanvasLayoutSettings = {
  groupBy: string;
  spacing: "compact" | "balanced" | "spread";
  includeLabels: boolean;
  groupPadding: number;
  nodeRepulsion: number;
  groupRepulsion: number;
  groupGravity: number;
  edgeLength: number;
  edgeElasticity: number;
  iterations: number;
};

export const DEFAULT_CANVAS_LAYOUT_SETTINGS: CanvasLayoutSettings = {
  groupBy: "type",
  spacing: "balanced",
  includeLabels: true,
  groupPadding: 40,
  nodeRepulsion: 6500,
  groupRepulsion: 1,
  groupGravity: 1,
  edgeLength: 100,
  edgeElasticity: 0.45,
  iterations: 2500,
};

export const CANVAS_ADVANCED_CONTROLS = [
  { key: "groupPadding", min: 0, max: 300, step: 10, groupOnly: true },
  { key: "nodeRepulsion", min: 500, max: 30000, step: 500, groupOnly: false },
  { key: "groupRepulsion", min: 1, max: 10, step: 0.5, groupOnly: true },
  { key: "groupGravity", min: 0, max: 5, step: 0.1, groupOnly: true },
  { key: "edgeLength", min: 20, max: 500, step: 10, groupOnly: false },
  { key: "edgeElasticity", min: 0.05, max: 1, step: 0.05, groupOnly: false },
  { key: "iterations", min: 500, max: 10000, step: 500, groupOnly: false },
] as const;

export type CanvasGroupingItem = {
  id: string;
  kind: string;
  type: string;
  attributes: Array<{ name: string; value: string }>;
};

export function canvasLayoutGroups(items: CanvasGroupingItem[], groupBy: string): Record<string, string> {
  if (groupBy === "none") return {};
  return Object.fromEntries(items.map(item => {
    const key = groupBy === "kind" ? [item.kind]
      : groupBy === "type" ? [item.kind, item.type]
        : [item.attributes.find(attribute => attribute.name === groupBy.slice(10))?.value.trim() || null];
    return [item.id, JSON.stringify(key)];
  }));
}
