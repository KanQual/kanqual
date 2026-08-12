import type { ElementDefinition, StylesheetJson } from "cytoscape";
import type {
  PostgresCanvasNodeState,
  PostgresObject,
  PostgresObjectType,
  PostgresRelationship,
  PostgresRelationshipType,
} from "./postgres";

type CanvasObjectFill = "filled" | "outline";
type CanvasObjectShape =
  | "rounded"
  | "rectangle"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "octagon"
  | "parallelogram"
  | "trapezoid"
  | "tag"
  | "star";
type CanvasRelationshipLineShape = "solid" | "dashed" | "dotted";
type CanvasRelationshipArrowhead = "one_sided" | "double_sided" | "none";

type PostgresCanvasCytoscapeNodeData = {
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  borderWidth: number;
  shadowColor: string;
  shadowOpacity: number;
  fill: CanvasObjectFill;
  shape: CanvasObjectShape;
  textColor: string;
  textMaxWidth: number;
  width: number;
  height: number;
  label: string;
};

function getPostgresCanvasCytoscapeShape(shape: CanvasObjectShape): string {
  switch (shape) {
    case "rounded":
      return "ellipse";
    case "rectangle":
      return "rectangle";
    case "triangle":
      return "triangle";
    case "diamond":
      return "diamond";
    case "hexagon":
      return "hexagon";
    case "octagon":
      return "octagon";
    case "tag":
      return "tag";
    case "star":
      return "star";
    case "parallelogram":
    case "trapezoid":
      return "polygon";
    default:
      return "rectangle";
  }
}

function getPostgresCanvasCytoscapePolygonPoints(shape: CanvasObjectShape): string {
  switch (shape) {
    case "parallelogram":
      return "-0.72 -1 1 -1 0.72 1 -1 1";
    case "trapezoid":
      return "-0.56 -1 0.56 -1 1 1 -1 1";
    default:
      return "-1 -1 1 -1 1 1 -1 1";
  }
}

function getPostgresCanvasNodeLabel(object: PostgresObject): string {
  const title = object.title.trim() || "Untitled object";
  const objectType = object.objectType.trim();
  return objectType ? `${title}\n${objectType}` : title;
}

function getPostgresCanvasTextMaxWidth(shape: CanvasObjectShape, width: number): number {
  switch (shape) {
    case "triangle":
      return Math.floor(width * 0.5);
    case "diamond":
      return Math.floor(width * 0.48);
    case "star":
      return Math.floor(width * 0.46);
    case "tag":
      return Math.floor(width * 0.58);
    case "hexagon":
    case "octagon":
      return Math.floor(width * 0.62);
    case "parallelogram":
    case "trapezoid":
      return Math.floor(width * 0.6);
    default:
      return Math.floor(width * 0.72);
  }
}

