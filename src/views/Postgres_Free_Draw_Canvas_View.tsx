import { type ComponentType, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction, type WheelEvent as ReactWheelEvent, useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core as CytoscapeCore } from "cytoscape";
// @ts-expect-error cytoscape-grid-guide does not ship TypeScript declarations.
import gridGuide from "cytoscape-grid-guide";
import { CanvasRichTextEditor } from "../components/CanvasRichTextEditor";
import { normalizeCanvasTextHtml } from "../lib/canvasTextHtml";
import {
  buildPostgresExperimentCanvasCytoscapeElements,
  POSTGRES_EXPERIMENT_CYTOSCAPE_STYLESHEET,
} from "../lib/postgresExperimentCanvasGraph";
import type {
  PostgresExperimentCanvasDisplayShape,
  PostgresExperimentCanvasNodeState,
  PostgresExperimentCanvasPoint,
  PostgresExperimentCanvasShape,
  PostgresExperimentObject,
  PostgresExperimentObjectAttributeDefinition,
  PostgresExperimentObjectType,
  PostgresExperimentRelationship,
  PostgresExperimentRelationshipAttributeDefinition,
  PostgresExperimentRelationshipType,
} from "../lib/postgresExperiment";
import { savePostgresExperimentRelationship } from "../lib/postgresExperiment";

gridGuide(cytoscape);

type PostgresExperimentObjectTypeShape =
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
type PostgresExperimentSourceObjectVisualKey =
  | "source_text"
  | "source_image"
  | "source_audio"
  | "source_video";
type PostgresExperimentObjectFill = "filled" | "outline";
type PostgresExperimentRelationshipLineShape = "solid" | "dashed" | "dotted";
type PostgresExperimentRelationshipArrowhead = "one_sided" | "double_sided" | "none";
type PostgresExperimentCanvasTool = "select" | "hand" | "connect" | "pen" | "shape" | "text" | "eraser";

type PostgresExperimentSavedCanvasSession = {
  id: string;
  name: string;
  canvasKind: "free_draw" | "explore" | "construct";
  mode: "view" | "edit";
};

function formatCanvasToolLabel(tool: PostgresExperimentCanvasTool): string {
  switch (tool) {
    case "select":
      return "Select";
    case "hand":
      return "Pan";
    case "connect":
      return "Connect";
    case "pen":
      return "Draw";
    case "shape":
      return "Shapes";
    case "text":
      return "Text";
    case "eraser":
      return "Eraser";
    default:
      return tool;
  }
}

function getCanvasToolButtonMeta(tool: PostgresExperimentCanvasTool): {
  icon: string;
  label: string;
  hint: string;
} {
  switch (tool) {
    case "select":
      return { icon: "\u2196", label: "Select", hint: "Move and inspect objects" };
    case "hand":
      return { icon: "\u2725", label: "Pan", hint: "Move around the canvas" };
    case "connect":
      return { icon: "\u21c4", label: "Connect", hint: "Create relationships" };
    case "pen":
      return { icon: "\u223f", label: "Draw", hint: "Sketch freehand notes" };
    case "shape":
      return { icon: "\u2b21", label: "Shapes", hint: "Draw geometric callouts" };
    case "text":
      return { icon: "T", label: "Text", hint: "Add canvas text notes" };
    case "eraser":
      return { icon: "\u232b", label: "Erase", hint: "Remove canvas items" };
    default:
      return { icon: "\u2022", label: formatCanvasToolLabel(tool), hint: "" };
  }
}

type ObjectShapeSwatchProps = {
  shape: PostgresExperimentObjectTypeShape;
  fill: PostgresExperimentObjectFill;
  color: string;
  sourceVisualKey?: PostgresExperimentSourceObjectVisualKey | null;
  width: number;
  minHeight: number;
  selected?: boolean;
  style?: CSSProperties;
};

type ShapeOption = { value: PostgresExperimentObjectTypeShape; label: string };
type FillOption = { value: PostgresExperimentObjectFill; label: string };
type LineShapeOption = { value: PostgresExperimentRelationshipLineShape; label: string };
type LineWeightOption = { value: number; label: string };
type RelationshipLineShapePickerProps = {
  value: PostgresExperimentRelationshipLineShape | "";
  onChange: (value: PostgresExperimentRelationshipLineShape | "") => void;
  previewColor: string;
  allowInherit?: boolean;
  inheritLabel?: string;
};

