import cytoscape, { type Core, type LayoutOptions, type NodeSingular } from "cytoscape";
import fcose from "cytoscape-fcose";
import type { PostgresCanvasNodeState } from "./postgres";
import { DEFAULT_CANVAS_LAYOUT_SETTINGS, type CanvasLayoutSettings } from "./canvasLayoutSettings";

cytoscape.use(fcose);

// Use a separate graph so a failed layout cannot partially move the visible graph.
export function computeCanvasNetworkLayout(
  source: Core,
  canvasNodes: Record<string, PostgresCanvasNodeState>,
  settings: CanvasLayoutSettings = DEFAULT_CANVAS_LAYOUT_SETTINGS,
  groups: Record<string, string> = {},
): Record<string, PostgresCanvasNodeState> {
  const nodes = source.nodes(":visible").filter(node => Boolean(canvasNodes[node.id()]));
  if (!nodes.length) return canvasNodes;
  const ids = new Set(nodes.map(node => node.id()));
  const groupIds = new Map<string, string>();
  nodes.forEach(node => {
    const key = groups[node.id()];
    if (key === undefined || groupIds.has(key)) return;
    let id = `__layout_group_${groupIds.size}`;
    while (source.getElementById(id).length || [...groupIds.values()].includes(id)) id += "_";
    groupIds.set(key, id);
  });
  const spacing = { compact: 0.65, balanced: 1, spread: 1.65 }[settings.spacing];
  const graph = cytoscape({
    headless: true,
    styleEnabled: true,
    style: [
      { selector: "node:childless", style: { width: "data(width)", height: "data(height)" } },
      { selector: ":parent", style: { padding: `${settings.groupPadding * spacing}px` } },
    ],
    elements: [
      ...[...groupIds.values()].map(id => ({ data: { id } })),
      ...nodes.map(node => {
        const bounds = node.boundingBox({ includeLabels: settings.includeLabels, includeOverlays: false });
        return {
          data: { id: node.id(), parent: groupIds.get(groups[node.id()]), width: Math.max(1, bounds.w), height: Math.max(1, bounds.h) },
          position: { ...(node as NodeSingular).position() },
        };
      }),
      ...source.edges(":visible")
        .filter(edge => ids.has(edge.source().id()) && ids.has(edge.target().id()))
        .map(edge => ({ data: { id: edge.id(), source: edge.data("source"), target: edge.data("target") } })),
    ],
  });
  try {
    graph.layout({
      name: "fcose", quality: "proof", randomize: true, animate: false,
      fit: false, packComponents: false, tile: true,
      idealEdgeLength: settings.edgeLength * spacing,
      nodeRepulsion: (node: NodeSingular) => settings.nodeRepulsion * spacing * spacing * (node.isParent() ? settings.groupRepulsion : 1),
      gravityCompound: settings.groupGravity,
      edgeElasticity: settings.edgeElasticity,
      numIter: settings.iterations,
      tilingPaddingHorizontal: 40 * spacing, tilingPaddingVertical: 40 * spacing,
      fixedNodeConstraint: nodes.filter(node => Boolean(canvasNodes[node.id()].pinned))
        .map(node => ({ nodeId: node.id(), position: { ...(node as NodeSingular).position() } })),
    } as LayoutOptions).run();
    const next = { ...canvasNodes };
    nodes.forEach(node => {
      if (canvasNodes[node.id()].pinned) return;
      const position = graph.getElementById(node.id()).position();
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        throw new Error("Network layout returned an invalid position.");
      }
      next[node.id()] = {
        ...canvasNodes[node.id()],
        x: position.x - node.width() / 2,
        y: position.y - node.height() / 2,
      };
    });
    return next;
  } finally {
    graph.destroy();
  }
}
