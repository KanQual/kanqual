import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core as CytoscapeCore, type ElementDefinition } from "cytoscape";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  POSTGRES_EXPERIMENT_CYTOSCAPE_STYLESHEET,
} from "../lib/postgresExperimentCanvasGraph";
import type {
  PostgresExperimentCanvasNodeState,
  PostgresExperimentObject,
  PostgresExperimentObjectType,
  PostgresExperimentRelationship,
  PostgresExperimentRelationshipType,
} from "../lib/postgresExperiment";

const postgresExperimentExploreElk = new ELK();

async function computePostgresExperimentCanvasAutoLayout({
  objects,
  objectTypes,
  relationships,
  canvasNodes,
  hiddenRelationshipIds,
  getNodeRenderedDimensions,
}: {
  objects: PostgresExperimentObject[];
  objectTypes: PostgresExperimentObjectType[];
  relationships: PostgresExperimentRelationship[];
  canvasNodes: Record<string, PostgresExperimentCanvasNodeState>;
  hiddenRelationshipIds: string[];
  getNodeRenderedDimensions: (
    object: PostgresExperimentObject,
    objectTypeRecord: PostgresExperimentObjectType | null,
    nodeState: PostgresExperimentCanvasNodeState,
  ) => { width: number; height: number };
}): Promise<Record<string, PostgresExperimentCanvasNodeState>> {
  const visibleNodeIds = new Set(Object.keys(canvasNodes));
  if (!visibleNodeIds.size) return canvasNodes;
  const objectTypeById = new Map(objectTypes.map((objectType) => [objectType.id, objectType]));

  const layout = await postgresExperimentExploreElk.layout({
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

export function PostgresExperimentExploreCanvasView({
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
}: {
  objectTypes: PostgresExperimentObjectType[];
  objects: PostgresExperimentObject[];
  relationships: PostgresExperimentRelationship[];
  relationshipTypes: PostgresExperimentRelationshipType[];
  canvasNodes: Record<string, PostgresExperimentCanvasNodeState>;
  setCanvasNodes: Dispatch<SetStateAction<Record<string, PostgresExperimentCanvasNodeState>>>;
  hiddenCanvasRelationshipIds: string[];
  getObjectAppearance: (
    object: PostgresExperimentObject,
    objectTypeRecord: PostgresExperimentObjectType | null,
  ) => {
    shape: "rounded" | "rectangle" | "triangle" | "diamond" | "hexagon" | "octagon" | "parallelogram" | "trapezoid" | "tag" | "star";
    color: string;
    fill: "filled" | "outline";
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
    relationship: PostgresExperimentRelationship,
    relationshipTypeRecord: PostgresExperimentRelationshipType | null,
  ) => {
    color: string;
    lineWeight: number;
    lineShape: "solid" | "dashed" | "dotted";
    arrowhead: "one_sided" | "double_sided" | "none";
  };
  getRelationshipStrokeWidth: (lineWeight: number) => number;
  getNodeDefaultDimensions: (
    object: PostgresExperimentObject,
    objectTypeRecord: PostgresExperimentObjectType | null,
  ) => { width: number; height: number };
  getNodeRenderedDimensions: (
    object: PostgresExperimentObject,
    objectTypeRecord: PostgresExperimentObjectType | null,
    nodeState: PostgresExperimentCanvasNodeState,
  ) => { width: number; height: number };
}) {
  const cyContainerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<CytoscapeCore | null>(null);
  const objectTypeById = useMemo(
    () => new Map(objectTypes.map((objectType) => [objectType.id, objectType])),
    [objectTypes],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [layoutRunning, setLayoutRunning] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const objectById = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  const latestExploreStateRef = useRef({ canvasNodes });
  const relationshipById = useMemo(
    () => new Map(relationships.map((relationship) => [relationship.id, relationship])),
    [relationships],
  );
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
            textMaxWidth: Math.max(72, Math.floor(width * 0.72)),
            width,
            height,
            label: object.objectType.trim() ? `${object.title.trim() || "Untitled object"}\n${object.objectType.trim()}` : (object.title.trim() || "Untitled object"),
          },
          position: { x: nodeState.x + width / 2, y: nodeState.y + height / 2 },
          classes: `canvas-object canvas-object--${appearance.shape}`,
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
              lineStyle: appearance.lineShape,
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

  useEffect(() => {
    latestExploreStateRef.current = { canvasNodes };
  }, [canvasNodes]);

  function buildUpdatedNodes(
    current: Record<string, PostgresExperimentCanvasNodeState>,
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
      const nextCanvasNodes = await computePostgresExperimentCanvasAutoLayout({
        objects,
        objectTypes,
        relationships,
        canvasNodes,
        hiddenRelationshipIds: hiddenCanvasRelationshipIds,
        getNodeRenderedDimensions,
      });
      setCanvasNodes(nextCanvasNodes);
      window.setTimeout(() => {
        cyRef.current?.fit(undefined, 36);
      }, 0);
    } catch (error) {
      setLayoutError(error instanceof Error ? error.message : String(error));
    } finally {
      setLayoutRunning(false);
    }
  }

  useEffect(() => {
    if (!cyContainerRef.current || cyRef.current) return;

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements: graphElements,
      style: POSTGRES_EXPERIMENT_CYTOSCAPE_STYLESHEET,
      layout: { name: "preset" },
      minZoom: 0.3,
      maxZoom: 2.4,
      wheelSensitivity: 0.18,
      selectionType: "single",
      boxSelectionEnabled: false,
    });

    cyRef.current = cy;
    if (graphElements.length > 0) {
      window.setTimeout(() => cy.fit(undefined, 36), 0);
    }

    const handleNodeTap = (event: { target: { id: () => string } }) => {
      setSelectedNodeId(event.target.id());
      setSelectedEdgeId(null);
    };
    const handleEdgeTap = (event: { target: { id: () => string } }) => {
      setSelectedEdgeId(event.target.id());
      setSelectedNodeId(null);
    };
    const handleBackgroundTap = (event: { target: unknown }) => {
      if (event.target !== cy) return;
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    };
    const handleNodeDragFree = (event: { target: { id: () => string; position: () => { x: number; y: number } } }) => {
      const nodeId = event.target.id();
      const position = event.target.position();
      const nodeState = latestExploreStateRef.current.canvasNodes[nodeId];
      if (!nodeState) return;
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
    cy.on("dragfree", "node", handleNodeDragFree);

    return () => {
      cy.removeListener("tap", "node", handleNodeTap);
      cy.removeListener("tap", "edge", handleEdgeTap);
      cy.removeListener("tap", handleBackgroundTap);
      cy.removeListener("dragfree", "node", handleNodeDragFree);
      cy.destroy();
      cyRef.current = null;
    };
  }, [graphElements, setCanvasNodes]);

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
    cy.batch(() => {
      cy.elements().unselect();
      if (selectedNodeId) cy.$id(selectedNodeId).select();
      if (selectedEdgeId) cy.$id(selectedEdgeId).select();
    });
  }, [selectedEdgeId, selectedNodeId]);

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Explore</h1>
          <p className="auth-hint" style={{ margin: "6px 0 0" }}>
            Browse project objects as a navigable relationship graph and re-run auto layout when the structure changes.
          </p>
        </div>
        <div className="view-header-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void handleAutoLayout()}
            disabled={layoutRunning || Object.keys(canvasNodes).length === 0}
          >
            {layoutRunning ? "Laying out..." : "Auto layout"}
          </button>
        </div>
      </header>

      {layoutError ? <p className="users-error">{layoutError}</p> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 18,
          flex: 1,
          minHeight: 0,
        }}
      >
        <section
          style={{
            position: "relative",
            minHeight: 560,
            overflow: "hidden",
            borderRadius: 20,
            border: "1px solid rgba(53, 80, 112, 0.14)",
            background: "radial-gradient(circle at top, rgba(189, 224, 254, 0.18), rgba(255, 255, 255, 0.98) 52%)",
          }}
        >
          <div
            ref={cyContainerRef}
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: [
                "linear-gradient(rgba(53, 80, 112, 0.07) 1px, transparent 1px)",
                "linear-gradient(90deg, rgba(53, 80, 112, 0.07) 1px, transparent 1px)",
              ].join(","),
              backgroundSize: "22px 22px",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              maxWidth: 280,
              padding: 14,
              borderRadius: 18,
              background: "rgba(255, 255, 255, 0.94)",
              border: "1px solid rgba(53, 80, 112, 0.12)",
              boxShadow: "0 18px 36px rgba(53, 80, 112, 0.10)",
              backdropFilter: "blur(10px)",
              zIndex: 2,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#52606d" }}>
              Graph overview
            </div>
            <div className="auth-hint" style={{ marginTop: 8 }}>
              Drag nodes to refine the layout, click a node or link to inspect it, and use auto layout when the graph changes.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
              {[
                { label: "Objects", value: Object.keys(canvasNodes).length },
                { label: "Links", value: relationships.filter((relationship) => (
                  !hiddenCanvasRelationshipIds.includes(relationship.id)
                  && canvasNodes[relationship.fromObjectId]
                  && canvasNodes[relationship.toObjectId]
                )).length },
                { label: "Types", value: objectTypes.length },
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    padding: 10,
                    borderRadius: 14,
                    background: "rgba(53, 80, 112, 0.06)",
                    border: "1px solid rgba(53, 80, 112, 0.08)",
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2933" }}>{stat.value}</div>
                  <div style={{ fontSize: 12, color: "#52606d" }}>{stat.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="btn btn--ghost" onClick={() => cyRef.current?.zoom(Math.min(2.4, (cyRef.current?.zoom() ?? 1) * 1.12))}>
                Zoom in
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => cyRef.current?.zoom(Math.max(0.3, (cyRef.current?.zoom() ?? 1) / 1.12))}>
                Zoom out
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => cyRef.current?.fit(undefined, 36)}>
                Fit
              </button>
            </div>
          </div>
        </section>

        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minHeight: 0,
          }}
        >
          <section className="home-project-card" style={{ gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Inspector</h2>
            {selectedObject ? (
              <>
                <div className="auth-hint">Selected object</div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#52606d" }}>
                  {selectedObject.objectType}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2933" }}>{selectedObject.title}</div>
                <p style={{ margin: 0, color: "#52606d", lineHeight: 1.5 }}>
                  {selectedObject.description || "No description yet."}
                </p>
              </>
            ) : selectedRelationship ? (
              <>
                <div className="auth-hint">Selected relationship</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2933" }}>{selectedRelationship.relationshipType}</div>
                <p style={{ margin: 0, color: "#52606d", lineHeight: 1.5 }}>
                  {selectedRelationship.description || "No description yet."}
                </p>
              </>
            ) : (
              <p style={{ margin: 0, color: "#52606d", lineHeight: 1.5 }}>
                Select an object or relationship to inspect it here.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
