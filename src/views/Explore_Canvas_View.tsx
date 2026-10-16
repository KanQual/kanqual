import { CanvasGraphSettings } from "../components/CanvasGraphSettings";
import { CanvasPinBadges } from "../components/CanvasPinBadges";
import { canvasLayoutGroups, DEFAULT_CANVAS_LAYOUT_SETTINGS } from "../lib/canvasLayoutSettings";
import { canvasHasVisiblePins, canvasZoomPercent, observeCanvasZoomBounds, updateCanvasZoomBounds } from "../lib/canvasZoom";
import { usePostgresStoredImageUrlMap } from "../lib/postgresStoredImages";
import { openOriginalImage } from "../lib/imagePreviews";
import { releaseMediaUrl } from "../lib/mediaStream";
import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import cytoscape, { type Core as CytoscapeCore, type ElementDefinition, type NodeSingular } from "cytoscape";
import {
  POSTGRES_SOURCE_DOCUMENT_SILHOUETTE_POLYGON,
  POSTGRES_CYTOSCAPE_STYLESHEET,
  getCanvasLabelFontSize,
  getPostgresCanvasTextMaxWidth,
} from "../lib/postgresCanvasGraph";
import { DownloadIcon, FitCornersIcon, HelpIcon, LayoutNetworkIcon, PinIcon, PlusIcon, ZoomIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import { HelpModal } from "../components/HelpModal";
import { useI18n } from "../i18n/provider";
import type {
  PostgresCanvasNodeState,
  PostgresObject,
  PostgresObjectType,
  PostgresRelationship,
  PostgresRelationshipType,
} from "../lib/postgres";


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

function loadImageFromDataUrl(dataUrl: string, errorMessage: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(errorMessage));
    image.src = dataUrl;
  });
}

async function composeGraphPngWithGridlines(dataUrl: string, errors: {
  prepareImage: string;
  prepareCanvas: string;
  encodePng: string;
}): Promise<Uint8Array> {
  const image = await loadImageFromDataUrl(dataUrl, errors.prepareImage);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(errors.prepareCanvas);

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
      else reject(new Error(errors.encodePng));
    }, "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function fitExploreCanvas(cy: CytoscapeCore, padding = 36) {
  cy.resize();
  updateCanvasZoomBounds(cy, padding);
  const elements = cy.elements(":visible");
  if (elements.length > 0) {
    cy.fit(elements, padding);
  } else {
    cy.center();
  }
}

