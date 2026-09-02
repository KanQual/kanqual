import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import cytoscape, { type Core as CytoscapeCore, type ElementDefinition, type NodeSingular } from "cytoscape";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  POSTGRES_SOURCE_DOCUMENT_SILHOUETTE_POLYGON,
  POSTGRES_CYTOSCAPE_STYLESHEET,
} from "../lib/postgresCanvasGraph";
import { DownloadIcon, FitCornersIcon, HelpIcon, LayoutNetworkIcon, PlusIcon, ZoomIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import type {
  PostgresCanvasNodeState,
  PostgresObject,
  PostgresObjectType,
  PostgresRelationship,
  PostgresRelationshipType,
} from "../lib/postgres";

const postgresExploreElk = new ELK();

type PostgresExploreInspectorDetails = {
  title: string;
  itemType: "Source" | "Object" | "Relationship" | "Code" | string;
  typeDetail?: string;
  preview?: ReactNode;
  attributes: Array<{
    name: string;
    value: string;
  }>;
};

type PostgresExploreRelationshipEndpointContext = {
  object: PostgresObject;
  objectTypeRecord: PostgresObjectType | null;
};

type PostgresExploreRenderedPoint = {
  x: number;
  y: number;
};

type PostgresExploreConnectorHandle = {
  id: string;
  endpointKey: string;
  x: number;
  y: number;
};

type PostgresExploreResizeHandle = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lockAspectRatio: boolean;
};

type PostgresExploreResizeCorner = "nw" | "ne" | "sw" | "se";

type PostgresExploreResizeDrag = {
  nodeId: string;
  corner: PostgresExploreResizeCorner;
  startClientX: number;
  startClientY: number;
  startState: PostgresCanvasNodeState;
  anchor: { x: number; y: number };
  zoom: number;
  lockAspectRatio: boolean;
};

type PostgresExploreRelationshipDraft = {
  fromId: string;
  fromEndpointKey: string;
  start: PostgresExploreRenderedPoint;
  current: PostgresExploreRenderedPoint;
  targetId: string | null;
  targetEndpointKey: string | null;
};

type PostgresRelationshipLineShape =
  | "solid"
  | "dashed"
  | "long_dashed"
  | "short_dashed"
  | "dotted"
  | "loose_dotted"
  | "dash_dot"
  | "dash_dot_dot";

function getCytoscapeLineStyle(lineShape: PostgresRelationshipLineShape): "solid" | "dashed" | "dotted" {
  if (lineShape === "solid") return "solid";
  if (lineShape === "dotted" || lineShape === "loose_dotted") return "dotted";
  return "dashed";
}

function getCytoscapeDashPattern(lineShape: PostgresRelationshipLineShape): number[] | undefined {
  if (lineShape === "long_dashed") return [14, 7];
  if (lineShape === "short_dashed") return [5, 5];
  if (lineShape === "loose_dotted") return [2, 10];
  if (lineShape === "dash_dot") return [10, 5, 2, 5];
  if (lineShape === "dash_dot_dot") return [10, 5, 2, 5, 2, 5];
  return undefined;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function clampPostgresExploreNodeSize(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function postgresExploreLayoutSignature(canvasNodes: Record<string, PostgresCanvasNodeState>): string {
  return Object.values(canvasNodes)
    .map((node) => ({
      id: node.id,
      centerX: Math.round(node.x + node.width / 2),
      centerY: Math.round(node.y + node.height / 2),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => `${node.id}:${node.centerX}:${node.centerY}`)
    .join("|");
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not prepare graph image for export."));
    image.src = dataUrl;
  });
}

async function composeGraphPngWithGridlines(dataUrl: string): Promise<Uint8Array> {
  const image = await loadImageFromDataUrl(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare graph export canvas.");

  const rootStyles = getComputedStyle(document.documentElement);
  const gridColor = rootStyles.getPropertyValue("--canvas-grid-color").trim() || "rgba(53, 80, 112, 0.12)";
  const rawDensity = rootStyles.getPropertyValue("--canvas-grid-density").trim();
  const density = Math.max(4, Number.parseFloat(rawDensity) || 22);

  context.fillStyle = rootStyles.getPropertyValue("--color-surface").trim() || "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = gridColor;
  context.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += density) {
    context.beginPath();
    context.moveTo(x + 0.5, 0);
    context.lineTo(x + 0.5, canvas.height);
    context.stroke();
  }
  for (let y = 0; y <= canvas.height; y += density) {
    context.beginPath();
    context.moveTo(0, y + 0.5);
    context.lineTo(canvas.width, y + 0.5);
    context.stroke();
  }
  context.drawImage(image, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error("Could not encode graph PNG export."));
    }, "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function fitPostgresExploreCanvas(cy: CytoscapeCore, padding = 36) {
  cy.resize();
  const elements = cy.elements();
  if (elements.length > 0) {
    cy.fit(elements, padding);
  } else {
    cy.center();
  }
}

async function computePostgresCanvasAutoLayout({
  objects,
  objectTypes,
  relationships,
  canvasNodes,
  hiddenRelationshipIds,
  getNodeRenderedDimensions,
}: {
  objects: PostgresObject[];
  objectTypes: PostgresObjectType[];
  relationships: PostgresRelationship[];
  canvasNodes: Record<string, PostgresCanvasNodeState>;
  hiddenRelationshipIds: string[];
  getNodeRenderedDimensions: (
    object: PostgresObject,
    objectTypeRecord: PostgresObjectType | null,
    nodeState: PostgresCanvasNodeState,
  ) => { width: number; height: number };
}): Promise<Record<string, PostgresCanvasNodeState>> {
  const visibleNodeIds = new Set(
    objects
      .filter((object) => canvasNodes[object.id])
      .map((object) => object.id),
  );
  if (!visibleNodeIds.size) return canvasNodes;
  const objectTypeById = new Map(objectTypes.map((objectType) => [objectType.id, objectType]));

  const layout = await postgresExploreElk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.spacing.nodeNode": "40",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
    },
    children: objects
      .filter((object) => visibleNodeIds.has(object.id))
      .map((object) => {
        const nodeState = canvasNodes[object.id];
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        const dimensions = getNodeRenderedDimensions(object, objectTypeRecord, nodeState);
        return {
          id: object.id,
          width: dimensions.width,
          height: dimensions.height,
        };
      }),
    edges: relationships
      .filter((relationship) =>
        !hiddenRelationshipIds.includes(relationship.id)
        && visibleNodeIds.has(relationship.fromObjectId)
        && visibleNodeIds.has(relationship.toObjectId),
      )
      .map((relationship) => ({
        id: relationship.id,
        sources: [relationship.fromObjectId],
        targets: [relationship.toObjectId],
      })),
  });

  const nextNodes = { ...canvasNodes };
  for (const child of layout.children ?? []) {
    if (!child.id || !nextNodes[child.id]) continue;
    nextNodes[child.id] = {
      ...nextNodes[child.id],
      x: typeof child.x === "number" ? child.x : nextNodes[child.id].x,
      y: typeof child.y === "number" ? child.y : nextNodes[child.id].y,
      width: typeof child.width === "number" ? child.width : nextNodes[child.id].width,
      height: typeof child.height === "number" ? child.height : nextNodes[child.id].height,
    };
  }

  return nextNodes;
}