export function buildPostgresCanvasCytoscapeElements(args: {
  objects: PostgresObject[];
  nodeStates: Record<string, PostgresCanvasNodeState>;
  objectTypeById: Map<string, PostgresObjectType>;
  relationships: PostgresRelationship[];
  relationshipTypes: PostgresRelationshipType[];
  hiddenRelationshipIds: string[];
  getObjectAppearance: (
    object: PostgresObject,
    objectTypeRecord: PostgresObjectType | null,
  ) => {
    shape: CanvasObjectShape;
    color: string;
    fill: CanvasObjectFill;
  };
  getObjectSurfaceStyle: (
    color: string,
    fill: CanvasObjectFill,
    selected?: boolean,
  ) => {
    textColor: string;
  };
  getNodeRenderedDimensions: (
    shape: CanvasObjectShape,
    nodeState: Pick<PostgresCanvasNodeState, "width" | "height"> | null | undefined,
  ) => { width: number; height: number };
  getRelationshipAppearance: (
    relationship: PostgresRelationship,
    relationshipTypeRecord: PostgresRelationshipType | null,
  ) => {
    color: string;
    lineWeight: number;
    lineShape: CanvasRelationshipLineShape;
    arrowhead: CanvasRelationshipArrowhead;
  };
  getRelationshipStrokeWidth: (lineWeight: number) => number;
}): ElementDefinition[] {
  const {
    objects,
    nodeStates,
    objectTypeById,
    relationships,
    relationshipTypes,
    hiddenRelationshipIds,
    getObjectAppearance,
    getObjectSurfaceStyle,
    getNodeRenderedDimensions,
    getRelationshipAppearance,
    getRelationshipStrokeWidth,
  } = args;
  const visibleNodeIds = new Set(Object.keys(nodeStates));
  const nodes = objects.reduce<ElementDefinition[]>((elements, object) => {
    const nodeState = nodeStates[object.id];
    if (!nodeState) return elements;
    const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
    const appearance = getObjectAppearance(object, objectTypeRecord);
    const surface = getObjectSurfaceStyle(appearance.color, appearance.fill, false);
    const { width, height } = getNodeRenderedDimensions(appearance.shape, nodeState);
    const isFilled = appearance.fill === "filled";

    elements.push({
      group: "nodes",
      data: {
        id: object.id,
        color: appearance.color,
        backgroundColor: appearance.color,
        backgroundOpacity: isFilled ? 1 : 0,
        borderWidth: isFilled ? 2 : 3,
        shadowColor: appearance.color,
        shadowOpacity: isFilled ? 0.18 : 0.1,
        fill: appearance.fill,
        shape: appearance.shape,
        textColor: surface.textColor,
        textMaxWidth: Math.max(72, getPostgresCanvasTextMaxWidth(appearance.shape, width)),
        width,
        height,
        label: getPostgresCanvasNodeLabel(object),
      } satisfies PostgresCanvasCytoscapeNodeData & { id: string },
      position: { x: nodeState.x + width / 2, y: nodeState.y + height / 2 },
      classes: `canvas-object canvas-object--${appearance.shape}`,
    });
    return elements;
  }, []);

  const edges = relationships
    .filter((relationship) =>
      !hiddenRelationshipIds.includes(relationship.id)
      && visibleNodeIds.has(relationship.fromObjectId)
      && visibleNodeIds.has(relationship.toObjectId),
    )
    .map((relationship) => {
      const relationshipTypeRecord = relationshipTypes.find(
        (relationshipType) => relationshipType.id === relationship.relationshipTypeId,
      ) ?? null;
      const appearance = getRelationshipAppearance(relationship, relationshipTypeRecord);
      return {
        group: "edges",
        data: {
          id: relationship.id,
          source: relationship.fromObjectId,
          target: relationship.toObjectId,
          label: relationship.relationshipType,
          color: appearance.color,
          strokeWidth: getRelationshipStrokeWidth(appearance.lineWeight),
          lineStyle: appearance.lineShape,
          targetArrow: appearance.arrowhead === "none" ? "none" : "triangle",
          sourceArrow: appearance.arrowhead === "double_sided" ? "triangle" : "none",
        },
        classes: "canvas-relationship",
      } satisfies ElementDefinition;
    });

  return [...nodes, ...edges];
}