export function ExploreCanvasView({
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
  itemSizeControls = null,
  customItemSizes = false,
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
  autoLayoutOnInitialLoad = true,
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
    sourceImagePath?: string;
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
  itemSizeControls?: ReactNode;
  customItemSizes?: boolean;
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
  autoLayoutOnInitialLoad?: boolean;
}) {
  const { t } = useI18n();
  const cyContainerRef = useRef<HTMLDivElement | null>(null);
  const [badgeGraph, setBadgeGraph] = useState<CytoscapeCore | null>(null);
  const cyRef = useRef<CytoscapeCore | null>(null);
  const relationshipDraftRef = useRef<PostgresExploreRelationshipDraft | null>(null);
  const relationshipDraftLineRef = useRef<SVGLineElement | null>(null);
  const suppressNextBackgroundTapRef = useRef(false);
  const initialGraphFitDoneRef = useRef(false);
  const initialAutoLayoutDoneRef = useRef(false);
  const lastAutoLayoutVisibleKeyRef = useRef(0);
  const pendingViewportRestoreRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  const objectTypeById = useMemo(
    () => new Map(objectTypes.map((objectType) => [objectType.id, objectType])),
    [objectTypes],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [networkSettings, setNetworkSettings] = useState(DEFAULT_CANVAS_LAYOUT_SETTINGS);
  const groupingItems = useMemo(() => objects.map(object => {
    const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
    const details = getInspectorDetails?.({ kind: "object", object, objectTypeRecord });
    return {
      id: object.id,
      kind: details?.itemType ?? t("projectCore.entities.object"),
      type: details?.typeDetail ?? object.objectType ?? objectTypeRecord?.name ?? "",
      attributes: details?.attributes ?? (object.attributeValues ?? []).map(value => ({ name: value.attributeName, value: value.value })),
    };
  }), [objects, objectTypeById, getInspectorDetails, t]);
  const groupingAttributes = useMemo(() => [...new Set(groupingItems.flatMap(item => item.attributes.map(attribute => attribute.name)))].sort(), [groupingItems]);
  const [layoutRunning, setLayoutRunning] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [connectorHandle, setConnectorHandle] = useState<PostgresExploreConnectorHandle | null>(null);
  const [resizeHandle, setResizeHandle] = useState<PostgresExploreResizeHandle | null>(null);
  const [relationshipDraft, setRelationshipDraft] = useState<PostgresExploreRelationshipDraft | null>(null);
  const zoomControlRef = useRef<HTMLDivElement | null>(null);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [minimumZoomPercent, setMinimumZoomPercent] = useState(10);
  const [autoLayoutSignature, setAutoLayoutSignature] = useState("");
  const [graphExportModalOpen, setGraphExportModalOpen] = useState(false);
  const [graphExportGridlines, setGraphExportGridlines] = useState(true);
  const [graphExportBusy, setGraphExportBusy] = useState(false);
  const [graphExportError, setGraphExportError] = useState("");
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
    const horizontalPadding = 8;
    const topPadding = 14;
    const bottomPadding = 24;
    const nextHandle = {
      id: selectedNodeId,
      x1: box.x1 - horizontalPadding,
      y1: box.y1 - topPadding,
      x2: box.x2 + horizontalPadding,
      y2: box.y2 + bottomPadding,
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
  const [imagePreviewSize, setImagePreviewSize] = useState<number | null>(128);
  const [visibleImageNodeIds, setVisibleImageNodeIds] = useState<string[]>([]);
  const visibleImagePaths = useMemo(() => visibleImageNodeIds.flatMap((id) => {
    const object = objectById.get(id);
    if (!object) return [];
    const path = getObjectAppearance(object, objectTypeById.get(object.objectTypeId) ?? null).sourceImagePath;
    return path ? [path] : [];
  }), [visibleImageNodeIds, objectById, objectTypeById, getObjectAppearance]);
  const previewUrls = usePostgresStoredImageUrlMap("", visibleImagePaths, imagePreviewSize);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (graphExportBusy) return;
    // Cytoscape caches decoded images by URL without an eviction policy. Remove
    // revoked preview entries as nodes leave the viewport, retaining built-in SVGs.
    const renderer = (cy as unknown as { renderer: () => unknown }).renderer() as unknown as { imageCache?: Record<string, { image: HTMLImageElement }> };
    const keep = new Set(previewUrls.values());
    for (const [url, entry] of Object.entries(renderer.imageCache ?? {})) {
      if (url.startsWith("http://127.0.0.1:") && !keep.has(url)) {
        entry.image.src = "";
        delete renderer.imageCache![url];
      }
    }
  }, [previewUrls, graphExportBusy]);
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
        const sourceImage = (appearance.sourceImagePath ? previewUrls.get(appearance.sourceImagePath) : "") || appearance.sourceImage || "";
        const sourceImageWidth = Math.max(42, width * 0.98);
        const sourceImageHeight = Math.max(42, height * 0.98);

        elements.push({
          group: "nodes",
          data: {
            id: object.id,
            pinned: Boolean(nodeState.pinned),
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
            imagePath: appearance.sourceImagePath ?? "",
            sourceImageWidth: appearance.sourceImageWidth ?? sourceImageWidth,
            sourceImageHeight: appearance.sourceImageHeight ?? sourceImageHeight,
            sourceSilhouettePolygon: sourceImage ? (appearance.sourceSilhouettePolygon ?? POSTGRES_SOURCE_DOCUMENT_SILHOUETTE_POLYGON) : "",
            textColor: surface.textColor,
            textMaxWidth: Math.max(1, getPostgresCanvasTextMaxWidth(appearance.shape, width)),
            fontSize: getCanvasLabelFontSize({ width, height }, getNodeDefaultDimensions(object, objectTypeRecord)),
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
    [previewUrls, canvasNodes, getNodeDefaultDimensions, getNodeRenderedDimensions, getObjectAppearance, getObjectSurfaceStyle, getRelationshipAppearance, getRelationshipStrokeWidth, hiddenCanvasRelationshipIds, objectTypeById, objects, relationshipTypes, relationships],
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
        title: selectedObject.title.trim() || t("projectCore.graph.untitledObject"),
        itemType: t("projectCore.entities.object"),
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
          title: selectedRelationship.relationshipType.trim() || t("projectCore.graph.relationship"),
          itemType: t("projectCore.entities.relationship"),
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
        ...current[node.id],
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: current[node.id]?.width ?? defaultDimensions.width,
        height: current[node.id]?.height ?? defaultDimensions.height,
      },
    };
  }

  async function handleAutoLayout(fitAfterLayout = false) {
    if (layoutRunning || !cyRef.current) return;
    setLayoutRunning(true);
    setLayoutError("");
    try {
      const { computeCanvasNetworkLayout } = await import("../lib/canvasNetworkLayout");
      const cy = cyRef.current;
      if (!cy || cy.destroyed()) return;
      const nextCanvasNodes = computeCanvasNetworkLayout(cy, canvasNodes, networkSettings, canvasLayoutGroups(groupingItems, networkSettings.groupBy));
      setAutoLayoutSignature(postgresExploreLayoutSignature(nextCanvasNodes));
      setCanvasNodes(nextCanvasNodes);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const cy = cyRef.current;
        if (!cy || cy.destroyed()) return;
        if (fitAfterLayout || !canvasHasVisiblePins(cy)) {
          fitExploreCanvas(cy, 36);
          recordCurrentCanvasZoom(cy);
        }
        updateConnectorHandleRef.current();
        updateResizeHandleRef.current();
      }));
    } catch (error) {
      setLayoutError(error instanceof Error ? error.message : String(error));
    } finally {
      setLayoutRunning(false);
    }
  }

  useEffect(() => {
    if (!zoomMenuOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !zoomControlRef.current?.contains(event.target)) setZoomMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [zoomMenuOpen]);

  function setCanvasZoomFromPercent(percent: number) {
    const cy = cyRef.current;
    if (!cy) return;
    const clampedPercent = Math.max(cy.minZoom() * 100, Math.min(cy.maxZoom() * 100, percent));
    cy.zoom({
      level: clampedPercent / 100,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
    setZoomPercent(canvasZoomPercent(cy.zoom()));
    updateConnectorHandleRef.current();
    updateResizeHandleRef.current();
  }

  function recordCurrentCanvasZoom(cy: CytoscapeCore) {
    const nextZoomPercent = canvasZoomPercent(cy.zoom());
    setZoomPercent(nextZoomPercent);
  }

  async function handleExportGraphPng() {
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) {
      setGraphExportError(t("projectCore.graph.noGraphToExport"));
      return;
    }
    setGraphExportBusy(true);
    setGraphExportError("");
    const restored: Array<{ node: cytoscape.NodeSingular; image: string; label: string; classes: string[]; url: string }> = [];
    try {
      const path = await save({
        defaultPath: "kanqual-graph.png",
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      if (!path) return;
      for (const node of cy.nodes()) {
        const object = objectById.get(node.id());
        if (!object) continue;
        const original = getObjectAppearance(object, objectTypeById.get(object.objectTypeId) ?? null).sourceImagePath;
        if (!original) continue;
        const url = await openOriginalImage(original);
        restored.push({ node, image: node.data("sourceImage"), label: node.data("label"), classes: node.classes(), url });
        node.data({ sourceImage: url, label: "" }); node.addClass("canvas-object--source-image");
        // Wait for Cytoscape's own image cache as well as the browser decoder.
        await new Promise<void>((resolve, reject) => {
          const renderer = (cy as unknown as { renderer: () => unknown }).renderer() as unknown as { getCachedImage: (url: string, origin: string, onLoad: () => void) => HTMLImageElement };
          const image = renderer.getCachedImage(url, "anonymous", resolve);
          if (image.complete && image.naturalWidth) resolve();
          else image.addEventListener("error", () => reject(new Error("Could not render export image")), { once: true });
        });
      }
      const dataUrl = cy.png({
        full: true,
        scale: 2,
        bg: graphExportGridlines ? "transparent" : "#ffffff",
      });
      const bytes = graphExportGridlines
        ? await composeGraphPngWithGridlines(dataUrl, {
            prepareImage: t("projectCore.graph.prepareExportImageFailed"),
            prepareCanvas: t("projectCore.graph.prepareExportCanvasFailed"),
            encodePng: t("projectCore.graph.encodeExportPngFailed"),
          })
        : dataUrlToBytes(dataUrl);
      await writeFile(path, bytes);
      setGraphExportModalOpen(false);
    } catch (error) {
      setGraphExportError(error instanceof Error ? error.message : String(error));
    } finally {
      const renderer = (cy as unknown as { renderer: () => unknown }).renderer() as unknown as { imageCache?: Record<string, { image: HTMLImageElement }> };
      for (const entry of restored) {
        entry.node.data({ sourceImage: entry.image, label: entry.label }); entry.node.classes(entry.classes);
        const cached = renderer.imageCache?.[entry.url];
        if (cached) { cached.image.src = ""; delete renderer.imageCache![entry.url]; }
        releaseMediaUrl(entry.url);
      }
      setGraphExportBusy(false);
    }
  }

  const pinTargetIds = selectedObject ? [selectedObject.id]
    : selectedRelationship ? [...new Set([selectedRelationship.fromObjectId, selectedRelationship.toObjectId])] : [];
  const selectionPinned = pinTargetIds.length > 0 && pinTargetIds.every(id => canvasNodes[id]?.pinned);
  const pinLabel = selectedRelationship
    ? t(selectionPinned ? "projectCore.graph.unpinRelationship" : "projectCore.graph.pinRelationship")
    : t(selectionPinned ? "projectCore.graph.unpinNode" : "projectCore.graph.pinNode");
  function toggleSelectionPin() {
    setCanvasNodes(current => {
      const next = { ...current };
      for (const id of pinTargetIds) {
        if (next[id]) next[id] = { ...next[id], pinned: !selectionPinned };
      }
      return next;
    });
  }

  const inspectorCard = (
    <section className="content-card graph-canvas-inspector-card">
      {inspectorDetails ? (
        <>
          <div className="graph-canvas-inspector-heading">
            <h2>{inspectorDetails.title}</h2>
            <button type="button" className={`btn graph-canvas-pin-button ${selectionPinned ? "btn--primary" : "btn--ghost"}`}
              onClick={toggleSelectionPin} disabled={layoutRunning || !pinTargetIds.length}
              aria-pressed={selectionPinned} aria-label={pinLabel} title={pinLabel}>
              <PinIcon />
            </button>
          </div>
          <div className="graph-canvas-inspector-kicker">{inspectorDetails.itemType}</div>
          {inspectorDetails.typeDetail?.trim() ? (
            <div className="graph-canvas-inspector-type-detail">{inspectorDetails.typeDetail}</div>
          ) : null}
          {inspectorDetails.preview ? inspectorDetails.preview : null}
          {inspectorDetails.attributes.length > 0 ? (
            <dl className="graph-canvas-inspector-attributes">
              {inspectorDetails.attributes.map((attribute) => (
                <div key={`${attribute.name}:${attribute.value}`} className="graph-canvas-inspector-attribute">
                  <dt>{attribute.name}</dt>
                  <dd>{attribute.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      ) : (
        <p className="graph-canvas-inspector-text">
          {t("projectCore.graph.selectItemToInspect")}
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
    setBadgeGraph(cy);
    const stopObservingZoomBounds = observeCanvasZoomBounds(cy, () => {
      setMinimumZoomPercent(cy.minZoom() * 100);
      setZoomPercent(canvasZoomPercent(cy.zoom()));
    });

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
      const extent = cy.extent();
      const ids = cy.nodes().filter((node) => {
        const bounds = node.boundingBox();
        return bounds.x2 >= extent.x1 && bounds.x1 <= extent.x2 && bounds.y2 >= extent.y1 && bounds.y1 <= extent.y2;
      }).sort((a, b) => {
        const center = { x: (extent.x1 + extent.x2) / 2, y: (extent.y1 + extent.y2) / 2 };
        return Math.hypot((a as cytoscape.NodeSingular).position('x') - center.x, (a as cytoscape.NodeSingular).position('y') - center.y) - Math.hypot((b as cytoscape.NodeSingular).position('x') - center.x, (b as cytoscape.NodeSingular).position('y') - center.y);
      }).slice(0, 48).map((node) => node.id()).sort();
      const largest = Math.max(0, ...ids.map((id) => {
        const node = cy.getElementById(id);
        return node.data("imagePath") ? Math.max(node.renderedWidth(), node.renderedHeight()) * window.devicePixelRatio : 0;
      }));
      setImagePreviewSize(largest <= 128 ? 128 : largest <= 384 ? 384 : largest <= 1024 ? 1024 : null);
      setVisibleImageNodeIds((current) => JSON.stringify(current) === JSON.stringify(ids) ? current : ids);
      updateConnectorHandleRef.current();
      updateResizeHandleRef.current();
      const nextZoomPercent = canvasZoomPercent(cy.zoom());
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
      stopObservingZoomBounds();
      cy.destroy();
      cyRef.current = null;
    };
  }, [cancelRelationshipDraft, setCanvasNodes, worldPointFromPointerEvent]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (graphExportBusy) return;
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
          fitExploreCanvas(cy, 36);
          recordCurrentCanvasZoom(cy);
          updateConnectorHandleRef.current();
          updateResizeHandleRef.current();
        });
      });
      return;
    }
    updateCanvasZoomBounds(cy);
    cy.zoom(Math.max(cy.minZoom(), Math.min(cy.maxZoom(), previousZoom)));
    cy.pan(previousPan);
    requestAnimationFrame(() => {
      cy.resize();
      updateConnectorHandleRef.current();
      updateResizeHandleRef.current();
    });
  }, [graphElements, graphExportBusy]);

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
        // Opening/reloading the graph should show the whole graph, even with
        // pins. Only explicit layout runs preserve the pinned viewport.
        if (cy.destroyed()) return;
        fitExploreCanvas(cy, 36);
        recordCurrentCanvasZoom(cy);
        updateConnectorHandleRef.current();
        updateResizeHandleRef.current();
      });
    });
  }, [embedded, fitOnVisibleKey]);

  useEffect(() => {
    if (!autoLayoutOnInitialLoad || initialAutoLayoutDoneRef.current || graphElements.length === 0 || graphExportBusy) return;
    initialAutoLayoutDoneRef.current = true;
    // Opening the graph fits every item, including pinned items. Subsequent
    // layout requests keep the existing viewport when pins are present.
    lastAutoLayoutVisibleKeyRef.current = autoLayoutOnVisibleKey;
    void handleAutoLayout(true);
  }, [autoLayoutOnInitialLoad, graphElements.length, graphExportBusy]);

  useEffect(() => {
    if (!embedded || autoLayoutOnVisibleKey <= 0 || graphElements.length === 0) return;
    if (lastAutoLayoutVisibleKeyRef.current === autoLayoutOnVisibleKey) return;
    lastAutoLayoutVisibleKeyRef.current = autoLayoutOnVisibleKey;
    void handleAutoLayout();
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
    <div className={`view view-shell graph-canvas-canvas-view${embedded ? " graph-canvas-canvas-view--embedded" : ""}`}>
      {!embedded ? (
        <header className="view-header">
          <div>
            <div className="view-title-row">
              <h1>{t("projectCore.homeShell.savedCanvases.explore")}</h1>
              <button
                type="button"
                className="view-header-help-button"
                onClick={() => setHelpOpen(true)}
                title={t("projectCore.graph.openExploreHelp")}
                aria-label={t("projectCore.graph.openExploreHelp")}
              >
                <HelpIcon className="view-header-help-icon" />
              </button>
            </div>
            <p className="auth-hint" style={{ margin: "6px 0 0" }}>
              {t("projectCore.graph.exploreDescription")}
            </p>
          </div>
        </header>
      ) : null}

      {helpOpen ? (
        <HelpModal
          title={t("projectCore.graph.exploreHelpTitle")}
          onClose={() => setHelpOpen(false)}
          lines={[
            "Use Explore to browse project objects and relationships as an interactive graph, inspect selected items, and re-run layout when the structure changes.",
            "Layout changes help navigation in this view; they do not change object or relationship records unless you use editing actions made available by your role.",
          ]}
        />
      ) : null}

      {layoutError ? <p className="alert-error">{layoutError}</p> : null}

      <div
        className={`graph-canvas-canvas-layout${embedded ? " graph-canvas-canvas-layout--embedded" : ""}`}
      >
        <section
          className="graph-canvas-canvas-stage"
        >
          <div
            ref={cyContainerRef}
            className="graph-canvas-canvas-surface"
          />
          <CanvasPinBadges graph={badgeGraph} />
          {relationshipDraft ? (
            <svg className="graph-canvas-relationship-draft-layer" aria-hidden="true">
              <line
                ref={relationshipDraftLineRef}
                x1={relationshipDraft.start.x}
                y1={relationshipDraft.start.y}
                x2={relationshipDraft.current.x}
                y2={relationshipDraft.current.y}
                className={`graph-canvas-relationship-draft-line${relationshipDraft.targetId ? " graph-canvas-relationship-draft-line--targeted" : ""}`}
              />
            </svg>
          ) : null}
          {connectorHandle && onCanvasRelationshipDraftComplete ? (
            <button
              type="button"
              className="graph-canvas-connector-handle"
              style={{ left: connectorHandle.x, top: connectorHandle.y }}
              onClick={handleConnectorClick}
              aria-label={t("projectCore.graph.createRelationshipFromSelectedItem")}
              title={t("projectCore.graph.createRelationship")}
            >
              <PlusIcon className="graph-canvas-connector-handle-icon" />
            </button>
          ) : null}
          {resizeHandle ? (
            <div
              className="graph-canvas-resize-box"
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
                  className={`graph-canvas-resize-point graph-canvas-resize-point--${corner}`}
                  onPointerDown={(event) => handleResizePointerDown(event, corner)}
                  onMouseDown={stopResizeHandleMouseEvent}
                  onClick={stopResizeHandleMouseEvent}
                  aria-label={`Resize selected item from ${label}`}
                  title={t("projectCore.graph.resizeControl")}
                />
              ))}
            </div>
          ) : null}
          {embedded && (selectedObject || selectedRelationship) ? (
            <div className="graph-canvas-inspector-overlay">
              {inspectorCard}
            </div>
          ) : null}
          <div
            className={`graph-canvas-canvas-controls${controlSecondary ? " graph-canvas-canvas-controls--stacked" : ""}`}
            aria-label={t("projectCore.graph.canvasControls")}
          >
            {controlLead}
            <div className="graph-canvas-canvas-controls-stack">
              <div className="graph-canvas-canvas-controls-row">
                <button
                  type="button"
                  className={`btn ${autoLayoutIsCustomized ? "btn--primary" : "btn--ghost"}`}
                  onClick={() => void handleAutoLayout()}
                  disabled={layoutRunning || Object.keys(canvasNodes).length === 0}
                  aria-label={layoutRunning ? t("projectCore.graph.autoLayoutRunning") : t("projectCore.graph.autoLayout")}
                  title={layoutRunning ? t("projectCore.graph.autoLayoutRunning") : t("projectCore.graph.autoLayout")}
                >
                  <LayoutNetworkIcon className="graph-canvas-canvas-control-icon" />
                </button>
                <CanvasGraphSettings settings={networkSettings} onChange={setNetworkSettings}
                  attributes={groupingAttributes} busy={layoutRunning || objects.length === 0}
                  itemSizeControls={itemSizeControls} customItemSizes={customItemSizes}
                  onApply={() => void handleAutoLayout()} />
                {controlStart}
                <div className="graph-canvas-zoom-control" ref={zoomControlRef}>
                  <button type="button" className="btn btn--ghost" onClick={() => setZoomMenuOpen(open => !open)}
                    aria-expanded={zoomMenuOpen} aria-label={t("projectCore.graph.zoom")} title={t("projectCore.graph.zoom")}>
                    <ZoomIcon className="graph-canvas-canvas-control-icon" />
                  </button>
                  {zoomMenuOpen ? <div className="graph-canvas-zoom-menu">
                      <label className="graph-canvas-zoom-slider-label" htmlFor="graph-canvas-zoom-slider">
                        <span>{t("projectCore.graph.zoom")}</span>
                        <strong>{zoomPercent}%</strong>
                      </label>
                      <input
                        id="graph-canvas-zoom-slider"
                        className="graph-canvas-zoom-slider"
                        type="range"
                        min={minimumZoomPercent}
                        max={300}
                        step="any"
                        value={zoomPercent}
                        onChange={(event) => setCanvasZoomFromPercent(Number(event.target.value))}
                      />
                  </div> : null}
                </div>
                      <button
                        type="button"
                        className="btn btn--ghost graph-canvas-zoom-fit-btn"
                        onClick={() => {
                          const cy = cyRef.current;
                          if (!cy) return;
                          fitExploreCanvas(cy, 36);
                          recordCurrentCanvasZoom(cy);
                          updateConnectorHandleRef.current();
                          updateResizeHandleRef.current();
                        }}
                        aria-label={t("projectCore.graph.fitCanvas")}
                        title={t("projectCore.graph.fitCanvas")}
                      >
                        <FitCornersIcon className="graph-canvas-canvas-control-icon" />
                      </button>

                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setGraphExportError("");
                    setGraphExportModalOpen(true);
                  }}
                  disabled={Object.keys(canvasNodes).length === 0}
                  aria-label={t("projectCore.graph.exportGraph")}
                  title={t("projectCore.graph.exportGraph")}
                >
                  <DownloadIcon className="graph-canvas-canvas-control-icon" />
                </button>
              </div>
              {controlSecondary ? (
                <div className="graph-canvas-canvas-controls-row graph-canvas-canvas-controls-row--secondary">
                  {controlSecondary}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {!embedded ? (
          <aside className="graph-canvas-inspector-sidebar">
            {inspectorCard}
          </aside>
        ) : null}
      </div>
      {graphExportModalOpen ? (
        <SettingsModal
          title={t("projectCore.graph.exportGraphTitle")}
          onClose={() => setGraphExportModalOpen(false)}
          closeDisabled={graphExportBusy}
          modalClassName="graph-canvas-export-modal"
        >
          <div className="app-settings-modal-body">
            <div className="app-settings-modal-sections">
              <section className="app-settings-modal-section">
                <div className="app-settings-modal-section-body">
                  <div className="settings-row">
                    <div>
                      <div className="settings-row-title">{t("sharedModals.canvas.gridlines")}</div>
                    </div>
                    <div className="segmented-control" role="tablist" aria-label={t("projectCore.graph.exportGridlines")}>
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