export function PostgresExploreCanvasView({
  objectTypes,
  objects,
  relationships,
  relationshipTypes,
  canvasNodes,
  setCanvasNodes,
  hiddenCanvasRelationshipIds,
  getObjectAppearance,
  getObjectSurfaceStyle,
  getRelationshipAppearance,
  getRelationshipStrokeWidth,
  getNodeDefaultDimensions,
  getNodeRenderedDimensions,
  controlStart = null,
  controlLead = null,
  controlSecondary = null,
  onCanvasContextMenu,
  onCanvasSelectionDelete,
  getRelationshipEndpointKey,
  onCanvasRelationshipDraftComplete,
  getInspectorDetails,
  embedded = false,
  fitOnVisibleKey = 0,
  autoLayoutOnVisibleKey = 0,
}: {
  objectTypes: PostgresObjectType[];
  objects: PostgresObject[];
  relationships: PostgresRelationship[];
  relationshipTypes: PostgresRelationshipType[];
  canvasNodes: Record<string, PostgresCanvasNodeState>;
  setCanvasNodes: Dispatch<SetStateAction<Record<string, PostgresCanvasNodeState>>>;
  hiddenCanvasRelationshipIds: string[];
  getObjectAppearance: (
    object: PostgresObject,
    objectTypeRecord: PostgresObjectType | null,
  ) => {
    shape: "rounded" | "rectangle" | "triangle" | "diamond" | "hexagon" | "octagon" | "parallelogram" | "trapezoid" | "tag" | "star";
    color: string;
    outlineColor?: string;
    fill: "filled" | "outline";
    outlineWidth: number;
    sourceImage?: string;
    sourceImageWidth?: number;
    sourceImageHeight?: number;
    sourceSilhouettePolygon?: string;
  };
  getObjectSurfaceStyle: (
    color: string,
    fill: "filled" | "outline",
    selected?: boolean,
    outlineColor?: string,
  ) => {
    background: string;
    boxShadow: string;
    edgeColor: string;
    textColor: string;
  };
  getRelationshipAppearance: (
    relationship: PostgresRelationship,
    relationshipTypeRecord: PostgresRelationshipType | null,
  ) => {
    color: string;
    lineWeight: number;
    lineShape: PostgresRelationshipLineShape;
    arrowhead: "one_sided" | "double_sided" | "none";
  };
  getRelationshipStrokeWidth: (lineWeight: number) => number;
  getNodeDefaultDimensions: (
    object: PostgresObject,
    objectTypeRecord: PostgresObjectType | null,
  ) => { width: number; height: number };
  getNodeRenderedDimensions: (
    object: PostgresObject,
    objectTypeRecord: PostgresObjectType | null,
    nodeState: PostgresCanvasNodeState,
  ) => { width: number; height: number };
  controlStart?: ReactNode;
  controlLead?: ReactNode;
  controlSecondary?: ReactNode;
  onCanvasContextMenu?: (context: {
    kind: "background" | "node" | "edge";
    id: string | null;
    clientX: number;
    clientY: number;
    canvasPosition: { x: number; y: number } | null;
  }) => void;
  onCanvasSelectionDelete?: (context: { kind: "node" | "edge"; id: string }) => void;
  getRelationshipEndpointKey?: (context: PostgresExploreRelationshipEndpointContext) => string | null;
  onCanvasRelationshipDraftComplete?: (context: { fromEndpointKey: string; toEndpointKey: string }) => void;
  getInspectorDetails?: (selection:
    | {
        kind: "object";
        object: PostgresObject;
        objectTypeRecord: PostgresObjectType | null;
      }
    | {
        kind: "relationship";
        relationship: PostgresRelationship;
        relationshipTypeRecord: PostgresRelationshipType | null;
      }
  ) => PostgresExploreInspectorDetails;
  embedded?: boolean;
  fitOnVisibleKey?: number;
  autoLayoutOnVisibleKey?: number;
}) {
  const cyContainerRef = useRef<HTMLDivElement | null>(null);
  const zoomControlRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<CytoscapeCore | null>(null);
  const relationshipDraftRef = useRef<PostgresExploreRelationshipDraft | null>(null);
  const relationshipDraftLineRef = useRef<SVGLineElement | null>(null);
  const suppressNextBackgroundTapRef = useRef(false);
  const initialGraphFitDoneRef = useRef(false);
  const lastAutoLayoutVisibleKeyRef = useRef(0);
  const pendingViewportRestoreRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  const objectTypeById = useMemo(
    () => new Map(objectTypes.map((objectType) => [objectType.id, objectType])),
    [objectTypes],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [layoutRunning, setLayoutRunning] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [connectorHandle, setConnectorHandle] = useState<PostgresExploreConnectorHandle | null>(null);
  const [resizeHandle, setResizeHandle] = useState<PostgresExploreResizeHandle | null>(null);
  const [relationshipDraft, setRelationshipDraft] = useState<PostgresExploreRelationshipDraft | null>(null);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [defaultZoomPercent, setDefaultZoomPercent] = useState(100);
  const [autoLayoutSignature, setAutoLayoutSignature] = useState("");
  const [graphExportModalOpen, setGraphExportModalOpen] = useState(false);
  const [graphExportGridlines, setGraphExportGridlines] = useState(true);
  const [graphExportBusy, setGraphExportBusy] = useState(false);
  const [graphExportError, setGraphExportError] = useState("");
  const zoomIsCustomized = Math.abs(zoomPercent - defaultZoomPercent) >= 1;
  const currentLayoutSignature = useMemo(() => postgresExploreLayoutSignature(canvasNodes), [canvasNodes]);
  const autoLayoutIsCustomized = currentLayoutSignature.length > 0
    && (autoLayoutSignature.length === 0 || currentLayoutSignature !== autoLayoutSignature);
  const relationshipDraftActive = relationshipDraft !== null;
  const objectById = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  const latestExploreStateRef = useRef({ canvasNodes });
  const resizeDragRef = useRef<PostgresExploreResizeDrag | null>(null);
  const relationshipById = useMemo(
    () => new Map(relationships.map((relationship) => [relationship.id, relationship])),
    [relationships],
  );
  const getEndpointKeyForNodeId = useCallback((nodeId: string): string | null => {
    if (!getRelationshipEndpointKey) return null;
    const object = objectById.get(nodeId);
    if (!object) return null;
    return getRelationshipEndpointKey({
      object,
      objectTypeRecord: objectTypeById.get(object.objectTypeId) ?? null,
    });
  }, [getRelationshipEndpointKey, objectById, objectTypeById]);
  const getEndpointKeyForNodeIdRef = useRef(getEndpointKeyForNodeId);
  const onCanvasContextMenuRef = useRef(onCanvasContextMenu);
  const onCanvasRelationshipDraftCompleteRef = useRef(onCanvasRelationshipDraftComplete);

  useEffect(() => {
    getEndpointKeyForNodeIdRef.current = getEndpointKeyForNodeId;
    onCanvasContextMenuRef.current = onCanvasContextMenu;
    onCanvasRelationshipDraftCompleteRef.current = onCanvasRelationshipDraftComplete;
  }, [
    getEndpointKeyForNodeId,
    onCanvasContextMenu,
    onCanvasRelationshipDraftComplete,
  ]);

  const updateConnectorHandle = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId || selectedEdgeId || relationshipDraftRef.current) {
      setConnectorHandle((current) => (current ? null : current));
      return;
    }
    const endpointKey = getEndpointKeyForNodeId(selectedNodeId);
    if (!endpointKey) {
      setConnectorHandle((current) => (current ? null : current));
      return;
    }
    const node = cy.$id(selectedNodeId);
    if (!node.nonempty()) {
      setConnectorHandle((current) => (current ? null : current));
      return;
    }
    const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
    const nextHandle = {
      id: selectedNodeId,
      endpointKey,
      x: box.x1 + (box.x2 - box.x1) / 2,
      y: box.y2 + 8,
    };
    setConnectorHandle((current) => {
      if (
        current
        && current.id === nextHandle.id
        && current.endpointKey === nextHandle.endpointKey
        && Math.abs(current.x - nextHandle.x) < 0.5
        && Math.abs(current.y - nextHandle.y) < 0.5
      ) {
        return current;
      }
      return nextHandle;
    });
  }, [getEndpointKeyForNodeId, selectedEdgeId, selectedNodeId]);
  const updateConnectorHandleRef = useRef(updateConnectorHandle);

  const updateResizeHandle = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || !selectedNodeId || selectedEdgeId || relationshipDraftRef.current) {
      setResizeHandle((current) => (current ? null : current));
      return;
    }
    const node = cy.$id(selectedNodeId);
    if (!node.nonempty()) {
      setResizeHandle((current) => (current ? null : current));
      return;
    }
    const object = objectById.get(selectedNodeId) ?? null;
    if (!object) {
      setResizeHandle((current) => (current ? null : current));
      return;
    }
    const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
    const padding = 8;
    const nextHandle = {
      id: selectedNodeId,
      x1: box.x1 - padding,
      y1: box.y1 - padding,
      x2: box.x2 + padding,
      y2: box.y2 + padding,
      lockAspectRatio: true,
    };
    setResizeHandle((current) => {
      if (
        current
        && current.id === nextHandle.id
        && current.lockAspectRatio === nextHandle.lockAspectRatio
        && Math.abs(current.x1 - nextHandle.x1) < 0.5
        && Math.abs(current.y1 - nextHandle.y1) < 0.5
        && Math.abs(current.x2 - nextHandle.x2) < 0.5
        && Math.abs(current.y2 - nextHandle.y2) < 0.5
      ) {
        return current;
      }
      return nextHandle;
    });
  }, [getObjectAppearance, objectById, objectTypeById, selectedEdgeId, selectedNodeId]);
  const updateResizeHandleRef = useRef(updateResizeHandle);

  useEffect(() => {
    updateConnectorHandleRef.current = updateConnectorHandle;
    updateResizeHandleRef.current = updateResizeHandle;
  }, [updateConnectorHandle, updateResizeHandle]);
  const findRelationshipDraftTarget = useCallback((point: PostgresExploreRenderedPoint, fromId: string) => {
    const cy = cyRef.current;
    if (!cy) return null;
    const candidateNodes = cy.nodes(".canvas-object").filter((node: NodeSingular) => {
      if (node.id() === fromId) return false;
      const endpointKey = getEndpointKeyForNodeId(node.id());
      if (!endpointKey) return false;
      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
      return point.x >= box.x1 && point.x <= box.x2 && point.y >= box.y1 && point.y <= box.y2;
    });
    const candidateNode = candidateNodes[candidateNodes.length - 1];
    if (!candidateNode) return null;
    const endpointKey = getEndpointKeyForNodeId(candidateNode.id());
    return endpointKey ? { id: candidateNode.id(), endpointKey } : null;
  }, [getEndpointKeyForNodeId]);
  const renderedPointFromPointerEvent = useCallback((event: MouseEvent | PointerEvent | React.MouseEvent | React.PointerEvent): PostgresExploreRenderedPoint | null => {
    const surface = cyContainerRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);
  const worldPointFromPointerEvent = useCallback((event: MouseEvent | PointerEvent): PostgresExploreRenderedPoint | null => {
    const renderedPoint = renderedPointFromPointerEvent(event);
    if (!renderedPoint) return null;
    const cy = cyRef.current;
    const zoom = cy?.zoom() ?? 1;
    const pan = cy?.pan() ?? { x: 0, y: 0 };
    return {
      x: (renderedPoint.x - pan.x) / Math.max(0.01, zoom),
      y: (renderedPoint.y - pan.y) / Math.max(0.01, zoom),
    };
  }, [renderedPointFromPointerEvent]);
  const cancelRelationshipDraft = useCallback(() => {
    relationshipDraftRef.current = null;
    setRelationshipDraft(null);
    setResizeHandle(null);
  }, []);
  const handleConnectorClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (!connectorHandle || !onCanvasRelationshipDraftComplete) return;
    event.preventDefault();
    event.stopPropagation();
    const nextDraft = {
      fromId: connectorHandle.id,
      fromEndpointKey: connectorHandle.endpointKey,
      start: { x: connectorHandle.x, y: connectorHandle.y },
      current: { x: connectorHandle.x, y: connectorHandle.y },
      targetId: null,
      targetEndpointKey: null,
    };
    relationshipDraftRef.current = nextDraft;
    setRelationshipDraft(nextDraft);
    setConnectorHandle(null);
  }, [connectorHandle, onCanvasRelationshipDraftComplete]);

  const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, corner: PostgresExploreResizeCorner) => {
    if (!resizeHandle) return;
    const nodeState = latestExploreStateRef.current.canvasNodes[resizeHandle.id];
    if (!nodeState) return;
    const cy = cyRef.current;
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
    cy?.nodes().ungrabify();
    const anchor = {
      x: corner.includes("w") ? nodeState.x + nodeState.width : nodeState.x,
      y: corner.includes("n") ? nodeState.y + nodeState.height : nodeState.y,
    };
    resizeDragRef.current = {
      nodeId: resizeHandle.id,
      corner,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startState: nodeState,
      anchor,
      zoom: cy?.zoom() || 1,
      lockAspectRatio: resizeHandle.lockAspectRatio,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [resizeHandle]);
  const stopResizeHandleMouseEvent = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
  }, []);
  const graphElements = useMemo(
    () => {
      const visibleNodeIds = new Set(
        objects
          .filter((object) => canvasNodes[object.id])
          .map((object) => object.id),
      );
      const nodes = objects.reduce<ElementDefinition[]>((elements, object) => {
        const nodeState = canvasNodes[object.id];
        if (!nodeState) return elements;
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        const appearance = getObjectAppearance(object, objectTypeRecord);
        const outlineColor = appearance.outlineColor || appearance.color;
        const surface = getObjectSurfaceStyle(appearance.color, appearance.fill, false, outlineColor);
        const { width, height } = getNodeRenderedDimensions(object, objectTypeRecord, nodeState);
        const isFilled = appearance.fill === "filled";
        const sourceImage = appearance.sourceImage ?? "";
        const sourceImageWidth = Math.max(42, width * 0.98);
        const sourceImageHeight = Math.max(42, height * 0.98);

        elements.push({
          group: "nodes",
          data: {
            id: object.id,
            color: appearance.color,
            outlineColor,
            backgroundColor: appearance.color,
            backgroundOpacity: isFilled ? 1 : 0,
            borderWidth: isFilled ? 2 : 3,
            shadowColor: outlineColor,
            shadowOpacity: isFilled ? 0.18 : 0.1,
            fill: appearance.fill,
            shape: appearance.shape,
            sourceImage,
            sourceImageWidth: appearance.sourceImageWidth ?? sourceImageWidth,
            sourceImageHeight: appearance.sourceImageHeight ?? sourceImageHeight,
            sourceSilhouettePolygon: sourceImage ? (appearance.sourceSilhouettePolygon ?? POSTGRES_SOURCE_DOCUMENT_SILHOUETTE_POLYGON) : "",
            textColor: surface.textColor,
            textMaxWidth: Math.max(72, Math.floor(width * 0.72)),
            width,
            height,
            label: sourceImage ? "" : (object.title.trim() || "Untitled object"),
          },
          position: { x: nodeState.x + width / 2, y: nodeState.y + height / 2 },
          classes: `canvas-object canvas-object--${appearance.shape}${sourceImage ? " canvas-object--source-image" : ""}`,
        });
        return elements;
      }, []);

      const edges = relationships
        .filter((relationship) =>
          !hiddenCanvasRelationshipIds.includes(relationship.id)
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
              lineStyle: getCytoscapeLineStyle(appearance.lineShape),
              lineDashPattern: getCytoscapeDashPattern(appearance.lineShape),
              targetArrow: appearance.arrowhead === "none" ? "none" : "triangle",
              sourceArrow: appearance.arrowhead === "double_sided" ? "triangle" : "none",
            },
            classes: "canvas-relationship",
          } satisfies ElementDefinition;
        });

      return [...nodes, ...edges];
    },
    [canvasNodes, getNodeRenderedDimensions, getObjectAppearance, getObjectSurfaceStyle, getRelationshipAppearance, getRelationshipStrokeWidth, hiddenCanvasRelationshipIds, objectTypeById, objects, relationshipTypes, relationships],
  );
  const selectedObject = selectedNodeId ? objectById.get(selectedNodeId) ?? null : null;
  const selectedRelationship = selectedEdgeId ? relationshipById.get(selectedEdgeId) ?? null : null;
  const selectedObjectTypeRecord = selectedObject ? objectTypeById.get(selectedObject.objectTypeId) ?? null : null;
  const selectedRelationshipTypeRecord = selectedRelationship
    ? relationshipTypes.find((relationshipType) => relationshipType.id === selectedRelationship.relationshipTypeId) ?? null
    : null;
  const inspectorDetails = selectedObject
    ? getInspectorDetails?.({
        kind: "object",
        object: selectedObject,
        objectTypeRecord: selectedObjectTypeRecord,
      }) ?? {
        title: selectedObject.title.trim() || "Untitled object",
        itemType: "Object",
        typeDetail: selectedObject.objectType.trim() || selectedObjectTypeRecord?.name || "",
        attributes: selectedObject.attributeValues
          .filter((value) => value.value.trim())
          .sort((left, right) => left.sortOrder - right.sortOrder || left.attributeName.localeCompare(right.attributeName, undefined, { sensitivity: "base" }))
          .map((value) => ({ name: value.attributeName, value: value.value })),
      }
    : selectedRelationship
      ? getInspectorDetails?.({
          kind: "relationship",
          relationship: selectedRelationship,
          relationshipTypeRecord: selectedRelationshipTypeRecord,
        }) ?? {
          title: selectedRelationship.relationshipType.trim() || "Relationship",
          itemType: "Relationship",
          typeDetail: selectedRelationship.relationshipType.trim() || selectedRelationshipTypeRecord?.name || "",
          attributes: selectedRelationship.attributeValues
            .filter((value) => value.value.trim())
            .sort((left, right) => left.sortOrder - right.sortOrder || left.attributeName.localeCompare(right.attributeName, undefined, { sensitivity: "base" }))
            .map((value) => ({ name: value.attributeName, value: value.value })),
        }
      : null;

  useEffect(() => {
    latestExploreStateRef.current = { canvasNodes };
  }, [canvasNodes]);

  function buildUpdatedNodes(
    current: Record<string, PostgresCanvasNodeState>,
    node: { id: string; position: { x: number; y: number } },
  ) {
    const object = objectById.get(node.id) ?? null;
    const objectTypeRecord = object ? objectTypeById.get(object.objectTypeId) ?? null : null;
    const defaultDimensions = object
      ? getNodeDefaultDimensions(object, objectTypeRecord)
      : { width: 220, height: 110 };
    return {
      ...current,
      [node.id]: {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: current[node.id]?.width ?? defaultDimensions.width,
        height: current[node.id]?.height ?? defaultDimensions.height,
      },
    };
  }

  async function handleAutoLayout() {
    setLayoutRunning(true);
    setLayoutError("");
    try {
      const nextCanvasNodes = await computePostgresCanvasAutoLayout({
        objects,
        objectTypes,
        relationships,
        canvasNodes,
        hiddenRelationshipIds: hiddenCanvasRelationshipIds,
        getNodeRenderedDimensions,
      });
      setAutoLayoutSignature(postgresExploreLayoutSignature(nextCanvasNodes));
      setCanvasNodes(nextCanvasNodes);
    } catch (error) {
      setLayoutError(error instanceof Error ? error.message : String(error));
    } finally {
      setLayoutRunning(false);
    }
  }

  function setCanvasZoomFromPercent(percent: number) {
    const cy = cyRef.current;
    if (!cy) return;
    const clampedPercent = Math.max(10, Math.min(300, percent));
    cy.zoom({
      level: clampedPercent / 100,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
    setZoomPercent(Math.round(cy.zoom() * 100));
    updateConnectorHandleRef.current();
    updateResizeHandleRef.current();
  }

  function recordCurrentCanvasZoomAsDefault(cy: CytoscapeCore) {
    const nextZoomPercent = Math.round(cy.zoom() * 100);
    setZoomPercent(nextZoomPercent);
    setDefaultZoomPercent(nextZoomPercent);
  }

  async function handleExportGraphPng() {
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) {
      setGraphExportError("There is no graph to export.");
      return;
    }
    setGraphExportBusy(true);
    setGraphExportError("");
    try {
      const path = await save({
        defaultPath: "kanqual-graph.png",
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      if (!path) return;
      const dataUrl = cy.png({
        full: true,
        scale: 2,
        bg: graphExportGridlines ? "transparent" : "#ffffff",
      });
      const bytes = graphExportGridlines
        ? await composeGraphPngWithGridlines(dataUrl)
        : dataUrlToBytes(dataUrl);
      await writeFile(path, bytes);
      setGraphExportModalOpen(false);
    } catch (error) {
      setGraphExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphExportBusy(false);
    }
  }

  const inspectorCard = (
    <section className="home-project-card postgres-explore-inspector-card">
      {inspectorDetails ? (
        <>
          <h2>{inspectorDetails.title}</h2>
          <div className="postgres-explore-inspector-kicker">{inspectorDetails.itemType}</div>
          {inspectorDetails.typeDetail?.trim() ? (
            <div className="postgres-explore-inspector-type-detail">{inspectorDetails.typeDetail}</div>
          ) : null}
          {inspectorDetails.preview ? inspectorDetails.preview : null}
          {inspectorDetails.attributes.length > 0 ? (
            <dl className="postgres-explore-inspector-attributes">
              {inspectorDetails.attributes.map((attribute) => (
                <div key={`${attribute.name}:${attribute.value}`} className="postgres-explore-inspector-attribute">
                  <dt>{attribute.name}</dt>
                  <dd>{attribute.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      ) : (
        <p className="postgres-explore-inspector-text">
          Select an object or relationship to inspect it here.
        </p>
      )}
    </section>
  );

  useEffect(() => {
    if (!cyContainerRef.current || cyRef.current) return;

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements: [],
      style: POSTGRES_CYTOSCAPE_STYLESHEET,
      layout: { name: "preset" },
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.18,
      selectionType: "single",
      boxSelectionEnabled: false,
    });

    cyRef.current = cy;

    const handleNodeTap = (event: { target: { id: () => string }; originalEvent?: Event }) => {
      const nodeId = event.target.id();
      const draft = relationshipDraftRef.current;
      if (draft) {
        event.originalEvent?.preventDefault();
        event.originalEvent?.stopPropagation();
        const endpointKey = nodeId === draft.fromId ? null : getEndpointKeyForNodeIdRef.current(nodeId);
        cancelRelationshipDraft();
        if (endpointKey) {
          onCanvasRelationshipDraftCompleteRef.current?.({
            fromEndpointKey: draft.fromEndpointKey,
            toEndpointKey: endpointKey,
          });
        }
        return;
      }
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
    };
    const handleEdgeTap = (event: { target: { id: () => string } }) => {
      if (relationshipDraftRef.current) {
        cancelRelationshipDraft();
        return;
      }
      setSelectedEdgeId(event.target.id());
      setSelectedNodeId(null);
    };
    const handleBackgroundTap = (event: { target: unknown }) => {
      if (event.target !== cy) return;
      if (suppressNextBackgroundTapRef.current) {
        suppressNextBackgroundTapRef.current = false;
        return;
      }
      if (relationshipDraftRef.current) {
        cancelRelationshipDraft();
        return;
      }
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    };
    const openContextMenu = (
      kind: "background" | "node" | "edge",
      id: string | null,
      event: {
        originalEvent?: Event;
        renderedPosition?: { x: number; y: number };
        position?: { x: number; y: number };
      },
    ) => {
      const originalEvent = event.originalEvent as MouseEvent | undefined;
      originalEvent?.preventDefault();
      onCanvasContextMenuRef.current?.({
        kind,
        id,
        clientX: originalEvent?.clientX ?? event.renderedPosition?.x ?? 0,
        clientY: originalEvent?.clientY ?? event.renderedPosition?.y ?? 0,
        canvasPosition: event.position ?? null,
      });
    };
    const selectNodeForContextMenu = (
      node: { id: () => string; select: () => void },
      event: {
        originalEvent?: Event;
        renderedPosition?: { x: number; y: number };
        position?: { x: number; y: number };
      },
    ) => {
      const nodeId = node.id();
      cy.elements().unselect();
      node.select();
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      openContextMenu("node", nodeId, event);
    };
    const handleNodeContextMenu = (event: {
      target: { id: () => string; select: () => void };
      originalEvent?: Event;
      renderedPosition?: { x: number; y: number };
      position?: { x: number; y: number };
    }) => {
      if (relationshipDraftRef.current) {
        event.originalEvent?.preventDefault();
        event.originalEvent?.stopPropagation();
        cancelRelationshipDraft();
        return;
      }
      selectNodeForContextMenu(event.target, event);
    };
    const handleEdgeContextMenu = (event: {
      target: { id: () => string; select: () => void };
      originalEvent?: Event;
      renderedPosition?: { x: number; y: number };
      position?: { x: number; y: number };
    }) => {
      if (relationshipDraftRef.current) {
        event.originalEvent?.preventDefault();
        event.originalEvent?.stopPropagation();
        cancelRelationshipDraft();
        return;
      }
      const edgeId = event.target.id();
      cy.elements().unselect();
      event.target.select();
      setSelectedEdgeId(edgeId);
      setSelectedNodeId(null);
      openContextMenu("edge", edgeId, event);
    };
    const handleBackgroundContextMenu = (event: {
      target: unknown;
      originalEvent?: Event;
      renderedPosition?: { x: number; y: number };
      position?: { x: number; y: number };
    }) => {
      if (event.target !== cy) return;
      if (relationshipDraftRef.current) {
        event.originalEvent?.preventDefault();
        event.originalEvent?.stopPropagation();
        cancelRelationshipDraft();
        return;
      }
      if (event.renderedPosition) {
        const renderedPosition = event.renderedPosition;
        const candidateNodes = cy.nodes(".canvas-object").filter((node) => {
          const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
          return (
            renderedPosition.x >= box.x1
            && renderedPosition.x <= box.x2
            && renderedPosition.y >= box.y1
            && renderedPosition.y <= box.y2
          );
        });
        const candidateNode = candidateNodes[candidateNodes.length - 1];
        if (candidateNode) {
          selectNodeForContextMenu(candidateNode, event);
          return;
        }
      }
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      openContextMenu("background", null, event);
    };
    const handleNodeDragFree = (event: { target: { id: () => string; position: () => { x: number; y: number } } }) => {
      const nodeId = event.target.id();
      const position = event.target.position();
      const nodeState = latestExploreStateRef.current.canvasNodes[nodeId];
      if (!nodeState) return;
      pendingViewportRestoreRef.current = {
        zoom: cy.zoom(),
        pan: { ...cy.pan() },
      };
      setCanvasNodes((current) => buildUpdatedNodes(current, {
        id: nodeId,
        position: {
          x: position.x - nodeState.width / 2,
          y: position.y - nodeState.height / 2,
        },
      }));
    };

    cy.on("tap", "node", handleNodeTap);
    cy.on("tap", "edge", handleEdgeTap);
    cy.on("tap", handleBackgroundTap);
    cy.on("cxttap", "node", handleNodeContextMenu);
    cy.on("cxttap", "edge", handleEdgeContextMenu);
    cy.on("cxttap", handleBackgroundContextMenu);
    cy.on("dragfree", "node", handleNodeDragFree);
    const handleCanvasViewportChange = () => {
      updateConnectorHandleRef.current();
      updateResizeHandleRef.current();
      const nextZoomPercent = Math.round(cy.zoom() * 100);
      setZoomPercent((current) => current === nextZoomPercent ? current : nextZoomPercent);
    };

    cy.on("render pan zoom drag", handleCanvasViewportChange);

    return () => {
      cy.removeListener("tap", "node", handleNodeTap);
      cy.removeListener("tap", "edge", handleEdgeTap);
      cy.removeListener("tap", handleBackgroundTap);
      cy.removeListener("cxttap", "node", handleNodeContextMenu);
      cy.removeListener("cxttap", "edge", handleEdgeContextMenu);
      cy.removeListener("cxttap", handleBackgroundContextMenu);
      cy.removeListener("dragfree", "node", handleNodeDragFree);
      cy.removeListener("render pan zoom drag", handleCanvasViewportChange);
      cy.destroy();
      cyRef.current = null;
    };
  }, [cancelRelationshipDraft, setCanvasNodes, worldPointFromPointerEvent]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const pendingViewportRestore = pendingViewportRestoreRef.current;
    pendingViewportRestoreRef.current = null;
    const previousZoom = pendingViewportRestore?.zoom ?? cy.zoom();
    const previousPan = pendingViewportRestore?.pan ?? cy.pan();
    const shouldFitInitialGraph = !initialGraphFitDoneRef.current && graphElements.length > 0;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(graphElements);
    });
    if (shouldFitInitialGraph) {
      initialGraphFitDoneRef.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitPostgresExploreCanvas(cy, 36);
          recordCurrentCanvasZoomAsDefault(cy);
          updateConnectorHandleRef.current();
          updateResizeHandleRef.current();
        });
      });
      return;
    }
    cy.zoom(previousZoom);
    cy.pan(previousPan);
    requestAnimationFrame(() => {
      cy.resize();
      updateConnectorHandleRef.current();
      updateResizeHandleRef.current();
    });
  }, [graphElements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !embedded) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cy.resize();
        updateConnectorHandleRef.current();
        updateResizeHandleRef.current();
      });
    });
  }, [embedded]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !embedded || fitOnVisibleKey <= 0) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitPostgresExploreCanvas(cy, 36);
        recordCurrentCanvasZoomAsDefault(cy);
        updateConnectorHandleRef.current();
        updateResizeHandleRef.current();
      });
    });
  }, [embedded, fitOnVisibleKey]);

  useEffect(() => {
    if (!embedded || autoLayoutOnVisibleKey <= 0 || graphElements.length === 0) return;
    if (lastAutoLayoutVisibleKeyRef.current === autoLayoutOnVisibleKey) return;
    lastAutoLayoutVisibleKeyRef.current = autoLayoutOnVisibleKey;
    void handleAutoLayout().then(() => {
      const cy = cyRef.current;
      if (!cy) return;
      requestAnimationFrame(() => {
        fitPostgresExploreCanvas(cy, 36);
        recordCurrentCanvasZoomAsDefault(cy);
        updateConnectorHandleRef.current();
        updateResizeHandleRef.current();
      });
    });
  }, [autoLayoutOnVisibleKey, embedded, graphElements.length]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().unselect();
      if (selectedNodeId) cy.$id(selectedNodeId).select();
      if (selectedEdgeId) cy.$id(selectedEdgeId).select();
    });
    updateConnectorHandle();
    updateResizeHandle();
  }, [selectedEdgeId, selectedNodeId, updateConnectorHandle, updateResizeHandle]);

  useEffect(() => {
    updateConnectorHandle();
    updateResizeHandle();
  }, [graphElements, updateConnectorHandle, updateResizeHandle]);

  useEffect(() => {
    if (!relationshipDraftActive) {
      updateConnectorHandle();
      updateResizeHandle();
    } else {
      setResizeHandle(null);
    }
  }, [relationshipDraftActive, updateConnectorHandle, updateResizeHandle]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes(".canvas-object").removeClass("relationship-draft-target");
    if (relationshipDraft?.targetId) {
      cy.$id(relationshipDraft.targetId).addClass("relationship-draft-target");
    }
    return () => {
      cy.nodes(".canvas-object").removeClass("relationship-draft-target");
    };
  }, [relationshipDraft?.targetId]);

  useEffect(() => {
    if (!relationshipDraftActive) return;

    function handlePointerMove(event: PointerEvent) {
      const point = renderedPointFromPointerEvent(event);
      if (!point) return;
      const current = relationshipDraftRef.current;
      if (!current) return;
      relationshipDraftLineRef.current?.setAttribute("x2", String(point.x));
      relationshipDraftLineRef.current?.setAttribute("y2", String(point.y));
      const target = findRelationshipDraftTarget(point, current.fromId);
      const nextDraft = {
        ...current,
        current: point,
        targetId: target?.id ?? null,
        targetEndpointKey: target?.endpointKey ?? null,
      };
      relationshipDraftRef.current = nextDraft;
      if (current.targetId !== nextDraft.targetId || current.targetEndpointKey !== nextDraft.targetEndpointKey) {
        setRelationshipDraft(nextDraft);
      }
    }

    function handleCanvasClick(event: MouseEvent) {
      const point = renderedPointFromPointerEvent(event);
      const current = relationshipDraftRef.current;
      if (!current) return;
      const target = point ? findRelationshipDraftTarget(point, current.fromId) : null;
      if (target) {
        onCanvasRelationshipDraftComplete?.({
          fromEndpointKey: current.fromEndpointKey,
          toEndpointKey: target.endpointKey,
        });
      }
      cancelRelationshipDraft();
    }

    function handleContextMenu(event: MouseEvent) {
      if (!relationshipDraftRef.current) return;
      event.preventDefault();
      cancelRelationshipDraft();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("click", handleCanvasClick);
    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("click", handleCanvasClick);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [cancelRelationshipDraft, findRelationshipDraftTarget, onCanvasRelationshipDraftComplete, relationshipDraftActive, renderedPointFromPointerEvent]);

  useEffect(() => {
    if (!zoomMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (zoomControlRef.current?.contains(target)) return;
      setZoomMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setZoomMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [zoomMenuOpen]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const drag = resizeDragRef.current;
      if (!drag) return;
      event.preventDefault();
      const renderedDeltaX = event.clientX - drag.startClientX;
      const renderedDeltaY = event.clientY - drag.startClientY;
      const modelDeltaX = renderedDeltaX / Math.max(0.01, drag.zoom);
      const modelDeltaY = renderedDeltaY / Math.max(0.01, drag.zoom);
      const xDirection = drag.corner.includes("e") ? 1 : -1;
      const yDirection = drag.corner.includes("s") ? 1 : -1;
      const minWidth = 48;
      const minHeight = 36;
      const maxWidth = 520;
      const maxHeight = 420;
      let width = clampPostgresExploreNodeSize(drag.startState.width + modelDeltaX * xDirection, minWidth, maxWidth);
      let height = clampPostgresExploreNodeSize(drag.startState.height + modelDeltaY * yDirection, minHeight, maxHeight);

      if (drag.lockAspectRatio) {
        const startWidth = Math.max(1, drag.startState.width);
        const startHeight = Math.max(1, drag.startState.height);
        const aspectRatio = startWidth / startHeight;
        const widthScale = width / startWidth;
        const heightScale = height / startHeight;
        const scale = Math.max(widthScale, heightScale);
        width = clampPostgresExploreNodeSize(startWidth * scale, minWidth, maxWidth);
        height = clampPostgresExploreNodeSize(width / aspectRatio, minHeight, maxHeight);
        width = clampPostgresExploreNodeSize(height * aspectRatio, minWidth, maxWidth);
      }

      pendingViewportRestoreRef.current = {
        zoom: cyRef.current?.zoom() ?? drag.zoom,
        pan: cyRef.current?.pan() ?? { x: 0, y: 0 },
      };
      setCanvasNodes((current) => {
        const currentNode = current[drag.nodeId];
        if (!currentNode) return current;
        return {
          ...current,
          [drag.nodeId]: {
            ...currentNode,
            x: drag.corner.includes("w") ? drag.anchor.x - width : drag.anchor.x,
            y: drag.corner.includes("n") ? drag.anchor.y - height : drag.anchor.y,
            width,
            height,
          },
        };
      });
    }

    function handlePointerUp() {
      resizeDragRef.current = null;
      cyRef.current?.nodes().grabify();
      updateConnectorHandleRef.current();
      updateResizeHandleRef.current();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      resizeDragRef.current = null;
      cyRef.current?.nodes().grabify();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [setCanvasNodes]);

  useEffect(() => {
    function handleCanvasKeyboard(event: KeyboardEvent) {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.key === "Escape") {
        if (relationshipDraftActive) {
          event.preventDefault();
          cancelRelationshipDraft();
          return;
        }
        if (!selectedNodeId && !selectedEdgeId) return;
        event.preventDefault();
        cyRef.current?.elements().unselect();
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!onCanvasSelectionDelete) return;
      const selectedContext = selectedNodeId
        ? { kind: "node" as const, id: selectedNodeId }
        : selectedEdgeId
          ? { kind: "edge" as const, id: selectedEdgeId }
          : null;
      if (!selectedContext) return;
      event.preventDefault();
      onCanvasSelectionDelete(selectedContext);
    }

    window.addEventListener("keydown", handleCanvasKeyboard);
    return () => window.removeEventListener("keydown", handleCanvasKeyboard);
  }, [
    cancelRelationshipDraft,
    onCanvasSelectionDelete,
    relationshipDraftActive,
    selectedEdgeId,
    selectedNodeId,
  ]);

  return (
    <div className={`view users-view postgres-explore-canvas-view${embedded ? " postgres-explore-canvas-view--embedded" : ""}`}>
      {!embedded ? (
        <header className="view-header">
          <div>
            <div className="users-title-wrap">
              <h1>Explore</h1>
              <button
                type="button"
                className="users-help-icon-btn"
                onClick={() => setHelpOpen(true)}
                title="Open explore help"
                aria-label="Open explore help"
              >
                <HelpIcon className="users-help-icon" />
              </button>
            </div>
            <p className="auth-hint" style={{ margin: "6px 0 0" }}>
              Browse project objects as a navigable relationship graph and re-run auto layout when the structure changes.
            </p>
          </div>
        </header>
      ) : null}

      {helpOpen ? (
        <SettingsModal title="Explore Help" onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              Use Explore to browse project objects and relationships as an interactive graph, inspect selected items, and re-run layout when the structure changes.
            </p>
            <p className="users-guide-copy">
              Layout changes help navigation in this view; they do not change object or relationship records unless you use editing actions made available by your role.
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              Close
            </button>
          </div>
        </SettingsModal>
      ) : null}

      {layoutError ? <p className="users-error">{layoutError}</p> : null}

      <div
        className={`postgres-explore-canvas-layout${embedded ? " postgres-explore-canvas-layout--embedded" : ""}`}
      >
        <section
          className="postgres-explore-canvas-stage"
        >
          <div
            ref={cyContainerRef}
            className="postgres-explore-canvas-surface"
          />
          {relationshipDraft ? (
            <svg className="postgres-explore-relationship-draft-layer" aria-hidden="true">
              <line
                ref={relationshipDraftLineRef}
                x1={relationshipDraft.start.x}
                y1={relationshipDraft.start.y}
                x2={relationshipDraft.current.x}
                y2={relationshipDraft.current.y}
                className={`postgres-explore-relationship-draft-line${relationshipDraft.targetId ? " postgres-explore-relationship-draft-line--targeted" : ""}`}
              />
            </svg>
          ) : null}
          {connectorHandle && onCanvasRelationshipDraftComplete ? (
            <button
              type="button"
              className="postgres-explore-connector-handle"
              style={{ left: connectorHandle.x, top: connectorHandle.y }}
              onClick={handleConnectorClick}
              aria-label="Create relationship from selected item"
              title="Create relationship"
            >
              <PlusIcon className="postgres-explore-connector-handle-icon" />
            </button>
          ) : null}
          {resizeHandle ? (
            <div
              className="postgres-explore-resize-box"
              style={{
                left: resizeHandle.x1,
                top: resizeHandle.y1,
                width: resizeHandle.x2 - resizeHandle.x1,
                height: resizeHandle.y2 - resizeHandle.y1,
              }}
            >
              {([
                ["nw", "top left"],
                ["ne", "top right"],
                ["sw", "bottom left"],
                ["se", "bottom right"],
              ] as Array<[PostgresExploreResizeCorner, string]>).map(([corner, label]) => (
                <button
                  key={corner}
                  type="button"
                  className={`postgres-explore-resize-point postgres-explore-resize-point--${corner}`}
                  onPointerDown={(event) => handleResizePointerDown(event, corner)}
                  onMouseDown={stopResizeHandleMouseEvent}
                  onClick={stopResizeHandleMouseEvent}
                  aria-label={`Resize selected item from ${label}`}
                  title="Resize"
                />
              ))}
            </div>
          ) : null}
          {embedded && (selectedObject || selectedRelationship) ? (
            <div className="postgres-explore-inspector-overlay">
              {inspectorCard}
            </div>
          ) : null}
          <div
            className={`postgres-explore-canvas-controls${controlSecondary ? " postgres-explore-canvas-controls--stacked" : ""}`}
            aria-label="Canvas controls"
          >
            {controlLead}
            <div className="postgres-explore-canvas-controls-stack">
              <div className="postgres-explore-canvas-controls-row">
                {controlStart}
                <div className="postgres-explore-zoom-control" ref={zoomControlRef}>
                  <button
                    type="button"
                    className={`btn ${zoomIsCustomized ? "btn--primary" : "btn--ghost"}`}
                    onClick={() => setZoomMenuOpen((current) => !current)}
                    aria-expanded={zoomMenuOpen}
                    aria-label={zoomMenuOpen ? "Hide zoom control" : "Show zoom control"}
                    title="Zoom"
                  >
                    <ZoomIcon className="postgres-explore-canvas-control-icon" />
                  </button>
                  {zoomMenuOpen ? (
                    <div className="postgres-explore-zoom-menu">
                      <label className="postgres-explore-zoom-slider-label" htmlFor="postgres-explore-zoom-slider">
                        <span>Zoom</span>
                        <strong>{zoomPercent}%</strong>
                      </label>
                      <input
                        id="postgres-explore-zoom-slider"
                        className="postgres-explore-zoom-slider"
                        type="range"
                        min={10}
                        max={300}
                        step={5}
                        value={zoomPercent}
                        onChange={(event) => setCanvasZoomFromPercent(Number(event.target.value))}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost postgres-explore-zoom-fit-btn"
                        onClick={() => {
                          const cy = cyRef.current;
                          if (!cy) return;
                          fitPostgresExploreCanvas(cy, 36);
                          recordCurrentCanvasZoomAsDefault(cy);
                          updateConnectorHandleRef.current();
                          updateResizeHandleRef.current();
                        }}
                        aria-label="Fit canvas"
                        title="Fit canvas"
                      >
                        <FitCornersIcon className="postgres-explore-canvas-control-icon" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={`btn ${autoLayoutIsCustomized ? "btn--primary" : "btn--ghost"}`}
                  onClick={() => void handleAutoLayout()}
                  disabled={layoutRunning || Object.keys(canvasNodes).length === 0}
                  aria-label={layoutRunning ? "Auto layout running" : "Auto layout"}
                  title={layoutRunning ? "Auto layout running" : "Auto layout"}
                >
                  <LayoutNetworkIcon className="postgres-explore-canvas-control-icon" />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setGraphExportError("");
                    setGraphExportModalOpen(true);
                  }}
                  disabled={Object.keys(canvasNodes).length === 0}
                  aria-label="Export graph"
                  title="Export graph"
                >
                  <DownloadIcon className="postgres-explore-canvas-control-icon" />
                </button>
              </div>
              {controlSecondary ? (
                <div className="postgres-explore-canvas-controls-row postgres-explore-canvas-controls-row--secondary">
                  {controlSecondary}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {!embedded ? (
          <aside className="postgres-explore-inspector-sidebar">
            {inspectorCard}
          </aside>
        ) : null}
      </div>
      {graphExportModalOpen ? (
        <SettingsModal
          title="Export Graph"
          onClose={() => setGraphExportModalOpen(false)}
          closeDisabled={graphExportBusy}
          modalClassName="postgres-explore-export-modal"
        >
          <div className="app-settings-modal-body">
            <div className="app-settings-modal-sections">
              <section className="app-settings-modal-section">
                <div className="app-settings-modal-section-body">
                  <div className="settings-row">
                    <div>
                      <div className="settings-row-title">Gridlines</div>
                    </div>
                    <div className="segmented-control" role="tablist" aria-label="Export gridlines">
                      {[
                        { label: "Enabled", value: true },
                        { label: "Disabled", value: false },
                      ].map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          role="tab"
                          aria-selected={graphExportGridlines === option.value}
                          className={graphExportGridlines === option.value ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          onClick={() => setGraphExportGridlines(option.value)}
                          disabled={graphExportBusy}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {graphExportError ? <div className="form-error">{graphExportError}</div> : null}
                </div>
              </section>
            </div>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleExportGraphPng()}
              disabled={graphExportBusy || Object.keys(canvasNodes).length === 0}
            >
              {graphExportBusy ? "Exporting..." : "Export PNG"}
            </button>
          </div>
        </SettingsModal>
      ) : null}
    </div>
  );
}