export const POSTGRES_CYTOSCAPE_STYLESHEET = [
  {
    selector: "node.canvas-object",
    style: {
      shape: (element: { data: (key: string) => string }) => getPostgresCanvasCytoscapeShape(element.data("shape") as CanvasObjectShape),
      "shape-polygon-points": (element: { data: (key: string) => string }) => getPostgresCanvasCytoscapePolygonPoints(element.data("shape") as CanvasObjectShape),
      width: (element: { data: (key: string) => number }) => element.data("width"),
      height: (element: { data: (key: string) => number }) => element.data("height"),
      "background-color": (element: { data: (key: string) => string | number }) => String(element.data("backgroundColor")),
      "background-opacity": (element: { data: (key: string) => string | number }) => Number(element.data("backgroundOpacity")),
      "border-width": (element: { data: (key: string) => string | number }) => Number(element.data("borderWidth")),
      "border-color": (element: { data: (key: string) => string }) => element.data("color"),
      "border-style": "solid",
      label: (element: { data: (key: string) => string }) => element.data("label"),
      color: (element: { data: (key: string) => string }) => element.data("textColor"),
      "font-size": 14,
      "font-weight": 700,
      "text-wrap": "wrap",
      "text-max-width": (element: { data: (key: string) => number }) => `${element.data("textMaxWidth")}px`,
      "text-halign": "center",
      "text-valign": "center",
      "text-justification": "center",
      "line-height": 1.16,
      "text-margin-y": 2,
      "text-events": "no",
      "shadow-blur": 18,
      "shadow-offset-x": 0,
      "shadow-offset-y": 8,
      "shadow-color": (element: { data: (key: string) => string }) => element.data("shadowColor"),
      "shadow-opacity": (element: { data: (key: string) => number }) => element.data("shadowOpacity"),
      "transition-property": "border-color, border-width, shadow-opacity, outline-opacity",
      "transition-duration": "120ms",
      "overlay-opacity": 0,
      "active-bg-opacity": 0,
      "active-bg-size": 0,
    },
  },
  {
    selector: "node.canvas-object:selected",
    style: {
      "outline-width": 8,
      "outline-color": "rgba(59, 130, 246, 0.28)",
      "outline-opacity": 1,
      "outline-offset": 2,
      "border-width": 4,
      "shadow-opacity": 0.24,
    },
  },
  {
    selector: "node.canvas-object.connect-source",
    style: {
      "outline-width": 10,
      "outline-color": "rgba(16, 185, 129, 0.28)",
      "outline-opacity": 1,
      "outline-offset": 3,
      "border-color": "#0f766e",
      "shadow-opacity": 0.24,
    },
  },
  {
    selector: "node.canvas-object.connect-valid-target",
    style: {
      "outline-width": 8,
      "outline-color": "rgba(16, 185, 129, 0.22)",
      "outline-opacity": 1,
      "outline-offset": 2,
    },
  },
  {
    selector: "node.canvas-object.connect-invalid-target",
    style: {
      opacity: 0.58,
    },
  },
  {
    selector: "edge.canvas-relationship",
    style: {
      width: (element: { data: (key: string) => number }) => element.data("strokeWidth"),
      "line-style": (element: { data: (key: string) => string }) => element.data("lineStyle"),
      "line-color": (element: { data: (key: string) => string }) => element.data("color"),
      "target-arrow-color": (element: { data: (key: string) => string }) => element.data("color"),
      "source-arrow-color": (element: { data: (key: string) => string }) => element.data("color"),
      "target-arrow-shape": (element: { data: (key: string) => string }) => element.data("targetArrow"),
      "source-arrow-shape": (element: { data: (key: string) => string }) => element.data("sourceArrow"),
      "curve-style": "bezier",
      "source-endpoint": "outside-to-node",
      "target-endpoint": "outside-to-node",
      label: (element: { data: (key: string) => string }) => element.data("label"),
      color: (element: { data: (key: string) => string }) => element.data("color"),
      "font-size": 12,
      "font-weight": 700,
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.92,
      "text-background-shape": "roundrectangle",
      "text-background-padding": 4,
      "text-margin-y": -8,
      "text-opacity": 0,
      "arrow-scale": 1.05,
      "overlay-opacity": 0,
      "transition-property": "line-color, width, underlay-opacity",
      "transition-duration": "120ms",
      "active-bg-opacity": 0,
      "active-bg-size": 0,
    },
  },
  {
    selector: "edge.canvas-relationship:selected",
    style: {
      "underlay-color": "rgba(59, 130, 246, 0.22)",
      "underlay-opacity": 1,
      "underlay-padding": 9,
      width: (element: { data: (key: string) => number }) => Number(element.data("strokeWidth")) + 1,
    },
  },
] as unknown as StylesheetJson;
