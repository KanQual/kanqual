import { type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core as CytoscapeCore, type ElementDefinition, type NodeSingular } from "cytoscape";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  POSTGRES_SOURCE_DOCUMENT_SILHOUETTE_POLYGON,
  POSTGRES_CYTOSCAPE_STYLESHEET,
} from "../lib/postgresCanvasGraph";
import { FitCornersIcon, LayoutNetworkIcon, MinusIcon, PlusIcon } from "../components/AppIcons";
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
  const visibleNodeIds = new Set(Object.keys(canvasNodes));
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
  onCanvasContextMenu,
  onCanvasSelectionDelete,
  getRelationshipEndpointKey,
  onCanvasRelationshipDraftComplete,
  getInspectorDetails,
  embedded = false,
  fitOnVisibleKey = 0,
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
    fill: "filled" | "outline";
    sourceImage?: string;
    sourceImageWidth?: number;
    sourceImageHeight?: number;
    sourceSilhouettePolygon?: string;
  };
  getObjectSurfaceStyle: (
    color: string,
    fill: "filled" | "outline",
    selected?: boolean,
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
}) {
  const cyContainerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<CytoscapeCore | null>(null);
  const relationshipDraftRef = useRef<PostgresExploreRelationshipDraft | null>(null);
  const relationshipDraftLineRef = useRef<SVGLineElement | null>(null);
  const initialGraphFitDoneRef = useRef(false);
  const pendingViewportRestoreRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  const objectTypeById = useMemo(
    () => new Map(objectTypes.map((objectType) => [objectType.id, objectType])),
    [objectTypes],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [layoutRunning, setLayoutRunning] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [connectorHandle, setConnectorHandle] = useState<PostgresExploreConnectorHandle | null>(null);
  const [relationshipDraft, setRelationshipDraft] = useState<PostgresExploreRelationshipDraft | null>(null);
  const relationshipDraftActive = relationshipDraft !== null;
  const objectById = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  const latestExploreStateRef = useRef({ canvasNodes });
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
  }, [getEndpointKeyForNodeId, onCanvasContextMenu, onCanvasRelationshipDraftComplete]);

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

  useEffect(() => {
    updateConnectorHandleRef.current = updateConnectorHandle;
  }, [updateConnectorHandle]);
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
  const cancelRelationshipDraft = useCallback(() => {
    relationshipDraftRef.current = null;
    setRelationshipDraft(null);
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
  const graphElements = useMemo(
    () => {
      const visibleNodeIds = new Set(Object.keys(canvasNodes));
      const nodes = objects.reduce<ElementDefinition[]>((elements, object) => {
        const nodeState = canvasNodes[object.id];
        if (!nodeState) return elements;
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        const appearance = getObjectAppearance(object, objectTypeRecord);
        const surface = getObjectSurfaceStyle(appearance.color, appearance.fill, false);
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
            backgroundColor: appearance.color,
            backgroundOpacity: isFilled ? 1 : 0,
            borderWidth: isFilled ? 2 : 3,
            shadowColor: appearance.color,
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
      setCanvasNodes(nextCanvasNodes);
    } catch (error) {
      setLayoutError(error instanceof Error ? error.message : String(error));
    } finally {
      setLayoutRunning(false);
    }
  }

  function handleZoomIn() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: Math.min(2.4, cy.zoom() * 1.12),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  }

  function handleZoomOut() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: Math.max(0.3, cy.zoom() / 1.12),
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
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
      minZoom: 0.3,
      maxZoom: 2.4,
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
    const handleCanvasViewportChange = () => updateConnectorHandleRef.current();

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
  }, [cancelRelationshipDraft, setCanvasNodes]);

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
          updateConnectorHandleRef.current();
        });
      });
      return;
    }
    cy.zoom(previousZoom);
    cy.pan(previousPan);
    requestAnimationFrame(() => {
      cy.resize();
      updateConnectorHandleRef.current();
    });
  }, [graphElements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !embedded) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cy.resize();
        updateConnectorHandleRef.current();
      });
    });
  }, [embedded]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !embedded || fitOnVisibleKey <= 0) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitPostgresExploreCanvas(cy, 36);
        updateConnectorHandleRef.current();
      });
    });
  }, [embedded, fitOnVisibleKey]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().unselect();
      if (selectedNodeId) cy.$id(selectedNodeId).select();
      if (selectedEdgeId) cy.$id(selectedEdgeId).select();
    });
    updateConnectorHandle();
  }, [selectedEdgeId, selectedNodeId, updateConnectorHandle]);

  useEffect(() => {
    updateConnectorHandle();
  }, [graphElements, updateConnectorHandle]);

  useEffect(() => {
    if (!relationshipDraftActive) updateConnectorHandle();
  }, [relationshipDraftActive, updateConnectorHandle]);

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
  }, [cancelRelationshipDraft, onCanvasSelectionDelete, relationshipDraftActive, selectedEdgeId, selectedNodeId]);

  return (
    <div className={`view users-view postgres-explore-canvas-view${embedded ? " postgres-explore-canvas-view--embedded" : ""}`}>
      {!embedded ? (
        <header className="view-header">
          <div className="users-title-wrap">
            <h1>Explore</h1>
            <p className="auth-hint" style={{ margin: "6px 0 0" }}>
              Browse project objects as a navigable relationship graph and re-run auto layout when the structure changes.
            </p>
          </div>
        </header>
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
          {embedded && (selectedObject || selectedRelationship) ? (
            <div className="postgres-explore-inspector-overlay">
              {inspectorCard}
            </div>
          ) : null}
          <div className="postgres-explore-canvas-controls" aria-label="Canvas controls">
            {controlStart}
            <button type="button" className="btn btn--ghost" onClick={handleZoomIn} aria-label="Zoom in" title="Zoom in">
              <PlusIcon className="postgres-explore-canvas-control-icon" />
            </button>
            <button type="button" className="btn btn--ghost" onClick={handleZoomOut} aria-label="Zoom out" title="Zoom out">
              <MinusIcon className="postgres-explore-canvas-control-icon" />
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                const cy = cyRef.current;
                if (!cy) return;
                fitPostgresExploreCanvas(cy, 36);
                updateConnectorHandleRef.current();
              }}
              aria-label="Fit canvas"
              title="Fit canvas"
            >
              <FitCornersIcon className="postgres-explore-canvas-control-icon" />
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void handleAutoLayout()}
              disabled={layoutRunning || Object.keys(canvasNodes).length === 0}
              aria-label={layoutRunning ? "Auto layout running" : "Auto layout"}
              title={layoutRunning ? "Auto layout running" : "Auto layout"}
            >
              <LayoutNetworkIcon className="postgres-explore-canvas-control-icon" />
            </button>
          </div>
        </section>

        {!embedded ? (
          <aside className="postgres-explore-inspector-sidebar">
            {inspectorCard}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
