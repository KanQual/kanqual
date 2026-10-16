import { useEffect, useState } from "react";
import type { Core } from "cytoscape";
import { PinIcon } from "./AppIcons";
import { useI18n } from "../i18n/provider";

type Badge = { id: string; kind: "node" | "edge"; x: number; y: number };

export function CanvasPinBadges({ graph }: { graph: Core | null }) {
  const { t } = useI18n();
  const [badges, setBadges] = useState<Badge[]>([]);
  useEffect(() => {
    if (!graph || graph.destroyed()) return;
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      if (graph.destroyed()) return;
      const next: Badge[] = [];
      const add = (badge: Badge) => {
        if (Number.isFinite(badge.x) && Number.isFinite(badge.y)
          && badge.x >= -20 && badge.y >= -20 && badge.x <= graph.width() + 20 && badge.y <= graph.height() + 20) next.push(badge);
      };
      graph.nodes(":visible").forEach(node => {
        if (!node.data("pinned")) return;
        const bounds = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
        add({ id: node.id(), kind: "node", x: bounds.x2 + 5, y: bounds.y1 - 5 });
      });
      graph.edges(":visible").forEach(edge => {
        if (!edge.source().visible() || !edge.target().visible() || !edge.source().data("pinned") || !edge.target().data("pinned")) return;
        const midpoint = edge.renderedMidpoint();
        let x = midpoint.x;
        let y = midpoint.y;
        if (edge.data("label") && edge.numericStyle("text-opacity") > 0) {
          const bounds = edge.renderedBoundingBox({ includeNodes: false, includeEdges: false, includeLabels: true, includeOverlays: false });
          x = bounds.x2 + 13;
          y = (bounds.y1 + bounds.y2) / 2;
        }
        add({ id: edge.id(), kind: "edge", x, y });
      });
      setBadges(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(update); };
    const events = "render pan zoom position resize add remove data style select unselect";
    graph.on(events, schedule);
    schedule();
    return () => {
      graph.off(events, schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [graph]);
  return <div className="graph-canvas-pin-badges">
    {badges.map(badge => {
      const label = t(badge.kind === "node" ? "projectCore.graph.pinnedBadge" : "projectCore.graph.pinnedRelationshipBadge");
      return <span key={`${badge.kind}:${badge.id}`} className="graph-canvas-pin-badge"
        data-pin-kind={badge.kind} data-pin-id={badge.id} style={{ left: badge.x, top: badge.y }}
        role="img" aria-label={label} title={label}>
        <PinIcon />
      </span>;
    })}
  </div>;
}