export function PostgresExperimentCanvasView({
  projectId,
  objectTypes,
  objectAttributeDefinitions,
  objects,
  relationships,
  relationshipTypes,
  relationshipAttributeDefinitions,
  setRelationships,
  canvasNodes,
  setCanvasNodes,
  canvasShapes,
  setCanvasShapes,
  hiddenCanvasRelationshipIds,
  setHiddenCanvasRelationshipIds,
  canvasTool,
  setCanvasTool,
  canvasScale,
  setCanvasScale,
  canvasOffset,
  setCanvasOffset,
  canvasRelationshipTypeId,
  setCanvasRelationshipTypeId,
  freeDrawSaveNotice,
  freeDrawSaving,
  canvasSaveError,
  savedCanvasSession,
  onSaveDrawing,
  onCreateObjectAt,
  onOpenCreateObjectType,
  onOpenCreateRelationshipType,
  onEditObject,
  onDeleteObject,
  onEditRelationship,
  onDeleteRelationship,
  ObjectShapeSwatchComponent,
  getPostgresExperimentObjectAppearance,
  getPostgresExperimentObjectSurfaceStyle,
  getCanvasNodeDefaultDimensions,
  getCanvasNodeRenderedDimensions,
  getPostgresExperimentRelationshipAppearance,
  getPostgresExperimentRelationshipStrokeWidth,
  normalizePostgresExperimentObjectTypeColor,
  normalizePostgresExperimentRelationshipLineShape,
  normalizePostgresExperimentObjectTypeShape,
  normalizePostgresExperimentObjectFill,
  hexToRgba,
  translateCanvasShape,
  resizeCanvasBoxShape,
  isWorldPointInsideCanvasShape,
  getCanvasShapeBounds,
  getCanvasNodeBoundaryPoint,
  renderCanvasSketchShapeElement,
  getCanvasSketchShapeType,
  getCanvasSketchShapeFill,
  getCanvasSketchLineStyle,
  getPostgresExperimentRelationshipStrokeDasharray,
  formatPostgresExperimentObjectShapeLabel,
  formatPostgresExperimentObjectFillLabel,
  formatPostgresExperimentRelationshipLineShapeLabel,
  formatPostgresExperimentRelationshipLineWeightLabel,
  formatPostgresExperimentRelationshipArrowheadLabel,
  formatCanvasSketchShapeLabel,
  postgreRelationshipLineShapePickerComponent: PostgresExperimentRelationshipLineShapePickerComponent,
  objectTypeShapeOptions,
  objectFillOptions,
  relationshipLineShapeOptions,
  relationshipLineWeightOptions,
  formatRelationshipTypeConstraintSummary,
}: {
  projectId: string;
  objectTypes: PostgresExperimentObjectType[];
  objectAttributeDefinitions: PostgresExperimentObjectAttributeDefinition[];
  objects: PostgresExperimentObject[];
  relationships: PostgresExperimentRelationship[];
  relationshipTypes: PostgresExperimentRelationshipType[];
  relationshipAttributeDefinitions: PostgresExperimentRelationshipAttributeDefinition[];
  setRelationships: Dispatch<SetStateAction<PostgresExperimentRelationship[]>>;
  canvasNodes: Record<string, PostgresExperimentCanvasNodeState>;
  setCanvasNodes: Dispatch<SetStateAction<Record<string, PostgresExperimentCanvasNodeState>>>;
  canvasShapes: PostgresExperimentCanvasShape[];
  setCanvasShapes: Dispatch<SetStateAction<PostgresExperimentCanvasShape[]>>;
  hiddenCanvasRelationshipIds: string[];
  setHiddenCanvasRelationshipIds: Dispatch<SetStateAction<string[]>>;
  canvasTool: PostgresExperimentCanvasTool;
  setCanvasTool: Dispatch<SetStateAction<PostgresExperimentCanvasTool>>;
  canvasScale: number;
  setCanvasScale: Dispatch<SetStateAction<number>>;
  canvasOffset: PostgresExperimentCanvasPoint;
  setCanvasOffset: Dispatch<SetStateAction<PostgresExperimentCanvasPoint>>;
  canvasRelationshipTypeId: string;
  setCanvasRelationshipTypeId: Dispatch<SetStateAction<string>>;
  freeDrawSaveNotice: string;
  freeDrawSaving: boolean;
  canvasSaveError: string;
  savedCanvasSession: PostgresExperimentSavedCanvasSession | null;
  onSaveDrawing: () => Promise<void>;
  onCreateObjectAt: (prefilledTypeId?: string, preferredPosition?: PostgresExperimentCanvasPoint) => void;
  onOpenCreateObjectType: () => void;
  onOpenCreateRelationshipType: () => void;
  onEditObject: (object: PostgresExperimentObject) => void;
  onDeleteObject: (objectId: string) => void;
  onEditRelationship: (relationship: PostgresExperimentRelationship) => void;
  onDeleteRelationship: (relationshipId: string) => void;
  ObjectShapeSwatchComponent: ComponentType<ObjectShapeSwatchProps>;
  getPostgresExperimentObjectAppearance: (
    object: PostgresExperimentObject,
    objectTypeRecord: PostgresExperimentObjectType | null,
  ) => {
    shape: PostgresExperimentObjectTypeShape;
    color: string;
    fill: PostgresExperimentObjectFill;
    sourceVisualKey?: PostgresExperimentSourceObjectVisualKey | null;
    hasShapeOverride?: boolean;
    hasColorOverride?: boolean;
    hasFillOverride?: boolean;
  };
  getPostgresExperimentObjectSurfaceStyle: (
    color: string,
    fill: PostgresExperimentObjectFill,
    selected?: boolean,
  ) => {
    background: string;
    boxShadow: string;
    edgeColor: string;
    textColor: string;
  };
  getCanvasNodeDefaultDimensions: (shape: PostgresExperimentObjectTypeShape) => { width: number; height: number };
  getCanvasNodeRenderedDimensions: (
    shape: PostgresExperimentObjectTypeShape,
    nodeState?: Pick<PostgresExperimentCanvasNodeState, "width" | "height"> | null,
  ) => { width: number; height: number };
  getPostgresExperimentRelationshipAppearance: (
    relationship: PostgresExperimentRelationship,
    relationshipTypeRecord: PostgresExperimentRelationshipType | null,
  ) => {
    lineShape: PostgresExperimentRelationshipLineShape;
    lineWeight: number;
    arrowhead: PostgresExperimentRelationshipArrowhead;
    color: string;
    hasLineShapeOverride?: boolean;
    hasLineWeightOverride?: boolean;
    hasArrowheadOverride?: boolean;
    hasColorOverride?: boolean;
  };
  getPostgresExperimentRelationshipStrokeWidth: (lineWeight: number) => number;
  normalizePostgresExperimentObjectTypeColor: (value: string) => string;
  normalizePostgresExperimentRelationshipLineShape: (value: string) => PostgresExperimentRelationshipLineShape;
  normalizePostgresExperimentObjectTypeShape: (value: string) => PostgresExperimentObjectTypeShape;
  normalizePostgresExperimentObjectFill: (value: string) => PostgresExperimentObjectFill;
  hexToRgba: (hex: string, alpha: number) => string;
  translateCanvasShape: (shape: PostgresExperimentCanvasShape, deltaX: number, deltaY: number) => PostgresExperimentCanvasShape;
  resizeCanvasBoxShape: (
    shape: any,
    handle: "nw" | "ne" | "sw" | "se",
    nextWorldX: number,
    nextWorldY: number,
  ) => PostgresExperimentCanvasShape;
  isWorldPointInsideCanvasShape: (shape: any, world: PostgresExperimentCanvasPoint) => boolean;
  getCanvasShapeBounds: (shape: any) => { x: number; y: number; width: number; height: number };
  getCanvasNodeBoundaryPoint: (
    shape: PostgresExperimentObjectTypeShape,
    bounds: { x: number; y: number; width: number; height: number },
    toward: PostgresExperimentCanvasPoint,
  ) => PostgresExperimentCanvasPoint;
  renderCanvasSketchShapeElement: (shape: any, selected: boolean) => ReactNode;
  getCanvasSketchShapeType: (shape: any) => PostgresExperimentCanvasDisplayShape;
  getCanvasSketchShapeFill: (shape: any) => PostgresExperimentObjectFill;
  getCanvasSketchLineStyle: (shape: any) => PostgresExperimentRelationshipLineShape;
  getPostgresExperimentRelationshipStrokeDasharray: (lineShape: PostgresExperimentRelationshipLineShape) => string | undefined;
  formatPostgresExperimentObjectShapeLabel: (shape: PostgresExperimentObjectTypeShape) => string;
  formatPostgresExperimentObjectFillLabel: (fill: PostgresExperimentObjectFill) => string;
  formatPostgresExperimentRelationshipLineShapeLabel: (lineShape: PostgresExperimentRelationshipLineShape) => string;
  formatPostgresExperimentRelationshipLineWeightLabel: (lineWeight: number) => string;
  formatPostgresExperimentRelationshipArrowheadLabel: (arrowhead: PostgresExperimentRelationshipArrowhead) => string;
  formatCanvasSketchShapeLabel: (shape: PostgresExperimentCanvasDisplayShape) => string;
  postgreRelationshipLineShapePickerComponent: ComponentType<RelationshipLineShapePickerProps>;
  objectTypeShapeOptions: readonly ShapeOption[];
  objectFillOptions: readonly FillOption[];
  relationshipLineShapeOptions: readonly LineShapeOption[];
  relationshipLineWeightOptions: readonly LineWeightOption[];
  formatRelationshipTypeConstraintSummary: (relationshipType: {
    fromObjectTypes?: string[];
    toObjectTypes?: string[];
    fromObjectTypeIds?: string[];
    toObjectTypeIds?: string[];
  }) => string;
}) {
  const ObjectShapeSwatch = ObjectShapeSwatchComponent;
  const PostgresExperimentRelationshipLineShapePicker = PostgresExperimentRelationshipLineShapePickerComponent;
  const isReadOnly = savedCanvasSession?.mode === "view";
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cyContainerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<CytoscapeCore | null>(null);
  const syncingViewportRef = useRef(false);
  const [canvasError, setCanvasError] = useState("");
  const [canvasNotice, setCanvasNotice] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [pendingConnectionSourceId, setPendingConnectionSourceId] = useState<string | null>(null);
  const [connectPreviewWorld, setConnectPreviewWorld] = useState<PostgresExperimentCanvasPoint | null>(null);
  const [hoveredConnectTargetId, setHoveredConnectTargetId] = useState<string | null>(null);
  const [canvasSketchShape, setCanvasSketchShape] = useState<PostgresExperimentCanvasDisplayShape>("rectangle");
  const [canvasSketchColor, setCanvasSketchColor] = useState("#355070");
  const [canvasSketchLineStyle, setCanvasSketchLineStyle] = useState<PostgresExperimentRelationshipLineShape>("solid");
  const [canvasSketchLineWeight, setCanvasSketchLineWeight] = useState<number>(2);
  const [canvasSketchColorMenuOpen, setCanvasSketchColorMenuOpen] = useState(false);
  const [canvasSketchLineStyleMenuOpen, setCanvasSketchLineStyleMenuOpen] = useState(false);
  const [canvasSketchLineWeightMenuOpen, setCanvasSketchLineWeightMenuOpen] = useState(false);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [objectMenuOpen, setObjectMenuOpen] = useState(false);
  const [existingObjectsModalOpen, setExistingObjectsModalOpen] = useState(false);
  const [connectMenuOpen, setConnectMenuOpen] = useState(false);
  const [existingRelationshipsModalOpen, setExistingRelationshipsModalOpen] = useState(false);
  const [newRelationshipModalOpen, setNewRelationshipModalOpen] = useState(false);
  const [draftCanvasRelationshipTypeId, setDraftCanvasRelationshipTypeId] = useState("");
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [canvasToolsCollapsed, setCanvasToolsCollapsed] = useState(false);
  const [editingTextShapeId, setEditingTextShapeId] = useState<string | null>(null);
  const objectTypeById = useMemo(
    () => new Map(objectTypes.map((objectType) => [objectType.id, objectType])),
    [objectTypes],
  );
  const interactionRef = useRef<{
    mode: "idle" | "draw-pen" | "draw-shape" | "move-shape" | "resize-shape";
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    startWorldX: number;
    startWorldY: number;
    shapeId: string | null;
    initialShape: PostgresExperimentCanvasShape | null;
    resizeHandle: "nw" | "ne" | "sw" | "se" | null;
  }>({
    mode: "idle",
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startWorldX: 0,
    startWorldY: 0,
    shapeId: null,
    initialShape: null,
    resizeHandle: null,
  });
  const eraserInteractionRef = useRef<{
    pointerId: number | null;
    erasedShapeIds: Set<string>;
    erasedNodeIds: Set<string>;
    erasedEdgeIds: Set<string>;
  }>({
    pointerId: null,
    erasedShapeIds: new Set<string>(),
    erasedNodeIds: new Set<string>(),
    erasedEdgeIds: new Set<string>(),
  });
  const objectById = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  const relationshipById = useMemo(
    () => new Map(relationships.map((relationship) => [relationship.id, relationship])),
    [relationships],
  );
  const selectedRelationshipType = useMemo(
    () => relationshipTypes.find((relationshipType) => relationshipType.id === canvasRelationshipTypeId) ?? null,
    [canvasRelationshipTypeId, relationshipTypes],
  );
  const graphElements = useMemo(
    () => buildPostgresExperimentCanvasCytoscapeElements({
      objects,
      nodeStates: canvasNodes,
      objectTypeById,
      relationships,
      relationshipTypes,
      hiddenRelationshipIds: hiddenCanvasRelationshipIds,
      getObjectAppearance: getPostgresExperimentObjectAppearance,
      getObjectSurfaceStyle: getPostgresExperimentObjectSurfaceStyle,
      getNodeRenderedDimensions: getCanvasNodeRenderedDimensions,
      getRelationshipAppearance: getPostgresExperimentRelationshipAppearance,
      getRelationshipStrokeWidth: getPostgresExperimentRelationshipStrokeWidth,
    }),
    [canvasNodes, hiddenCanvasRelationshipIds, objectTypeById, objects, relationshipTypes, relationships],
  );
  const selectedObject = selectedNodeId ? objectById.get(selectedNodeId) ?? null : null;
  const selectedRelationship = selectedEdgeId ? relationshipById.get(selectedEdgeId) ?? null : null;
  const selectedShape = selectedShapeId ? canvasShapes.find((shape) => shape.id === selectedShapeId) ?? null : null;
  const showCanvasSketchStyleControls = !isReadOnly && (canvasTool === "pen" || canvasTool === "shape");
  const selectedObjectAttributeDefinitions = useMemo(
    () => objectAttributeDefinitions.filter((definition) => definition.objectTypeId === selectedObject?.objectTypeId),
    [objectAttributeDefinitions, selectedObject?.objectTypeId],
  );
  const selectedRelationshipAttributeDefinitions = useMemo(
    () => relationshipAttributeDefinitions.filter((definition) => definition.relationshipTypeId === selectedRelationship?.relationshipTypeId),
    [relationshipAttributeDefinitions, selectedRelationship?.relationshipTypeId],
  );
  const latestCanvasInteractionRef = useRef({
    isReadOnly,
    canvasTool,
    canvasRelationshipTypeId,
    canvasNodes,
  });
  const commitCanvasNodePositionRef = useRef<(node: { id: string; position: { x: number; y: number } }) => void>(() => {});
  const handleConnectRef = useRef<(connection: { source?: string | null; target?: string | null }) => Promise<void>>(async () => {});

  useEffect(() => {
    latestCanvasInteractionRef.current = {
      isReadOnly,
      canvasTool,
      canvasRelationshipTypeId,
      canvasNodes,
    };
  }, [canvasNodes, canvasRelationshipTypeId, canvasTool, isReadOnly]);

  useEffect(() => {
    if (canvasTool !== "connect") {
      setPendingConnectionSourceId(null);
      setConnectPreviewWorld(null);
      setHoveredConnectTargetId(null);
    }
  }, [canvasTool]);

  useEffect(() => {
    if (canvasTool !== "shape") {
      setShapeMenuOpen(false);
    }
  }, [canvasTool]);

  useEffect(() => {
    if (!objectMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-canvas-object-popover]")) return;
      setObjectMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [objectMenuOpen]);

  useEffect(() => {
    if (!connectMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-canvas-connect-popover]")) return;
      setConnectMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [connectMenuOpen]);

  useEffect(() => {
    if (!shapeMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-canvas-shape-popover]")) return;
      setShapeMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [shapeMenuOpen]);

  useEffect(() => {
    if (!canvasSketchColorMenuOpen && !canvasSketchLineStyleMenuOpen && !canvasSketchLineWeightMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-canvas-sketch-style-popover]")) return;
      setCanvasSketchColorMenuOpen(false);
      setCanvasSketchLineStyleMenuOpen(false);
      setCanvasSketchLineWeightMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [canvasSketchColorMenuOpen, canvasSketchLineStyleMenuOpen, canvasSketchLineWeightMenuOpen]);

  useEffect(() => {
    if (showCanvasSketchStyleControls) return;
    setCanvasSketchColorMenuOpen(false);
    setCanvasSketchLineStyleMenuOpen(false);
    setCanvasSketchLineWeightMenuOpen(false);
  }, [showCanvasSketchStyleControls]);

  useEffect(() => {
    if (!cyContainerRef.current || cyRef.current) return;

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements: graphElements,
      style: POSTGRES_EXPERIMENT_CYTOSCAPE_STYLESHEET,
      layout: { name: "preset" },
      minZoom: 0.4,
      maxZoom: 2.4,
      wheelSensitivity: 0.18,
      selectionType: "single",
      boxSelectionEnabled: false,
    });

    (cy as CytoscapeCore & { gridGuide: (options: Record<string, unknown>) => void }).gridGuide({
      snapToGridOnRelease: false,
      snapToGridDuringDrag: false,
      snapToAlignmentLocationOnRelease: false,
      snapToAlignmentLocationDuringDrag: false,
      distributionGuidelines: false,
      geometricGuideline: false,
      initPosAlignment: false,
      centerToEdgeAlignment: false,
      resize: false,
      parentPadding: false,
      drawGrid: true,
      gridSpacing: 28,
      snapToGridCenter: true,
      zoomDash: true,
      panGrid: true,
      gridStackOrder: 0,
      gridColor: "#dedede",
      lineWidth: 2,
      guidelinesStackOrder: 4,
      guidelinesTolerance: 2,
      guidelinesStyle: {
        strokeStyle: "#8b7d6b",
        geometricGuidelineRange: 400,
        range: 100,
        minDistRange: 10,
        distGuidelineOffset: 10,
        horizontalDistColor: "#ff0000",
        verticalDistColor: "#00ff00",
        initPosAlignmentColor: "#0000ff",
        lineDash: [0, 0],
        horizontalDistLine: [0, 0],
        verticalDistLine: [0, 0],
        initPosAlignmentLine: [0, 0],
      },
      parentSpacing: -1,
    });

    const restackGridCanvas = () => {
      const container = cyContainerRef.current;
      if (!container) return;

      const canvases = Array.from(container.querySelectorAll<HTMLCanvasElement>(":scope > canvas"));
      if (canvases.length === 0) return;

      const gridCanvas = canvases[canvases.length - 1];
      if (container.firstElementChild !== gridCanvas) {
        container.prepend(gridCanvas);
      }
      gridCanvas.style.zIndex = "0";
      gridCanvas.style.pointerEvents = "none";

      canvases.slice(0, -1).forEach((canvas, index) => {
        canvas.style.zIndex = String(index + 1);
      });
    };

    requestAnimationFrame(restackGridCanvas);
    window.setTimeout(restackGridCanvas, 0);

    cy.zoom(canvasScale);
    cy.pan(canvasOffset);
    cyRef.current = cy;

    const handleViewport = () => {
      if (syncingViewportRef.current) return;
      const zoom = cy.zoom();
      const pan = cy.pan();
      setCanvasScale((current) => (Math.abs(current - zoom) > 0.0001 ? zoom : current));
      setCanvasOffset((current) => (
        Math.abs(current.x - pan.x) > 0.5 || Math.abs(current.y - pan.y) > 0.5
          ? { x: pan.x, y: pan.y }
          : current
      ));
    };

    const handleNodeTap = (event: { target: { id: () => string } }) => {
      const nodeId = event.target.id();
      const latest = latestCanvasInteractionRef.current;
      if (!latest.isReadOnly && latest.canvasTool === "eraser") {
        hideCanvasObject(nodeId);
        return;
      }
      if (!latest.isReadOnly && latest.canvasTool === "connect") {
        if (!latest.canvasRelationshipTypeId) {
          setCanvasError("Choose a relationship type before connecting objects.");
          return;
        }
        setCanvasError("");
        setCanvasNotice("");
        setSelectedShapeId(null);
        setSelectedEdgeId(null);
        setSelectedNodeId(nodeId);
        setPendingConnectionSourceId((current) => {
          if (!current || current === nodeId) {
            return nodeId;
          }
          void handleConnectRef.current({ source: current, target: nodeId });
          return null;
        });
        return;
      }
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setSelectedShapeId(null);
      setCanvasNotice("");
      setCanvasError("");
    };

    const handleEdgeTap = (event: { target: { id: () => string } }) => {
      const edgeId = event.target.id();
      const latest = latestCanvasInteractionRef.current;
      if (!latest.isReadOnly && latest.canvasTool === "eraser") {
        hideCanvasRelationship(edgeId);
        return;
      }
      setSelectedEdgeId(edgeId);
      setSelectedNodeId(null);
      setSelectedShapeId(null);
      setCanvasNotice("");
      setCanvasError("");
    };

    const handleBackgroundTap = (event: { target: unknown }) => {
      if (event.target !== cy) return;
      const latest = latestCanvasInteractionRef.current;
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setSelectedShapeId(null);
      setPendingConnectionSourceId(null);
      setCanvasNotice("");
      if (latest.canvasTool === "select") {
        setInspectorCollapsed(true);
      }
    };

    const handleNodeDragFree = (event: { target: { id: () => string; position: () => { x: number; y: number } } }) => {
      const latest = latestCanvasInteractionRef.current;
      if (latest.isReadOnly || latest.canvasTool !== "select") return;
      const nodeId = event.target.id();
      const position = event.target.position();
      const nodeState = latest.canvasNodes[nodeId];
      if (!nodeState) return;
      commitCanvasNodePositionRef.current({
        id: nodeId,
        position: {
          x: position.x - nodeState.width / 2,
          y: position.y - nodeState.height / 2,
        },
      });
    };

    const handleNodeMouseOver = (event: { target: { id: () => string } }) => {
      const latest = latestCanvasInteractionRef.current;
      const nodeId = event.target.id();
      if (!latest.isReadOnly && latest.canvasTool === "eraser" && eraserInteractionRef.current.pointerId !== null) {
        if (!eraserInteractionRef.current.erasedNodeIds.has(nodeId)) {
          eraserInteractionRef.current.erasedNodeIds.add(nodeId);
          hideCanvasObject(nodeId);
        }
        return;
      }
      if (latest.isReadOnly || latest.canvasTool !== "connect" || !pendingConnectionSourceId || nodeId === pendingConnectionSourceId) {
        return;
      }
      setHoveredConnectTargetId(nodeId);
    };

    const handleEdgeMouseOver = (event: { target: { id: () => string } }) => {
      const latest = latestCanvasInteractionRef.current;
      const edgeId = event.target.id();
      if (!latest.isReadOnly && latest.canvasTool === "eraser" && eraserInteractionRef.current.pointerId !== null) {
        if (!eraserInteractionRef.current.erasedEdgeIds.has(edgeId)) {
          eraserInteractionRef.current.erasedEdgeIds.add(edgeId);
          hideCanvasRelationship(edgeId);
        }
      }
    };

    const handleNodeMouseOut = (event: { target: { id: () => string } }) => {
      const nodeId = event.target.id();
      setHoveredConnectTargetId((current) => (current === nodeId ? null : current));
    };

    cy.on("viewport", handleViewport);
    cy.on("tap", "node", handleNodeTap);
    cy.on("tap", "edge", handleEdgeTap);
    cy.on("tap", handleBackgroundTap);
    cy.on("dragfree", "node", handleNodeDragFree);
    cy.on("mouseover", "node", handleNodeMouseOver);
    cy.on("mouseover", "edge", handleEdgeMouseOver);
    cy.on("mouseout", "node", handleNodeMouseOut);

    return () => {
      cy.removeListener("viewport", undefined, handleViewport);
      cy.removeListener("tap", "node", handleNodeTap);
      cy.removeListener("tap", "edge", handleEdgeTap);
      cy.removeListener("tap", handleBackgroundTap);
      cy.removeListener("dragfree", "node", handleNodeDragFree);
      cy.removeListener("mouseover", "node", handleNodeMouseOver);
      cy.removeListener("mouseover", "edge", handleEdgeMouseOver);
      cy.removeListener("mouseout", "node", handleNodeMouseOut);
      cy.destroy();
      cyRef.current = null;
    };
  }, [pendingConnectionSourceId, setCanvasOffset, setCanvasScale]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(graphElements);
    });
  }, [graphElements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const allowPanning = isReadOnly || canvasTool === "hand";
    cy.userPanningEnabled(allowPanning);
    cy.boxSelectionEnabled(canvasTool === "select");
    cy.autoungrabify(isReadOnly || canvasTool !== "select");
  }, [canvasTool, isReadOnly]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const currentZoom = cy.zoom();
    const currentPan = cy.pan();
    if (
      Math.abs(currentZoom - canvasScale) < 0.0001
      && Math.abs(currentPan.x - canvasOffset.x) < 0.5
      && Math.abs(currentPan.y - canvasOffset.y) < 0.5
    ) {
      return;
    }
    syncingViewportRef.current = true;
    cy.zoom(canvasScale);
    cy.pan(canvasOffset);
    window.setTimeout(() => {
      syncingViewportRef.current = false;
    }, 0);
  }, [canvasOffset, canvasScale]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().unselect();
      if (selectedNodeId) {
        cy.$id(selectedNodeId).select();
      }
      if (selectedEdgeId) {
        cy.$id(selectedEdgeId).select();
      }
    });
  }, [selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("connect-source");
    cy.nodes().removeClass("connect-valid-target");
    cy.nodes().removeClass("connect-invalid-target");
    if (canvasTool === "connect" && pendingConnectionSourceId) {
      cy.$id(pendingConnectionSourceId).addClass("connect-source");
      const sourceObject = objectById.get(pendingConnectionSourceId) ?? null;
      cy.nodes().forEach((node) => {
        const nodeId = node.id();
        if (nodeId === pendingConnectionSourceId) return;
        const targetObject = objectById.get(nodeId) ?? null;
        const validFrom = !selectedRelationshipType?.fromObjectTypeIds?.length
          || !!sourceObject && selectedRelationshipType.fromObjectTypeIds.includes(sourceObject.objectTypeId);
        const validTo = !selectedRelationshipType?.toObjectTypeIds?.length
          || !!targetObject && selectedRelationshipType.toObjectTypeIds.includes(targetObject.objectTypeId);
        node.addClass(validFrom && validTo ? "connect-valid-target" : "connect-invalid-target");
      });
    }
  }, [canvasTool, objectById, pendingConnectionSourceId, selectedRelationshipType]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPendingConnectionSourceId(null);
      setConnectPreviewWorld(null);
      setHoveredConnectTargetId(null);
      setEditingTextShapeId(null);
      setCanvasNotice("");
      setCanvasError("");
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!editingTextShapeId) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-canvas-text-editor-id], [data-text-editor-toolbar='true']")) return;
      setEditingTextShapeId(null);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [editingTextShapeId]);

  function screenToWorld(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - canvasOffset.x) / canvasScale,
      y: (clientY - rect.top - canvasOffset.y) / canvasScale,
    };
  }

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const cy = cyRef.current;
    const viewport = viewportRef.current;
    if (!cy || !viewport) return;

    const target = event.target;
    if (
      target instanceof HTMLElement
      && target.closest("button, input, select, textarea, [role='menu'], [data-wheel-zoom-ignore='true']")
    ) {
      return;
    }

    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const nextZoom = Math.min(2.4, Math.max(0.4, cy.zoom() * zoomFactor));

    cy.zoom({
      level: nextZoom,
      renderedPosition: {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
    });
  }

  function getCanvasCenterWorld(): PostgresExperimentCanvasPoint {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 120, y: 120 };
    return {
      x: (rect.width / 2 - canvasOffset.x) / canvasScale,
      y: (rect.height / 2 - canvasOffset.y) / canvasScale,
    };
  }

  function addExistingObjectToCanvas(object: PostgresExperimentObject, preferredPosition?: PostgresExperimentCanvasPoint) {
    const targetPosition = preferredPosition ?? getCanvasCenterWorld();
    const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
    const shape = getPostgresExperimentObjectAppearance(object, objectTypeRecord).shape;
    const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
    setCanvasNodes((current) => ({
      ...current,
      [object.id]: {
        id: object.id,
        x: targetPosition.x,
        y: targetPosition.y,
        width: current[object.id]?.width ?? defaultDimensions.width,
        height: current[object.id]?.height ?? defaultDimensions.height,
      },
    }));
    setSelectedNodeId(object.id);
    setSelectedEdgeId(null);
    setSelectedShapeId(null);
    setCanvasNotice(canvasNodes[object.id] ? `Moved "${object.title}" on the canvas.` : `Added "${object.title}" to the canvas.`);
    setCanvasError("");
  }

  function addExistingRelationshipToCanvas(
    relationship: PostgresExperimentRelationship,
    preferredPosition?: PostgresExperimentCanvasPoint,
  ) {
    const center = preferredPosition ?? getCanvasCenterWorld();
    const sourceObject = objectById.get(relationship.fromObjectId) ?? null;
    const targetObject = objectById.get(relationship.toObjectId) ?? null;
    setCanvasNodes((current) => {
      const next = { ...current };

      const placeObject = (
        object: PostgresExperimentObject | null,
        objectId: string,
        fallbackX: number,
        fallbackY: number,
      ) => {
        if (!object || next[objectId]) return;
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        const shape = getPostgresExperimentObjectAppearance(object, objectTypeRecord).shape;
        const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
        next[objectId] = {
          id: objectId,
          x: fallbackX,
          y: fallbackY,
          width: defaultDimensions.width,
          height: defaultDimensions.height,
        };
      };

      placeObject(sourceObject, relationship.fromObjectId, center.x - 220, center.y - 20);
      placeObject(targetObject, relationship.toObjectId, center.x + 80, center.y - 20);
      return next;
    });
    setHiddenCanvasRelationshipIds((current) => current.filter((id) => id !== relationship.id));
    setSelectedEdgeId(relationship.id);
    setSelectedNodeId(null);
    setSelectedShapeId(null);
    setCanvasNotice(`Added relationship "${relationship.relationshipType}" to the canvas.`);
    setCanvasError("");
  }

  function shouldIgnoreCanvasPointerTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest(
      ".nopan, button, select, input, textarea, option, [contenteditable='true'], [data-text-editor-toolbar='true']",
    );
  }

  function updateCanvasTextShape(shapeId: string, updater: (shape: Extract<PostgresExperimentCanvasShape, { kind: "text" }>) => Extract<PostgresExperimentCanvasShape, { kind: "text" }>) {
    setCanvasShapes((current) => current.map((shape) => (
      shape.id === shapeId && shape.kind === "text" ? updater(shape) : shape
    )));
  }

  function beginEditingCanvasText(shapeId: string) {
    setSelectedShapeId(shapeId);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setEditingTextShapeId(shapeId);
  }

  function focusCanvasTextEditor(..._args: unknown[]) {
    // Text editing now uses Tiptap and focuses within the editor component.
  }

  function applyCanvasTextCommand(..._args: unknown[]) {
    // Text formatting now runs through the Tiptap editor instance.
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (shouldIgnoreCanvasPointerTarget(event.target)) return;

    if (canvasTool === "select") {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setSelectedShapeId(null);
      setPendingConnectionSourceId(null);
      setCanvasNotice("");
      setInspectorCollapsed(true);
    }

    if (isReadOnly) return;

    if (canvasTool === "eraser") {
      eraserInteractionRef.current = {
        pointerId: event.pointerId,
        erasedShapeIds: new Set<string>(),
        erasedNodeIds: new Set<string>(),
        erasedEdgeIds: new Set<string>(),
      };
      viewportRef.current?.setPointerCapture(event.pointerId);
      eraseCanvasItemsAtClientPoint(event.clientX, event.clientY);
      return;
    }

    if (canvasTool !== "pen" && canvasTool !== "shape" && canvasTool !== "text") return;

    const world = screenToWorld(event.clientX, event.clientY);
    if (canvasTool === "pen") {
      const shapeId = crypto.randomUUID();
      setCanvasShapes((current) => [
        ...current,
        {
          id: shapeId,
          kind: "pen",
          points: [world],
          color: canvasSketchColor,
          lineStyle: canvasSketchLineStyle,
          strokeWidth: getPostgresExperimentRelationshipStrokeWidth(canvasSketchLineWeight),
        },
      ]);
      interactionRef.current = {
        ...interactionRef.current,
        mode: "draw-pen",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWorldX: world.x,
        startWorldY: world.y,
        shapeId,
        initialShape: null,
        resizeHandle: null,
      };
      viewportRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (canvasTool === "shape") {
      const shapeId = crypto.randomUUID();
      setCanvasShapes((current) => [
        ...current,
        {
          id: shapeId,
          kind: "shape",
          shape: canvasSketchShape,
          x: world.x,
          y: world.y,
          width: 1,
          height: 1,
          color: canvasSketchColor,
          fill: "filled",
          lineStyle: canvasSketchLineStyle,
          strokeWidth: getPostgresExperimentRelationshipStrokeWidth(canvasSketchLineWeight),
        },
      ]);
      interactionRef.current = {
        ...interactionRef.current,
        mode: "draw-shape",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWorldX: world.x,
        startWorldY: world.y,
        shapeId,
        initialShape: null,
        resizeHandle: null,
      };
      viewportRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (canvasTool === "text") {
      const shapeId = crypto.randomUUID();
      setCanvasShapes((current) => [
        ...current,
        {
          id: shapeId,
          kind: "text",
          x: world.x,
          y: world.y,
          width: 220,
          height: 96,
          color: "#1f2933",
          strokeWidth: 1,
          html: "<div>Text</div>",
          fontSize: 18,
          textAlign: "left",
        },
      ]);
      setCanvasNotice("");
      setCanvasError("");
      beginEditingCanvasText(shapeId);
    }
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (
      !isReadOnly
      && canvasTool === "eraser"
      && eraserInteractionRef.current.pointerId === event.pointerId
    ) {
      eraseCanvasItemsAtClientPoint(event.clientX, event.clientY);
      return;
    }

    const world = screenToWorld(event.clientX, event.clientY);
    if (canvasTool === "connect" && pendingConnectionSourceId) {
      setConnectPreviewWorld(world);
    }

    const interaction = interactionRef.current;
    if (interaction.pointerId !== event.pointerId) return;

    if (interaction.mode === "draw-pen" && interaction.shapeId) {
      setCanvasShapes((current) =>
        current.map((shape) =>
          shape.id === interaction.shapeId && shape.kind === "pen"
            ? { ...shape, points: [...shape.points, world] }
            : shape,
        ),
      );
      return;
    }

    if (interaction.mode === "draw-shape" && interaction.shapeId) {
      setCanvasShapes((current) =>
        current.map((shape) => {
          if (shape.id !== interaction.shapeId || (shape.kind !== "rectangle" && shape.kind !== "shape")) return shape;
          return {
            ...shape,
            x: Math.min(interaction.startWorldX, world.x),
            y: Math.min(interaction.startWorldY, world.y),
            width: Math.abs(world.x - interaction.startWorldX),
            height: Math.abs(world.y - interaction.startWorldY),
          };
        }),
      );
      return;
    }

    if (interaction.mode === "move-shape" && interaction.shapeId && interaction.initialShape) {
      const deltaX = world.x - interaction.startWorldX;
      const deltaY = world.y - interaction.startWorldY;
      setCanvasShapes((current) =>
        current.map((shape) =>
          shape.id === interaction.shapeId ? translateCanvasShape(interaction.initialShape as PostgresExperimentCanvasShape, deltaX, deltaY) : shape,
        ),
      );
      return;
    }

    if (interaction.mode === "resize-shape" && interaction.shapeId && interaction.initialShape && interaction.resizeHandle) {
      const resizeHandle = interaction.resizeHandle;
      setCanvasShapes((current) =>
        current.map((shape) => {
          if (shape.id !== interaction.shapeId) return shape;
          if (interaction.initialShape?.kind !== "rectangle" && interaction.initialShape?.kind !== "shape" && interaction.initialShape?.kind !== "text") return shape;
          return resizeCanvasBoxShape(interaction.initialShape, resizeHandle, world.x, world.y);
        }),
      );
    }
  }

  function endInteraction(pointerId: number, currentTarget: HTMLDivElement) {
    if (eraserInteractionRef.current.pointerId === pointerId) {
      try {
        currentTarget.releasePointerCapture(pointerId);
      } catch {
        // ignore
      }
      eraserInteractionRef.current = {
        pointerId: null,
        erasedShapeIds: new Set<string>(),
        erasedNodeIds: new Set<string>(),
        erasedEdgeIds: new Set<string>(),
      };
    }
    if (interactionRef.current.pointerId !== pointerId) return;
    try {
      currentTarget.releasePointerCapture(pointerId);
    } catch {
      // ignore
    }
    interactionRef.current = {
      ...interactionRef.current,
      mode: "idle",
      pointerId: null,
      shapeId: null,
      initialShape: null,
      resizeHandle: null,
    };
  }

  const connectPreviewSourceNode = pendingConnectionSourceId
    ? canvasNodes[pendingConnectionSourceId] ?? null
    : null;
  const connectPreviewTargetNode = hoveredConnectTargetId
    ? canvasNodes[hoveredConnectTargetId] ?? null
    : null;
  const connectPreviewSourceObject = pendingConnectionSourceId
    ? objectById.get(pendingConnectionSourceId) ?? null
    : null;
  const connectPreviewTargetObject = hoveredConnectTargetId
    ? objectById.get(hoveredConnectTargetId) ?? null
    : null;

  function beginCanvasShapeMove(
    event: React.PointerEvent<Element>,
    shape: PostgresExperimentCanvasShape,
  ) {
    if (isReadOnly || canvasTool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    const world = screenToWorld(event.clientX, event.clientY);
    interactionRef.current = {
      ...interactionRef.current,
      mode: "move-shape",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: world.x,
      startWorldY: world.y,
      shapeId: shape.id,
      initialShape: shape,
      resizeHandle: null,
    };
    setSelectedShapeId(shape.id);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setEditingTextShapeId(null);
    viewportRef.current?.setPointerCapture(event.pointerId);
  }

  function beginCanvasShapeResize(
    event: React.PointerEvent<SVGCircleElement>,
    shape: Extract<PostgresExperimentCanvasShape, { kind: "rectangle" | "shape" | "text" }>,
    resizeHandle: "nw" | "ne" | "sw" | "se",
  ) {
    if (isReadOnly || canvasTool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    const world = screenToWorld(event.clientX, event.clientY);
    interactionRef.current = {
      ...interactionRef.current,
      mode: "resize-shape",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: world.x,
      startWorldY: world.y,
      shapeId: shape.id,
      initialShape: shape,
      resizeHandle,
    };
    setSelectedShapeId(shape.id);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    viewportRef.current?.setPointerCapture(event.pointerId);
  }

  function deleteCanvasShape(shapeId: string) {
    setCanvasShapes((current) => current.filter((shape) => shape.id !== shapeId));
    setSelectedShapeId((current) => (current === shapeId ? null : current));
    setCanvasError("");
  }

  function eraseCanvasItemsAtClientPoint(clientX: number, clientY: number) {
    if (isReadOnly || canvasTool !== "eraser") return;

    const eraserState = eraserInteractionRef.current;
    const world = screenToWorld(clientX, clientY);

    const hitShape = canvasShapes.find((shape) =>
      !eraserState.erasedShapeIds.has(shape.id) && isWorldPointInsideCanvasShape(shape, world),
    );
    if (hitShape) {
      eraserState.erasedShapeIds.add(hitShape.id);
      deleteCanvasShape(hitShape.id);
    }
  }

  function hideCanvasObject(objectId: string) {
    setCanvasNodes((current) => {
      if (!(objectId in current)) return current;
      const next = { ...current };
      delete next[objectId];
      return next;
    });
    setSelectedNodeId((current) => (current === objectId ? null : current));
    setSelectedEdgeId(null);
    setSelectedShapeId(null);
    setCanvasNotice("Object removed from canvas.");
    setCanvasError("");
  }

  function hideCanvasRelationship(relationshipId: string) {
    setHiddenCanvasRelationshipIds((current) => (
      current.includes(relationshipId) ? current : [...current, relationshipId]
    ));
    setSelectedEdgeId((current) => (current === relationshipId ? null : current));
    setSelectedNodeId(null);
    setSelectedShapeId(null);
    setCanvasNotice("Relationship removed from canvas.");
    setCanvasError("");
  }

  function buildUpdatedCanvasNodes(
    current: Record<string, PostgresExperimentCanvasNodeState>,
    node: { id: string; position: { x: number; y: number } },
  ) {
    const object = objectById.get(node.id) ?? null;
    const objectTypeRecord = object ? objectTypeById.get(object.objectTypeId) ?? null : null;
    const shape = object ? getPostgresExperimentObjectAppearance(object, objectTypeRecord).shape : "rectangle";
    const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
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

  function commitCanvasNodePosition(node: { id: string; position: { x: number; y: number } }) {
    setCanvasNodes((current) => buildUpdatedCanvasNodes(current, node));
  }

  async function handleConnect(connection: { source?: string | null; target?: string | null }) {
    if (isReadOnly) return;
    setCanvasError("");
    setCanvasNotice("");
    const sourceId = connection.source?.trim() ?? "";
    const targetId = connection.target?.trim() ?? "";
    if (!sourceId || !targetId) {
      setCanvasError("Choose two objects to connect.");
      return;
    }
    if (!canvasRelationshipTypeId) {
      setCanvasError("Choose a relationship type before connecting objects.");
      return;
    }

    const sourceObject = objectById.get(sourceId) ?? null;
    const targetObject = objectById.get(targetId) ?? null;
    if (!sourceObject || !targetObject) {
      setCanvasError("Could not resolve the selected objects.");
      return;
    }

    if (
      selectedRelationshipType?.fromObjectTypeIds?.length
      && !selectedRelationshipType.fromObjectTypeIds.includes(sourceObject.objectTypeId)
    ) {
      setCanvasError(`"${selectedRelationshipType.name}" must start from ${selectedRelationshipType.fromObjectTypes.join(", ") || "the required object type"}.`);
      return;
    }
    if (
      selectedRelationshipType?.toObjectTypeIds?.length
      && !selectedRelationshipType.toObjectTypeIds.includes(targetObject.objectTypeId)
    ) {
      setCanvasError(`"${selectedRelationshipType.name}" must end at ${selectedRelationshipType.toObjectTypes.join(", ") || "the required object type"}.`);
      return;
    }

    try {
      const created = await savePostgresExperimentRelationship({
        projectId,
        relationshipId: null,
        fromObjectId: sourceId,
        toObjectId: targetId,
        relationshipTypeId: canvasRelationshipTypeId,
        description: "",
        lineShapeOverride: null,
        lineWeightOverride: null,
        arrowheadOverride: null,
        colorOverride: null,
        attributeValues: [],
      });
      setRelationships((current) => [...current, created]);
      setPendingConnectionSourceId(null);
      setConnectPreviewWorld(null);
      setHoveredConnectTargetId(null);
      setSelectedNodeId(null);
      setSelectedEdgeId(created.id);
      setCanvasNotice(`Created relationship "${created.relationshipType}".`);
    } catch (error) {
      setCanvasError(error instanceof Error ? error.message : String(error));
    }
  }

  commitCanvasNodePositionRef.current = commitCanvasNodePosition;
  handleConnectRef.current = handleConnect;

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{isReadOnly ? "Saved Canvas" : "Free Draw"}</h1>
          <p className="auth-hint" style={{ margin: "6px 0 0" }}>
            {savedCanvasSession
              ? `${isReadOnly ? "Viewing" : "Editing"} saved canvas: ${savedCanvasSession.name}`
              : "Build a visual workspace from research objects and connect them directly on the canvas."}
          </p>
        </div>
        <div className="view-header-actions">
          {!isReadOnly ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void onSaveDrawing()}
              disabled={freeDrawSaving}
            >
              {freeDrawSaving ? "Saving..." : "Save drawing"}
            </button>
          ) : null}
        </div>
      </header>
      {freeDrawSaveNotice ? <p className="settings-success">{freeDrawSaveNotice}</p> : null}
      {canvasNotice ? <p className="settings-success">{canvasNotice}</p> : null}
      {canvasError ? <p className="users-error">{canvasError}</p> : null}
      {canvasSaveError ? <p className="users-error">Could not save canvas state: {canvasSaveError}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 18, flex: 1, minHeight: 0 }}>
        <div
          ref={viewportRef}
          onWheel={handleCanvasWheel}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerLeave={() => {
            if (canvasTool === "connect") {
              setConnectPreviewWorld(null);
            }
          }}
          onPointerUp={(event) => endInteraction(event.pointerId, event.currentTarget)}
          onPointerCancel={(event) => endInteraction(event.pointerId, event.currentTarget)}
          style={{
            position: "relative",
            minHeight: 0,
            overflow: "hidden",
            borderRadius: 20,
            border: "1px solid rgba(53, 80, 112, 0.14)",
             background: "radial-gradient(circle at top, rgba(189, 224, 254, 0.18), rgba(255, 255, 255, 0.98) 52%)",
             cursor: canvasTool === "pen" || canvasTool === "shape"
               ? "crosshair"
               : canvasTool === "eraser"
                ? "crosshair"
                : "default",
           }}
         >
          <div
            ref={cyContainerRef}
            style={{
              position: "absolute",
              inset: 0,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 1,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasScale})`,
                transformOrigin: "top left",
              }}
            >
              {canvasShapes.filter((shape) => shape.kind === "text").map((shape) => {
                const isSelected = shape.id === selectedShapeId;
                const isEditing = shape.id === editingTextShapeId;
                if (isEditing) {
                  return (
                    <div
                      key={shape.id}
                      style={{
                        position: "absolute",
                        left: shape.x,
                        top: shape.y,
                        width: shape.width,
                        minHeight: shape.height,
                        pointerEvents: "auto",
                      }}
                    >
                      <CanvasRichTextEditor
                        shape={shape}
                        canvasScale={canvasScale}
                        isReadOnly={isReadOnly}
                        canvasTool={canvasTool}
                        normalizeColor={normalizePostgresExperimentObjectTypeColor}
                        onBeginMove={beginCanvasShapeMove}
                        onBeginEditing={beginEditingCanvasText}
                        onDelete={deleteCanvasShape}
                        onSelect={() => {
                          setSelectedShapeId(shape.id);
                          setSelectedNodeId(null);
                          setSelectedEdgeId(null);
                        }}
                        onUpdate={(updater) => {
                          updateCanvasTextShape(shape.id, updater);
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    key={shape.id}
                    style={{
                      position: "absolute",
                      left: shape.x,
                      top: shape.y,
                      width: shape.width,
                      minHeight: shape.height,
                      pointerEvents: "auto",
                    }}
                  >
                    {isEditing ? (
                      <div
                        data-text-editor-toolbar="true"
                        style={{
                          position: "absolute",
                          left: 0,
                          bottom: "calc(100% + 8px)",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          padding: 6,
                          borderRadius: 12,
                          border: "1px solid rgba(53, 80, 112, 0.14)",
                          background: "rgba(255, 255, 255, 0.98)",
                          boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
                          transform: `scale(${1 / canvasScale})`,
                          transformOrigin: "left bottom",
                          zIndex: 4,
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {[
                          { label: "B", command: "bold" },
                          { label: "I", command: "italic" },
                          { label: "U", command: "underline" },
                          { label: "•", command: "insertUnorderedList" },
                          { label: "1.", command: "insertOrderedList" },
                          { label: "Tx", command: "removeFormat" },
                        ].map((item) => (
                          <button
                            key={item.command}
                            type="button"
                            className="btn btn--ghost"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              applyCanvasTextCommand(item.command);
                            }}
                            style={{ minWidth: 32, height: 32, padding: "0 8px", justifyContent: "center" }}
                          >
                            {item.label}
                          </button>
                        ))}
                        <div style={{ width: 1, alignSelf: "stretch", background: "rgba(53, 80, 112, 0.12)" }} />
                        {([
                          { label: "L", value: "left" },
                          { label: "C", value: "center" },
                          { label: "R", value: "right" },
                        ] as const).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className="btn btn--ghost"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              updateCanvasTextShape(shape.id, (current) => ({ ...current, textAlign: option.value }));
                              focusCanvasTextEditor(shape.id);
                            }}
                            style={{
                              minWidth: 32,
                              height: 32,
                              padding: "0 8px",
                              justifyContent: "center",
                              background: shape.textAlign === option.value ? "rgba(53, 80, 112, 0.10)" : undefined,
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                        <select
                          value={String(shape.fontSize)}
                          onMouseDown={(event) => event.stopPropagation()}
                          onChange={(event) => {
                            const nextFontSize = Number(event.target.value);
                            updateCanvasTextShape(shape.id, (current) => ({ ...current, fontSize: nextFontSize }));
                            focusCanvasTextEditor(shape.id);
                          }}
                          style={{
                            height: 32,
                            borderRadius: 10,
                            border: "1px solid rgba(53, 80, 112, 0.16)",
                            background: "#ffffff",
                            color: "#1f2933",
                            padding: "0 8px",
                          }}
                        >
                          {[14, 16, 18, 20, 24, 28, 32].map((fontSize) => (
                            <option key={fontSize} value={fontSize}>{fontSize}px</option>
                          ))}
                        </select>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            className="form-input form-input--color"
                            type="color"
                            value={shape.color}
                            aria-label="Text color"
                            onMouseDown={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              const nextColor = event.target.value;
                              updateCanvasTextShape(shape.id, (current) => ({ ...current, color: nextColor }));
                              applyCanvasTextCommand("foreColor", nextColor);
                            }}
                            style={{ width: 36, minWidth: 36, height: 32, padding: 3 }}
                          />
                          <input
                            className="form-input"
                            value={shape.color}
                            aria-label="Text color hex value"
                            onMouseDown={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              const nextColor = normalizePostgresExperimentObjectTypeColor(event.target.value);
                              updateCanvasTextShape(shape.id, (current) => ({ ...current, color: nextColor }));
                              applyCanvasTextCommand("foreColor", nextColor);
                            }}
                            style={{
                              width: 104,
                              height: 32,
                              borderRadius: 10,
                              fontFamily: "monospace",
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                    <div
                      data-canvas-text-editor-id={shape.id}
                      contentEditable={isEditing && !isReadOnly}
                      suppressContentEditableWarning
                      dangerouslySetInnerHTML={{ __html: normalizeCanvasTextHtml(shape.html) }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (canvasTool === "eraser") {
                          deleteCanvasShape(shape.id);
                          return;
                        }
                        if (canvasTool === "text") {
                          beginEditingCanvasText(shape.id);
                          return;
                        }
                        if (canvasTool === "select" && !isEditing) {
                          beginCanvasShapeMove(event, shape);
                          return;
                        }
                        setSelectedShapeId(shape.id);
                        setSelectedNodeId(null);
                        setSelectedEdgeId(null);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (!isReadOnly) {
                          beginEditingCanvasText(shape.id);
                        }
                      }}
                      onInput={(event) => {
                        const html = normalizeCanvasTextHtml(event.currentTarget.innerHTML);
                        updateCanvasTextShape(shape.id, (current) => ({ ...current, html }));
                      }}
                      onBlur={(event) => {
                        const html = normalizeCanvasTextHtml(event.currentTarget.innerHTML);
                        updateCanvasTextShape(shape.id, (current) => ({ ...current, html }));
                      }}
                      style={{
                        minHeight: shape.height,
                        padding: "6px 8px",
                        outline: "none",
                        borderRadius: 8,
                        border: isEditing
                          ? "1px solid rgba(53, 80, 112, 0.28)"
                          : isSelected
                            ? "1px solid rgba(214, 40, 40, 0.25)"
                            : "1px solid transparent",
                        background: isEditing || isSelected ? "rgba(255, 255, 255, 0.86)" : "transparent",
                        color: shape.color,
                        fontSize: shape.fontSize,
                        lineHeight: 1.35,
                        textAlign: shape.textAlign,
                        whiteSpace: "normal",
                        cursor: canvasTool === "select" && !isEditing ? "grab" : "text",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              left: 16,
              bottom: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: canvasToolsCollapsed ? 56 : 296,
                transition: "width 160ms ease",
                overflow: canvasToolsCollapsed ? "hidden" : "visible",
                boxShadow: "0 18px 36px rgba(53, 80, 112, 0.10)",
                border: "1px solid rgba(53, 80, 112, 0.12)",
                borderRadius: 18,
                background: "rgba(255, 255, 255, 0.94)",
                backdropFilter: "blur(10px)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: canvasToolsCollapsed ? 10 : 12,
                  borderBottom: canvasToolsCollapsed ? "none" : "1px solid rgba(53, 80, 112, 0.10)",
                }}
              >
                {canvasToolsCollapsed ? null : <div className="auth-hint">Canvas tools</div>}
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCanvasToolsCollapsed((current) => !current)}
                  aria-label={canvasToolsCollapsed ? "Open canvas tools" : "Collapse canvas tools"}
                  title={canvasToolsCollapsed ? "Open canvas tools" : "Collapse canvas tools"}
                  style={{
                    minWidth: 36,
                    width: 36,
                    height: 36,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {canvasToolsCollapsed ? ">" : "<"}
                </button>
              </div>
              {canvasToolsCollapsed ? null : (
                  <div style={{ padding: 12 }}>
                    <div
                      style={{
                        display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                      gap: 8,
                    }}
                  >
                    {([
                      "select",
                      "hand",
                      !isReadOnly ? "create-object" : null,
                      "connect",
                      !isReadOnly ? "pen" : null,
                      !isReadOnly ? "shape" : null,
                      !isReadOnly ? "text" : null,
                      !isReadOnly ? "eraser" : null,
                    ].filter(Boolean) as Array<PostgresExperimentCanvasTool | "create-object">).map((tool) => {
                    if (tool === "create-object") {
                      return (
                        <div
                          key={tool}
                          data-canvas-object-popover="anchor"
                          style={{
                            position: "relative",
                          }}
                        >
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => {
                              setObjectMenuOpen((current) => !current);
                              setConnectMenuOpen(false);
                              setShapeMenuOpen(false);
                              setCanvasSketchColorMenuOpen(false);
                              setCanvasSketchLineStyleMenuOpen(false);
                              setCanvasSketchLineWeightMenuOpen(false);
                            }}
                            title="Object options"
                            aria-label="Object options"
                            aria-haspopup="menu"
                            aria-expanded={objectMenuOpen}
                            style={{
                              width: "100%",
                              minHeight: 68,
                              padding: "10px 8px",
                              borderRadius: 14,
                              border: objectMenuOpen ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                              background: objectMenuOpen ? "#355070" : "rgba(53, 80, 112, 0.04)",
                              color: objectMenuOpen ? "#ffffff" : "#355070",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 4,
                              textAlign: "center",
                              boxShadow: objectMenuOpen ? "0 12px 24px rgba(53, 80, 112, 0.20)" : "none",
                            }}
                          >
                            <span
                              style={{
                                position: "relative",
                                width: 24,
                                height: 24,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <ObjectShapeSwatch
                                shape="rounded"
                                fill="outline"
                                color={objectMenuOpen ? "#ffffff" : "#355070"}
                                width={22}
                                minHeight={18}
                              />
                              <span
                                aria-hidden="true"
                                style={{
                                  position: "absolute",
                                  right: -6,
                                  bottom: -6,
                                  width: 12,
                                  height: 12,
                                  borderRadius: 999,
                                  background: objectMenuOpen ? "#ffffff" : "#355070",
                                  color: objectMenuOpen ? "#355070" : "#ffffff",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  lineHeight: 1,
                                }}
                              >
                                +
                              </span>
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.1 }}>Object</span>
                          </button>
                          {objectMenuOpen ? (
                            <div
                              role="menu"
                              data-canvas-object-popover="menu"
                              style={{
                                position: "absolute",
                                left: 0,
                                bottom: "calc(100% + 10px)",
                                width: "max-content",
                                padding: 10,
                                borderRadius: 16,
                                border: "1px solid rgba(53, 80, 112, 0.14)",
                                background: "rgba(255, 255, 255, 0.98)",
                                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                                backdropFilter: "blur(10px)",
                                zIndex: 5,
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                                  gap: 8,
                                }}
                              >
                                <button
                                  type="button"
                                  className="btn btn--ghost"
                                  title="Add an existing object"
                                  aria-label="Add an existing object"
                                  onClick={() => {
                                    setExistingObjectsModalOpen(true);
                                    setObjectMenuOpen(false);
                                    setConnectMenuOpen(false);
                                  }}
                                  style={{
                                    width: 40,
                                    minWidth: 40,
                                    height: 40,
                                    padding: 0,
                                    borderRadius: 12,
                                    border: "1px solid rgba(53, 80, 112, 0.12)",
                                    background: "rgba(53, 80, 112, 0.04)",
                                    color: "#355070",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 18,
                                    fontWeight: 700,
                                  }}
                                >
                                  O
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--ghost"
                                  title="Create a new object"
                                  aria-label="Create a new object"
                                  onClick={() => {
                                    onCreateObjectAt(undefined, getCanvasCenterWorld());
                                    setObjectMenuOpen(false);
                                    setConnectMenuOpen(false);
                                  }}
                                  style={{
                                    width: 40,
                                    minWidth: 40,
                                    height: 40,
                                    padding: 0,
                                    borderRadius: 12,
                                    border: "1px solid rgba(53, 80, 112, 0.12)",
                                    background: "rgba(53, 80, 112, 0.04)",
                                    color: "#355070",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 18,
                                    fontWeight: 700,
                                  }}
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--ghost"
                                  title="Create a new object type"
                                  aria-label="Create a new object type"
                                  onClick={() => {
                                    onOpenCreateObjectType();
                                    setObjectMenuOpen(false);
                                    setConnectMenuOpen(false);
                                  }}
                                  style={{
                                    width: 40,
                                    minWidth: 40,
                                    height: 40,
                                    padding: 0,
                                    borderRadius: 12,
                                    border: "1px solid rgba(53, 80, 112, 0.12)",
                                    background: "rgba(53, 80, 112, 0.04)",
                                    color: "#355070",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 18,
                                    fontWeight: 700,
                                  }}
                                >
                                  T
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    }

                    const meta = getCanvasToolButtonMeta(tool);
                    const isActive = canvasTool === tool;
                    const isShapeTool = tool === "shape" && !isReadOnly;
                    const isConnectTool = tool === "connect" && !isReadOnly;
                    return (
                      <div
                        key={tool}
                        data-canvas-shape-popover={isShapeTool ? "anchor" : undefined}
                        data-canvas-connect-popover={isConnectTool ? "anchor" : undefined}
                        style={{
                          position: "relative",
                        }}
                      >
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            setObjectMenuOpen(false);
                            setCanvasSketchColorMenuOpen(false);
                            setCanvasSketchLineStyleMenuOpen(false);
                            setCanvasSketchLineWeightMenuOpen(false);
                            if (tool === "connect") {
                              setConnectMenuOpen((current) => !current);
                              setShapeMenuOpen(false);
                              return;
                            }
                            setCanvasTool(tool);
                            setConnectMenuOpen(false);
                            if (tool === "shape") {
                              setShapeMenuOpen((current) => !current || canvasTool !== "shape");
                            } else {
                              setShapeMenuOpen(false);
                            }
                          }}
                          title={meta.hint}
                          aria-label={meta.label}
                          aria-haspopup={isShapeTool || isConnectTool ? "menu" : undefined}
                          aria-expanded={isShapeTool ? shapeMenuOpen : isConnectTool ? connectMenuOpen : undefined}
                          style={{
                            width: "100%",
                            minHeight: 68,
                            padding: "10px 8px",
                            borderRadius: 14,
                            border: (isConnectTool ? connectMenuOpen || isActive : isActive) ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                            background: (isConnectTool ? connectMenuOpen || isActive : isActive) ? "#355070" : "rgba(53, 80, 112, 0.04)",
                            color: (isConnectTool ? connectMenuOpen || isActive : isActive) ? "#ffffff" : "#355070",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 4,
                            textAlign: "center",
                            boxShadow: (isConnectTool ? connectMenuOpen || isActive : isActive) ? "0 12px 24px rgba(53, 80, 112, 0.20)" : "none",
                          }}
                        >
                          {tool === "shape" ? (
                            <span
                              style={{
                                position: "relative",
                                width: 24,
                                height: 24,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <ObjectShapeSwatch
                                shape={canvasSketchShape}
                                fill="outline"
                                color={isActive ? "#ffffff" : "#355070"}
                                width={22}
                                minHeight={18}
                              />
                            </span>
                          ) : tool === "connect" ? (
                            <svg
                              width="22"
                              height="22"
                              viewBox="0 0 22 22"
                              fill="none"
                              aria-hidden="true"
                              style={{ display: "block" }}
                            >
                              <circle cx="6" cy="6" r="2.5" fill="currentColor" />
                              <circle cx="16" cy="11" r="2.5" fill="currentColor" />
                              <circle cx="6" cy="16" r="2.5" fill="currentColor" />
                              <path
                                d="M8.1 6.7L13.8 10.3M8.1 15.3L13.8 11.7"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          ) : (
                            <span style={{ fontSize: 20, lineHeight: 1 }}>{meta.icon}</span>
                          )}
                          <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.1 }}>{meta.label}</span>
                        </button>
                        {isConnectTool && connectMenuOpen ? (
                          <div
                            role="menu"
                            data-canvas-connect-popover="menu"
                            style={{
                              position: "absolute",
                              left: 0,
                              bottom: "calc(100% + 10px)",
                              width: "max-content",
                              padding: 10,
                              borderRadius: 16,
                              border: "1px solid rgba(53, 80, 112, 0.14)",
                              background: "rgba(255, 255, 255, 0.98)",
                              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                              backdropFilter: "blur(10px)",
                              zIndex: 5,
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                                gap: 8,
                              }}
                            >
                              <button
                                type="button"
                                className="btn btn--ghost"
                                title="Add an existing relationship"
                                aria-label="Add an existing relationship"
                                onClick={() => {
                                  setExistingRelationshipsModalOpen(true);
                                  setConnectMenuOpen(false);
                                }}
                                style={{
                                  width: 40,
                                  minWidth: 40,
                                  height: 40,
                                  padding: 0,
                                  borderRadius: 12,
                                  border: "1px solid rgba(53, 80, 112, 0.12)",
                                  background: "rgba(53, 80, 112, 0.04)",
                                  color: "#355070",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 16,
                                  fontWeight: 700,
                                }}
                              >
                                R
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost"
                                title="Create a new relationship"
                                aria-label="Create a new relationship"
                                onClick={() => {
                                  setDraftCanvasRelationshipTypeId(canvasRelationshipTypeId || relationshipTypes[0]?.id || "");
                                  setNewRelationshipModalOpen(true);
                                  setConnectMenuOpen(false);
                                }}
                                style={{
                                  width: 40,
                                  minWidth: 40,
                                  height: 40,
                                  padding: 0,
                                  borderRadius: 12,
                                  border: "1px solid rgba(53, 80, 112, 0.12)",
                                  background: "rgba(53, 80, 112, 0.04)",
                                  color: "#355070",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 18,
                                  fontWeight: 700,
                                }}
                              >
                                +
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost"
                                title="Create a new relationship type"
                                aria-label="Create a new relationship type"
                                onClick={() => {
                                  onOpenCreateRelationshipType();
                                  setConnectMenuOpen(false);
                                }}
                                style={{
                                  width: 40,
                                  minWidth: 40,
                                  height: 40,
                                  padding: 0,
                                  borderRadius: 12,
                                  border: "1px solid rgba(53, 80, 112, 0.12)",
                                  background: "rgba(53, 80, 112, 0.04)",
                                  color: "#355070",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 16,
                                  fontWeight: 700,
                                }}
                              >
                                T
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {isShapeTool && canvasTool === "shape" && shapeMenuOpen ? (
                          <div
                            role="menu"
                            data-canvas-shape-popover="menu"
                            style={{
                              position: "absolute",
                              left: 0,
                              bottom: "calc(100% + 10px)",
                              width: "max-content",
                              padding: 10,
                              borderRadius: 16,
                              border: "1px solid rgba(53, 80, 112, 0.14)",
                              background: "rgba(255, 255, 255, 0.98)",
                              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                              backdropFilter: "blur(10px)",
                              zIndex: 5,
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: `repeat(${objectTypeShapeOptions.length}, minmax(0, 1fr))`,
                                gap: 8,
                              }}
                            >
                              {objectTypeShapeOptions.map((shapeOption) => (
                                <button
                                  key={shapeOption.value}
                                  type="button"
                                  className="btn btn--ghost"
                                  onClick={() => {
                                    setCanvasSketchShape(shapeOption.value);
                                    setCanvasTool("shape");
                                    setObjectMenuOpen(false);
                                    setShapeMenuOpen(false);
                                  }}
                                  title={shapeOption.label}
                                  aria-label={shapeOption.label}
                                  style={{
                                    width: 40,
                                    minWidth: 40,
                                    height: 40,
                                    padding: 0,
                                    borderRadius: 12,
                                    border: shapeOption.value === canvasSketchShape ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                    background: shapeOption.value === canvasSketchShape ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                    color: shapeOption.value === canvasSketchShape ? "#ffffff" : "#355070",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <ObjectShapeSwatch
                                    shape={shapeOption.value}
                                    fill="outline"
                                    color={shapeOption.value === canvasSketchShape ? "#ffffff" : "#355070"}
                                    width={22}
                                    minHeight={18}
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                    })}
                  </div>
                    {showCanvasSketchStyleControls ? (
                      <div
                        style={{
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: "1px solid rgba(53, 80, 112, 0.10)",
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div className="auth-hint" style={{ marginBottom: 0 }}>Draw style</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                          <div
                            data-canvas-sketch-style-popover="anchor"
                            style={{ position: "relative" }}
                          >
                            <button
                              type="button"
                              className="btn btn--ghost"
                              title="Sketch color"
                              aria-label="Sketch color"
                              aria-haspopup="menu"
                              aria-expanded={canvasSketchColorMenuOpen}
                              onClick={() => {
                                setCanvasSketchColorMenuOpen((current) => !current);
                                setCanvasSketchLineStyleMenuOpen(false);
                                setCanvasSketchLineWeightMenuOpen(false);
                                setObjectMenuOpen(false);
                                setConnectMenuOpen(false);
                                setShapeMenuOpen(false);
                              }}
                              style={{
                                width: "100%",
                                minHeight: 44,
                                padding: 0,
                                borderRadius: 12,
                                border: canvasSketchColorMenuOpen ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                background: canvasSketchColorMenuOpen ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                color: canvasSketchColorMenuOpen ? "#ffffff" : "#355070",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: canvasSketchColorMenuOpen ? "0 12px 24px rgba(53, 80, 112, 0.20)" : "none",
                              }}
                            >
                              <span
                                aria-hidden="true"
                                style={{
                                  position: "relative",
                                  width: 22,
                                  height: 22,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ display: "block" }}>
                                  <path
                                    d="M10.7 2.8c2.6 2.7 5.5 5.8 5.5 8.6a6.2 6.2 0 1 1-12.4 0c0-2.4 2-4.8 4.6-7.7l1-1.1a.66.66 0 0 1 .96 0l.34.36Z"
                                    fill={canvasSketchColor}
                                    stroke="currentColor"
                                    strokeWidth="1.1"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M7.4 12.35c.56.5 1.42.82 2.44.82 1.27 0 2.31-.49 2.86-1.18"
                                    stroke={canvasSketchColorMenuOpen ? "#ffffff" : "#ffffff"}
                                    strokeWidth="1"
                                    strokeLinecap="round"
                                    opacity="0.9"
                                  />
                                </svg>
                              </span>
                            </button>
                            {canvasSketchColorMenuOpen ? (
                              <div
                                role="menu"
                                data-canvas-sketch-style-popover="menu"
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  bottom: "calc(100% + 10px)",
                                  width: "max-content",
                                  padding: 10,
                                  borderRadius: 16,
                                  border: "1px solid rgba(53, 80, 112, 0.14)",
                                  background: "rgba(255, 255, 255, 0.98)",
                                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                                  backdropFilter: "blur(10px)",
                                  zIndex: 5,
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                  <input
                                    className="form-input form-input--color"
                                    type="color"
                                    value={canvasSketchColor}
                                    onChange={(event) => setCanvasSketchColor(event.target.value)}
                                    aria-label="Sketch color"
                                  />
                                  <input
                                    className="form-input"
                                    value={canvasSketchColor}
                                    onChange={(event) => setCanvasSketchColor(normalizePostgresExperimentObjectTypeColor(event.target.value))}
                                    aria-label="Sketch color hex value"
                                    style={{ width: 118, fontFamily: "monospace" }}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <div
                            data-canvas-sketch-style-popover="anchor"
                            style={{ position: "relative" }}
                          >
                            <button
                              type="button"
                              className="btn btn--ghost"
                              title="Line style"
                              aria-label="Line style"
                              aria-haspopup="menu"
                              aria-expanded={canvasSketchLineStyleMenuOpen}
                              onClick={() => {
                                setCanvasSketchLineStyleMenuOpen((current) => !current);
                                setCanvasSketchColorMenuOpen(false);
                                setCanvasSketchLineWeightMenuOpen(false);
                                setObjectMenuOpen(false);
                                setConnectMenuOpen(false);
                                setShapeMenuOpen(false);
                              }}
                              style={{
                                width: "100%",
                                minHeight: 44,
                                padding: 0,
                                borderRadius: 12,
                                border: canvasSketchLineStyleMenuOpen ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                background: canvasSketchLineStyleMenuOpen ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                color: canvasSketchLineStyleMenuOpen ? "#ffffff" : "#355070",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: canvasSketchLineStyleMenuOpen ? "0 12px 24px rgba(53, 80, 112, 0.20)" : "none",
                              }}
                            >
                              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ display: "block" }}>
                                <line
                                  x1="2.5"
                                  y1="6"
                                  x2="17.5"
                                  y2="6"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                />
                                <line
                                  x1="2.5"
                                  y1="10"
                                  x2="17.5"
                                  y2="10"
                                  stroke="currentColor"
                                  strokeWidth="2.4"
                                  strokeLinecap="round"
                                  strokeDasharray={getPostgresExperimentRelationshipStrokeDasharray(canvasSketchLineStyle)}
                                />
                                <line
                                  x1="2.5"
                                  y1="14"
                                  x2="17.5"
                                  y2="14"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                            {canvasSketchLineStyleMenuOpen ? (
                              <div
                                role="menu"
                                data-canvas-sketch-style-popover="menu"
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  bottom: "calc(100% + 10px)",
                                  width: "max-content",
                                  padding: 10,
                                  borderRadius: 16,
                                  border: "1px solid rgba(53, 80, 112, 0.14)",
                                  background: "rgba(255, 255, 255, 0.98)",
                                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                                  backdropFilter: "blur(10px)",
                                  zIndex: 5,
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: `repeat(${relationshipLineShapeOptions.length}, minmax(0, 1fr))`,
                                    gap: 8,
                                  }}
                                >
                                  {relationshipLineShapeOptions.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      className="btn btn--ghost"
                                      title={option.label}
                                      aria-label={option.label}
                                      onClick={() => {
                                        setCanvasSketchLineStyle(option.value);
                                        setCanvasSketchLineStyleMenuOpen(false);
                                      }}
                                      style={{
                                        width: 40,
                                        minWidth: 40,
                                        height: 40,
                                        padding: 0,
                                        borderRadius: 12,
                                        border: option.value === canvasSketchLineStyle ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                        background: option.value === canvasSketchLineStyle ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                        color: option.value === canvasSketchLineStyle ? "#ffffff" : "#355070",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" style={{ display: "block" }}>
                                        <line
                                          x1="3"
                                          y1="11"
                                          x2="19"
                                          y2="11"
                                          stroke="currentColor"
                                          strokeWidth="2.4"
                                          strokeLinecap="round"
                                          strokeDasharray={getPostgresExperimentRelationshipStrokeDasharray(option.value)}
                                        />
                                      </svg>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <div
                            data-canvas-sketch-style-popover="anchor"
                            style={{ position: "relative" }}
                          >
                            <button
                              type="button"
                              className="btn btn--ghost"
                              title="Line thickness"
                              aria-label="Line thickness"
                              aria-haspopup="menu"
                              aria-expanded={canvasSketchLineWeightMenuOpen}
                              onClick={() => {
                                setCanvasSketchLineWeightMenuOpen((current) => !current);
                                setCanvasSketchColorMenuOpen(false);
                                setCanvasSketchLineStyleMenuOpen(false);
                                setObjectMenuOpen(false);
                                setConnectMenuOpen(false);
                                setShapeMenuOpen(false);
                              }}
                              style={{
                                width: "100%",
                                minHeight: 44,
                                padding: 0,
                                borderRadius: 12,
                                border: canvasSketchLineWeightMenuOpen ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                background: canvasSketchLineWeightMenuOpen ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                color: canvasSketchLineWeightMenuOpen ? "#ffffff" : "#355070",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: canvasSketchLineWeightMenuOpen ? "0 12px 24px rgba(53, 80, 112, 0.20)" : "none",
                              }}
                            >
                              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ display: "block" }}>
                                <line
                                  x1="4"
                                  y1="5"
                                  x2="16"
                                  y2="5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                />
                                <line
                                  x1="4"
                                  y1="10"
                                  x2="16"
                                  y2="10"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                />
                                <line
                                  x1="4"
                                  y1="15"
                                  x2="16"
                                  y2="15"
                                  stroke="currentColor"
                                  strokeWidth={getPostgresExperimentRelationshipStrokeWidth(canvasSketchLineWeight)}
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                            {canvasSketchLineWeightMenuOpen ? (
                              <div
                                role="menu"
                                data-canvas-sketch-style-popover="menu"
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  bottom: "calc(100% + 10px)",
                                  width: "max-content",
                                  padding: 10,
                                  borderRadius: 16,
                                  border: "1px solid rgba(53, 80, 112, 0.14)",
                                  background: "rgba(255, 255, 255, 0.98)",
                                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                                  backdropFilter: "blur(10px)",
                                  zIndex: 5,
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: `repeat(${relationshipLineWeightOptions.length}, minmax(0, 1fr))`,
                                    gap: 8,
                                  }}
                                >
                                  {relationshipLineWeightOptions.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      className="btn btn--ghost"
                                      title={option.label}
                                      aria-label={option.label}
                                      onClick={() => {
                                        setCanvasSketchLineWeight(option.value);
                                        setCanvasSketchLineWeightMenuOpen(false);
                                      }}
                                      style={{
                                        width: 40,
                                        minWidth: 40,
                                        height: 40,
                                        padding: 0,
                                        borderRadius: 12,
                                        border: option.value === canvasSketchLineWeight ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                        background: option.value === canvasSketchLineWeight ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                        color: option.value === canvasSketchLineWeight ? "#ffffff" : "#355070",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" style={{ display: "block" }}>
                                        <line
                                          x1="3"
                                          y1="11"
                                          x2="19"
                                          y2="11"
                                          stroke="currentColor"
                                          strokeWidth={getPostgresExperimentRelationshipStrokeWidth(option.value)}
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: "1px solid rgba(53, 80, 112, 0.10)",
                      }}
                    >
                      <div className="auth-hint" style={{ marginBottom: 8 }}>View controls</div>
                  {canvasTool === "connect" ? (
                    <div className="auth-hint" style={{ marginBottom: 8 }}>
                      {pendingConnectionSourceId
                        ? `Choose a target object for ${objectById.get(pendingConnectionSourceId)?.title ?? "the selected object"}.`
                        : selectedRelationshipType
                          ? `New relationship: ${selectedRelationshipType.name}. Click a source object, then a target object. Press Esc to cancel.`
                          : "Choose `New relationship` from the Connect menu to start drawing a relationship."}
                    </div>
                  ) : null}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => cyRef.current?.zoom(Math.min(2.4, (cyRef.current?.zoom() ?? canvasScale) * 1.12))}
                      style={{ justifyContent: "center" }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => cyRef.current?.zoom(Math.max(0.4, (cyRef.current?.zoom() ?? canvasScale) / 1.12))}
                      style={{ justifyContent: "center" }}
                    >
                      -
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => cyRef.current?.fit(undefined, 36)}
                      aria-label="Center canvas"
                      title="Center canvas"
                      style={{ justifyContent: "center" }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 18 18"
                        fill="none"
                        aria-hidden="true"
                        style={{ display: "block" }}
                      >
                        <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M9 1.75V4.25M9 13.75V16.25M1.75 9H4.25M13.75 9H16.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                    </div>
                  </div>
              )}
            </div>
          </div>
          <div
              className="nopan nodrag"
              style={{
                position: "absolute",
                marginTop: 16,
                marginRight: 16,
                top: 0,
                right: 0,
                width: inspectorCollapsed ? 56 : 320,
                transition: "width 160ms ease",
                pointerEvents: "auto",
              }}
            >
              <div
                  className="nopan nodrag"
                  style={{
                    overflow: "hidden",
                    borderRadius: 20,
                    border: "1px solid rgba(53, 80, 112, 0.12)",
                  background: "rgba(255, 255, 255, 0.96)",
                  boxShadow: "0 18px 36px rgba(53, 80, 112, 0.08)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: inspectorCollapsed ? 10 : 14,
                    borderBottom: inspectorCollapsed ? "none" : "1px solid rgba(53, 80, 112, 0.10)",
                  }}
                >
                  {inspectorCollapsed ? null : <h2 style={{ margin: 0, fontSize: 18 }}>Inspector</h2>}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setInspectorCollapsed((current) => !current)}
                    aria-label={inspectorCollapsed ? "Open inspector" : "Collapse inspector"}
                    title={inspectorCollapsed ? "Open inspector" : "Collapse inspector"}
                    style={{
                      minWidth: 36,
                      width: 36,
                      height: 36,
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {inspectorCollapsed ? "<" : ">"}
                  </button>
                </div>

                {inspectorCollapsed ? null : (
                  <div
                    style={{
                      maxHeight: "calc(100vh - 280px)",
                      overflow: "auto",
                      padding: 18,
                      pointerEvents: "auto",
                    }}
                    onWheel={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {selectedObject ? (
                      (() => {
                        const objectTypeRecord = objectTypeById.get(selectedObject.objectTypeId) ?? null;
                        const appearance = getPostgresExperimentObjectAppearance(selectedObject, objectTypeRecord);
                        return (
                          <>
                        <div className="auth-hint" style={{ marginBottom: 14 }}>Selected object</div>
                        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#52606d" }}>
                          {selectedObject.objectType}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: "#1f2933" }}>
                          {selectedObject.title}
                        </div>
                        <p style={{ marginTop: 12, color: "#52606d", lineHeight: 1.5 }}>
                          {selectedObject.description || "No description yet."}
                        </p>
                        <div className="home-restricted-list" style={{ marginTop: 16 }}>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Appearance</span>
                            <span className="home-restricted-value" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <ObjectShapeSwatch
                                shape={appearance.shape}
                                fill={appearance.fill}
                                color={appearance.color}
                                sourceVisualKey={appearance.sourceVisualKey}
                                width={22}
                                minHeight={16}
                              />
                              <span>{`${formatPostgresExperimentObjectShapeLabel(appearance.shape)} / ${formatPostgresExperimentObjectFillLabel(appearance.fill)}`}</span>
                            </span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Overrides</span>
                            <span className="home-restricted-value">
                              {appearance.hasShapeOverride || appearance.hasColorOverride || appearance.hasFillOverride
                                ? [appearance.hasShapeOverride ? "Shape" : "", appearance.hasColorOverride ? "Color" : "", appearance.hasFillOverride ? "Fill" : ""].filter(Boolean).join(" + ")
                                : "Inherited"}
                            </span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Attributes</span>
                            <span className="home-restricted-value">{selectedObjectAttributeDefinitions.length}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Connected links</span>
                            <span className="home-restricted-value">
                              {relationships.filter((relationship) => relationship.fromObjectId === selectedObject.id || relationship.toObjectId === selectedObject.id).length}
                            </span>
                          </div>
                        </div>
                        {selectedObjectAttributeDefinitions.length > 0 ? (
                          <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                            <span className="auth-hint" style={{ margin: 0 }}>Attributes</span>
                            <div className="case-detail-attributes-table-wrap">
                              <table className="case-detail-attributes-table">
                                <tbody>
                                  {selectedObjectAttributeDefinitions.map((definition) => {
                                    const attributeValue = selectedObject.attributeValues.find(
                                      (value) => value.attributeDefinitionId === definition.id,
                                    )?.value;
                                    return (
                                      <tr key={definition.id}>
                                        <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                                        <td className="case-detail-attributes-value">{attributeValue?.trim() ? attributeValue : "-"}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                        {!isReadOnly ? (
                          <div
                            className="form-actions"
                            style={{ marginTop: 18, justifyContent: "flex-start" }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="btn"
                              onClick={() => onEditObject(selectedObject)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              style={{ color: "#b42318" }}
                              onClick={() => {
                                onDeleteObject(selectedObject.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                          </>
                        );
                      })()
                    ) : selectedRelationship ? (
                      <>
                        {(() => {
                          const relationshipTypeRecord = relationshipTypes.find(
                            (relationshipType) => relationshipType.id === selectedRelationship.relationshipTypeId,
                          ) ?? null;
                          const appearance = getPostgresExperimentRelationshipAppearance(selectedRelationship, relationshipTypeRecord);
                          return (
                            <>
                        <div className="auth-hint" style={{ marginBottom: 14 }}>Selected relationship</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2933" }}>
                          {selectedRelationship.relationshipType}
                        </div>
                        <div className="home-restricted-list" style={{ marginTop: 16 }}>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Appearance</span>
                            <span className="home-restricted-value" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <svg width="40" height="14" viewBox="0 0 40 14" aria-hidden="true">
                                <defs>
                                  <marker id="canvas-selected-relationship-end" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                                    <path d="M0,0 L7,3.5 L0,7 z" fill={appearance.color} />
                                  </marker>
                                  <marker id="canvas-selected-relationship-start" markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto">
                                    <path d="M7,0 L0,3.5 L7,7 z" fill={appearance.color} />
                                  </marker>
                                </defs>
                                <line
                                  x1="2"
                                  y1="7"
                                  x2="38"
                                  y2="7"
                                  stroke={appearance.color}
                                  strokeWidth={getPostgresExperimentRelationshipStrokeWidth(appearance.lineWeight)}
                                  strokeDasharray={getPostgresExperimentRelationshipStrokeDasharray(appearance.lineShape)}
                                  markerEnd={appearance.arrowhead === "none" ? undefined : "url(#canvas-selected-relationship-end)"}
                                  markerStart={appearance.arrowhead === "double_sided" ? "url(#canvas-selected-relationship-start)" : undefined}
                                />
                              </svg>
                              <span>{`${formatPostgresExperimentRelationshipLineShapeLabel(appearance.lineShape)} | ${formatPostgresExperimentRelationshipLineWeightLabel(appearance.lineWeight)} | ${formatPostgresExperimentRelationshipArrowheadLabel(appearance.arrowhead)}`}</span>
                            </span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Overrides</span>
                            <span className="home-restricted-value">
                              {appearance.hasLineShapeOverride || appearance.hasLineWeightOverride || appearance.hasArrowheadOverride || appearance.hasColorOverride
                                ? [appearance.hasLineShapeOverride ? "Line shape" : "", appearance.hasLineWeightOverride ? "Line weight" : "", appearance.hasArrowheadOverride ? "Arrowheads" : "", appearance.hasColorOverride ? "Color" : ""].filter(Boolean).join(" + ")
                                : "Inherited"}
                            </span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">From</span>
                            <span className="home-restricted-value">{objectById.get(selectedRelationship.fromObjectId)?.title ?? "Unknown object"}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">To</span>
                            <span className="home-restricted-value">{objectById.get(selectedRelationship.toObjectId)?.title ?? "Unknown object"}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Attributes</span>
                            <span className="home-restricted-value">{selectedRelationshipAttributeDefinitions.length}</span>
                          </div>
                        </div>
                        {selectedRelationshipAttributeDefinitions.length > 0 ? (
                          <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                            <span className="auth-hint" style={{ margin: 0 }}>Attributes</span>
                            <div className="case-detail-attributes-table-wrap">
                              <table className="case-detail-attributes-table">
                                <tbody>
                                  {selectedRelationshipAttributeDefinitions.map((definition) => {
                                    const attributeValue = selectedRelationship.attributeValues.find(
                                      (value) => value.attributeDefinitionId === definition.id,
                                    )?.value;
                                    return (
                                      <tr key={definition.id}>
                                        <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                                        <td className="case-detail-attributes-value">{attributeValue?.trim() ? attributeValue : "-"}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                        <p style={{ marginTop: 14, color: "#52606d", lineHeight: 1.5 }}>
                          {selectedRelationship.description || "No description yet."}
                        </p>
                        {!isReadOnly ? (
                          <div
                            className="form-actions"
                            style={{ marginTop: 18, justifyContent: "flex-start" }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="btn"
                              onClick={() => onEditRelationship(selectedRelationship)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              style={{ color: "#b42318" }}
                              onClick={() => {
                                onDeleteRelationship(selectedRelationship.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                            </>
                          );
                        })()}
                      </>
                    ) : selectedShape ? (
                      <>
                        <div className="auth-hint" style={{ marginBottom: 14 }}>Selected sketch</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2933" }}>
                          {selectedShape.kind === "pen" ? "Freehand line" : selectedShape.kind === "text" ? "Text" : formatCanvasSketchShapeLabel(getCanvasSketchShapeType(selectedShape))}
                        </div>
                        {!isReadOnly ? (
                          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                            {selectedShape.kind === "shape" ? (
                              <label style={{ display: "grid", gap: 6 }}>
                                <span className="auth-hint" style={{ margin: 0 }}>Shape</span>
                                <select
                                  className="input"
                                  value={selectedShape.shape}
                                  onChange={(event) => {
                                    const nextShape = normalizePostgresExperimentObjectTypeShape(event.target.value);
                                    setCanvasShapes((current) => current.map((shape) => (
                                      shape.id === selectedShape.id && shape.kind === "shape" ? { ...shape, shape: nextShape } : shape
                                    )));
                                  }}
                                >
                                  {objectTypeShapeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {selectedShape.kind === "shape" || selectedShape.kind === "rectangle" ? (
                              <label style={{ display: "grid", gap: 6 }}>
                                <span className="auth-hint" style={{ margin: 0 }}>Fill</span>
                                <select
                                  className="input"
                                  value={getCanvasSketchShapeFill(selectedShape)}
                                  onChange={(event) => {
                                    const nextFill = normalizePostgresExperimentObjectFill(event.target.value);
                                    setCanvasShapes((current) => current.map((shape) => (
                                      shape.id === selectedShape.id && (shape.kind === "shape" || shape.kind === "rectangle")
                                        ? { ...shape, fill: nextFill }
                                        : shape
                                    )));
                                  }}
                                >
                                  {objectFillOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            <label style={{ display: "grid", gap: 6 }}>
                              <span className="auth-hint" style={{ margin: 0 }}>Color</span>
                              <input
                                className="input"
                                type="color"
                                value={selectedShape.color}
                                onChange={(event) => {
                                  const nextColor = event.target.value;
                                  setCanvasShapes((current) => current.map((shape) => (
                                    shape.id === selectedShape.id ? { ...shape, color: nextColor } : shape
                                  )));
                                }}
                              />
                            </label>
                            {selectedShape.kind !== "text" ? (
                              <label style={{ display: "grid", gap: 6 }}>
                                <span className="auth-hint" style={{ margin: 0 }}>Line style</span>
                                <PostgresExperimentRelationshipLineShapePicker
                                  value={getCanvasSketchLineStyle(selectedShape)}
                                  onChange={(value) => {
                                    const nextLineStyle = normalizePostgresExperimentRelationshipLineShape(value || "");
                                    setCanvasShapes((current) => current.map((shape) => (
                                      shape.id === selectedShape.id && shape.kind !== "text"
                                        ? { ...shape, lineStyle: nextLineStyle }
                                        : shape
                                    )));
                                  }}
                                  previewColor={selectedShape.color}
                                />
                              </label>
                            ) : null}
                            <label style={{ display: "grid", gap: 6 }}>
                              <span className="auth-hint" style={{ margin: 0 }}>Stroke width</span>
                              <input
                                className="input"
                                type="number"
                                min={1}
                                max={12}
                                step={1}
                                value={selectedShape.strokeWidth}
                                onChange={(event) => {
                                  const nextStrokeWidth = Math.max(1, Number(event.target.value) || 1);
                                  setCanvasShapes((current) => current.map((shape) => (
                                    shape.id === selectedShape.id ? { ...shape, strokeWidth: nextStrokeWidth } : shape
                                  )));
                                }}
                              />
                            </label>
                            {selectedShape.kind === "text" ? (
                              <>
                                <label style={{ display: "grid", gap: 6 }}>
                                  <span className="auth-hint" style={{ margin: 0 }}>Font size</span>
                                  <input
                                    className="input"
                                    type="number"
                                    min={10}
                                    max={72}
                                    step={1}
                                    value={selectedShape.fontSize}
                                    onChange={(event) => {
                                      const nextFontSize = Math.max(10, Number(event.target.value) || 18);
                                      updateCanvasTextShape(selectedShape.id, (shape) => ({ ...shape, fontSize: nextFontSize }));
                                    }}
                                  />
                                </label>
                                <label style={{ display: "grid", gap: 6 }}>
                                  <span className="auth-hint" style={{ margin: 0 }}>Text align</span>
                                  <select
                                    className="input"
                                    value={selectedShape.textAlign}
                                    onChange={(event) => {
                                      const nextTextAlign = event.target.value as "left" | "center" | "right";
                                      updateCanvasTextShape(selectedShape.id, (shape) => ({ ...shape, textAlign: nextTextAlign }));
                                    }}
                                  >
                                    <option value="left">Left</option>
                                    <option value="center">Center</option>
                                    <option value="right">Right</option>
                                  </select>
                                </label>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="home-restricted-list" style={{ marginTop: 16 }}>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Canvas item</span>
                            <span className="home-restricted-value">{selectedShape.id.slice(0, 8)}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Color</span>
                            <span className="home-restricted-value">{selectedShape.color}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Stroke</span>
                            <span className="home-restricted-value">{selectedShape.strokeWidth}</span>
                          </div>
                          {selectedShape.kind === "text" ? (
                            <div className="home-restricted-item">
                              <span className="home-restricted-label">Font size</span>
                              <span className="home-restricted-value">{selectedShape.fontSize}</span>
                            </div>
                          ) : null}
                        </div>
                        {!isReadOnly ? (
                          <div className="form-actions" style={{ marginTop: 18 }}>
                            <button type="button" className="btn btn--danger" onClick={() => deleteCanvasShape(selectedShape.id)}>
                              Delete sketch
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="auth-hint" style={{ marginBottom: 14 }}>
                          Select an object or relationship to inspect it here.
                        </div>
                        <div className="home-restricted-list">
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Objects</span>
                            <span className="home-restricted-value">{objects.length}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Relationships</span>
                            <span className="home-restricted-value">{relationships.length}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Sketches</span>
                            <span className="home-restricted-value">{canvasShapes.length}</span>
                          </div>
                        </div>
                        {!isReadOnly ? (
                          <div className="form-actions" style={{ marginTop: 18 }}>
                            <button type="button" className="btn btn--primary" onClick={() => onCreateObjectAt(undefined, getCanvasCenterWorld())}>
                              Create object here
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}

                  </div>
                )}
              </div>
          </div>

          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            <svg width="100%" height="100%" style={{ display: "block", overflow: "visible" }}>
              <g transform={`translate(${canvasOffset.x} ${canvasOffset.y}) scale(${canvasScale})`}>
                {canvasTool === "connect" && connectPreviewSourceNode && connectPreviewWorld && connectPreviewSourceObject ? (
                  (() => {
                    const sourceObjectType = objectTypeById.get(connectPreviewSourceObject.objectTypeId) ?? null;
                    const sourceShape = getPostgresExperimentObjectAppearance(connectPreviewSourceObject, sourceObjectType).shape;
                    const sourceCenter = {
                      x: connectPreviewSourceNode.x + connectPreviewSourceNode.width / 2,
                      y: connectPreviewSourceNode.y + connectPreviewSourceNode.height / 2,
                    };
                    if (connectPreviewTargetNode && connectPreviewTargetObject) {
                      const targetObjectType = objectTypeById.get(connectPreviewTargetObject.objectTypeId) ?? null;
                      const targetShape = getPostgresExperimentObjectAppearance(connectPreviewTargetObject, targetObjectType).shape;
                      const targetCenter = {
                        x: connectPreviewTargetNode.x + connectPreviewTargetNode.width / 2,
                        y: connectPreviewTargetNode.y + connectPreviewTargetNode.height / 2,
                      };
                      const start = getCanvasNodeBoundaryPoint(
                        sourceShape,
                        connectPreviewSourceNode,
                        targetCenter,
                      );
                      const end = getCanvasNodeBoundaryPoint(
                        targetShape,
                        connectPreviewTargetNode,
                        sourceCenter,
                      );
                      return (
                        <>
                          <defs>
                            <marker id="canvas-connect-preview-end" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                              <path d="M0,0 L7,3.5 L0,7 z" fill="#355070" />
                            </marker>
                          </defs>
                          <line
                            x1={start.x}
                            y1={start.y}
                            x2={end.x}
                            y2={end.y}
                            stroke="#355070"
                            strokeWidth={2.5}
                            strokeDasharray="8 6"
                            markerEnd="url(#canvas-connect-preview-end)"
                            pointerEvents="none"
                          />
                        </>
                      );
                    }
                    const start = getCanvasNodeBoundaryPoint(
                      sourceShape,
                      connectPreviewSourceNode,
                      connectPreviewWorld,
                    );
                    return (
                      <>
                        <defs>
                          <marker id="canvas-connect-preview-end" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                            <path d="M0,0 L7,3.5 L0,7 z" fill="#355070" />
                          </marker>
                        </defs>
                        <line
                          x1={start.x}
                          y1={start.y}
                          x2={connectPreviewWorld.x}
                          y2={connectPreviewWorld.y}
                          stroke="#355070"
                          strokeWidth={2.5}
                          strokeDasharray="8 6"
                          markerEnd="url(#canvas-connect-preview-end)"
                          pointerEvents="none"
                        />
                      </>
                    );
                  })()
                ) : null}
                {canvasShapes.map((shape) => {
                  if (shape.kind === "pen") {
                    const bounds = getCanvasShapeBounds(shape);
                    const strokeDasharray = getPostgresExperimentRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
                    return (
                      <g key={shape.id}>
                        <polyline
                          points={shape.points.map((point) => `${point.x},${point.y}`).join(" ")}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={Math.max(shape.strokeWidth + 10, 14)}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pointerEvents="stroke"
                          style={{ cursor: canvasTool === "select" ? "grab" : "pointer" }}
                          onPointerDown={(event) => beginCanvasShapeMove(event, shape)}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (canvasTool === "eraser") {
                              deleteCanvasShape(shape.id);
                              return;
                            }
                            setSelectedShapeId(shape.id);
                            setSelectedNodeId(null);
                            setSelectedEdgeId(null);
                            setCanvasNotice("");
                          }}
                        />
                        <polyline
                          points={shape.points.map((point) => `${point.x},${point.y}`).join(" ")}
                          fill="none"
                          stroke={shape.id === selectedShapeId ? "#d62828" : shape.color}
                          strokeWidth={shape.id === selectedShapeId ? shape.strokeWidth + 1.5 : shape.strokeWidth}
                          strokeDasharray={strokeDasharray}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pointerEvents="none"
                        />
                        {shape.id === selectedShapeId && canvasTool === "select" ? (
                          <rect
                            x={bounds.x - 8}
                            y={bounds.y - 8}
                            width={bounds.width + 16}
                            height={bounds.height + 16}
                            fill="none"
                            stroke="rgba(214, 40, 40, 0.42)"
                            strokeWidth={1.5}
                            strokeDasharray="6 4"
                            pointerEvents="none"
                          />
                        ) : null}
                      </g>
                    );
                  }
                  const bounds = getCanvasShapeBounds(shape);
                  return (
                    <g
                      key={shape.id}
                    >
                      {shape.kind === "text" ? null : (
                        <g
                          onPointerDown={(event) => beginCanvasShapeMove(event, shape)}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (canvasTool === "eraser") {
                              deleteCanvasShape(shape.id);
                              return;
                            }
                            setSelectedShapeId(shape.id);
                            setSelectedNodeId(null);
                            setSelectedEdgeId(null);
                            setCanvasNotice("");
                          }}
                        >
                          {renderCanvasSketchShapeElement(shape, shape.id === selectedShapeId)}
                        </g>
                      )}
                      {shape.id === selectedShapeId && canvasTool === "select" ? (
                        <>
                          <rect
                            x={bounds.x - 6}
                            y={bounds.y - 6}
                            width={bounds.width + 12}
                            height={bounds.height + 12}
                            fill="none"
                            stroke="rgba(214, 40, 40, 0.42)"
                            strokeWidth={1.5}
                            strokeDasharray="6 4"
                            pointerEvents="none"
                          />
                          {([
                            { key: "nw", x: bounds.x, y: bounds.y, cursor: "nwse-resize" },
                            { key: "ne", x: bounds.x + bounds.width, y: bounds.y, cursor: "nesw-resize" },
                            { key: "sw", x: bounds.x, y: bounds.y + bounds.height, cursor: "nesw-resize" },
                            { key: "se", x: bounds.x + bounds.width, y: bounds.y + bounds.height, cursor: "nwse-resize" },
                          ] as { key: "nw" | "ne" | "sw" | "se"; x: number; y: number; cursor: string }[]).map((handle) => (
                            <circle
                              key={handle.key}
                              cx={handle.x}
                              cy={handle.y}
                              r={6}
                              fill="#ffffff"
                              stroke="#d62828"
                              strokeWidth={2}
                              pointerEvents="all"
                              style={{ cursor: handle.cursor }}
                              onPointerDown={(event) => beginCanvasShapeResize(event, shape as Extract<PostgresExperimentCanvasShape, { kind: "rectangle" | "shape" | "text" }>, handle.key)}
                            />
                          ))}
                        </>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        </div>
        {existingObjectsModalOpen ? (
          <div className="modal-overlay" onClick={() => setExistingObjectsModalOpen(false)}>
            <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: "min(560px, calc(100vw - 32px))" }}>
              <h2>Add Existing Object</h2>
              <div className="auth-hint" style={{ marginTop: -6, marginBottom: 14 }}>
                Choose an existing project object to place on the canvas.
              </div>
              {objects.length === 0 ? (
                <div style={{ color: "#52606d", lineHeight: 1.5 }}>
                  No objects exist yet. Use the new object option to create one first.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    maxHeight: "min(56vh, 420px)",
                    overflowY: "auto",
                    paddingRight: 4,
                  }}
                >
                  {objects
                    .slice()
                    .sort((left, right) => left.title.localeCompare(right.title))
                    .map((object) => {
                      const objectType = objectTypeById.get(object.objectTypeId) ?? null;
                      const appearance = getPostgresExperimentObjectAppearance(object, objectType);
                      const isOnCanvas = !!canvasNodes[object.id];
                      return (
                        <button
                          key={object.id}
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            addExistingObjectToCanvas(object, getCanvasCenterWorld());
                            setExistingObjectsModalOpen(false);
                          }}
                          style={{
                            width: "100%",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            padding: "12px 14px",
                            borderRadius: 14,
                            border: `1px solid ${hexToRgba(appearance.color, 0.24)}`,
                            background: "rgba(255, 255, 255, 0.94)",
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                            <ObjectShapeSwatch
                              shape={appearance.shape}
                              fill={appearance.fill}
                              color={appearance.color}
                              sourceVisualKey={appearance.sourceVisualKey}
                              width={22}
                              minHeight={18}
                            />
                            <span style={{ display: "grid", gap: 2, textAlign: "left", minWidth: 0 }}>
                              <span style={{ fontWeight: 700, color: "#1f2933", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {object.title}
                              </span>
                              <span style={{ fontSize: 12, color: "#52606d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {objectType?.name || "Untyped object"}
                              </span>
                            </span>
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: isOnCanvas ? "#355070" : "#52606d", whiteSpace: "nowrap" }}>
                            {isOnCanvas ? "On canvas" : "Add"}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
              <div className="form-actions" style={{ marginTop: 18 }}>
                <button type="button" className="btn" onClick={() => setExistingObjectsModalOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {existingRelationshipsModalOpen ? (
          <div className="modal-overlay" onClick={() => setExistingRelationshipsModalOpen(false)}>
            <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: "min(620px, calc(100vw - 32px))" }}>
              <h2>Add Existing Relationship</h2>
              <div className="auth-hint" style={{ marginTop: -6, marginBottom: 14 }}>
                Choose an existing project relationship to place on the canvas.
              </div>
              {relationships.length === 0 ? (
                <div style={{ color: "#52606d", lineHeight: 1.5 }}>
                  No relationships exist yet. Use the new relationship option to create one first.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    maxHeight: "min(56vh, 420px)",
                    overflowY: "auto",
                    paddingRight: 4,
                  }}
                >
                  {relationships
                    .slice()
                    .sort((left, right) => left.relationshipType.localeCompare(right.relationshipType))
                    .map((relationship) => {
                      const isOnCanvas = !hiddenCanvasRelationshipIds.includes(relationship.id)
                        && !!canvasNodes[relationship.fromObjectId]
                        && !!canvasNodes[relationship.toObjectId];
                      return (
                        <button
                          key={relationship.id}
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            addExistingRelationshipToCanvas(relationship, getCanvasCenterWorld());
                            setExistingRelationshipsModalOpen(false);
                          }}
                          style={{
                            width: "100%",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            padding: "12px 14px",
                            borderRadius: 14,
                            border: "1px solid rgba(53, 80, 112, 0.14)",
                            background: "rgba(255, 255, 255, 0.94)",
                          }}
                        >
                          <span style={{ display: "grid", gap: 2, textAlign: "left", minWidth: 0 }}>
                            <span style={{ fontWeight: 700, color: "#1f2933" }}>
                              {relationship.relationshipType}
                            </span>
                            <span style={{ fontSize: 12, color: "#52606d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {(objectById.get(relationship.fromObjectId)?.title ?? "Unknown")} to {(objectById.get(relationship.toObjectId)?.title ?? "Unknown")}
                            </span>
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: isOnCanvas ? "#355070" : "#52606d", whiteSpace: "nowrap" }}>
                            {isOnCanvas ? "On canvas" : "Add"}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
              <div className="form-actions" style={{ marginTop: 18 }}>
                <button type="button" className="btn" onClick={() => setExistingRelationshipsModalOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {newRelationshipModalOpen ? (
          <div className="modal-overlay" onClick={() => setNewRelationshipModalOpen(false)}>
            <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: "min(520px, calc(100vw - 32px))" }}>
              <h2>Start New Relationship</h2>
              <div className="auth-hint" style={{ marginTop: -6, marginBottom: 14 }}>
                Choose a relationship type, then click a source object and a target object on the canvas.
              </div>
              <label className="form-label">
                Relationship type
                <select
                  className="form-input"
                  value={draftCanvasRelationshipTypeId}
                  onChange={(event) => setDraftCanvasRelationshipTypeId(event.target.value)}
                  autoFocus
                >
                  <option value="">Choose relationship type</option>
                  {relationshipTypes.map((relationshipType) => (
                    <option key={relationshipType.id} value={relationshipType.id}>
                      {relationshipType.name}
                    </option>
                  ))}
                </select>
              </label>
              {draftCanvasRelationshipTypeId
                && relationshipTypes.find((relationshipType) => relationshipType.id === draftCanvasRelationshipTypeId) ? (
                  <div className="auth-hint" style={{ marginTop: 10 }}>
                    {formatRelationshipTypeConstraintSummary(
                      relationshipTypes.find((relationshipType) => relationshipType.id === draftCanvasRelationshipTypeId)!,
                    )}
                  </div>
                ) : null}
              <div className="form-actions" style={{ marginTop: 18 }}>
                <button type="button" className="btn" onClick={() => setNewRelationshipModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!draftCanvasRelationshipTypeId}
                  onClick={() => {
                    if (!draftCanvasRelationshipTypeId) return;
                    setCanvasRelationshipTypeId(draftCanvasRelationshipTypeId);
                    setCanvasTool("connect");
                    setPendingConnectionSourceId(null);
                    setCanvasNotice("Relationship mode is ready. Choose a source object.");
                    setCanvasError("");
                    setNewRelationshipModalOpen(false);
                  }}
                >
                  Start connecting
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}


