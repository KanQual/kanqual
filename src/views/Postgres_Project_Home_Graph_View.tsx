import {
  type Dispatch,
  type RefObject,
  type ReactNode,
  type SetStateAction,
  Suspense,
  lazy,
} from "react";
import { FilterIcon } from "../components/FilterIcon";
import { CodeIcon, FitCornersIcon, ObjectIcon, PlusIcon, RelationshipIcon, SourceIcon } from "../components/AppIcons";
import type {
  PostgresCanvasNodeState,
  PostgresObject,
  PostgresObjectType,
  PostgresRelationship,
  PostgresRelationshipType,
} from "../lib/postgres";

const PostgresExploreCanvasViewLazy = lazy(
  () => import("./Postgres_Explore_Canvas_View").then((m) => ({ default: m.PostgresExploreCanvasView })),
);

type ProjectHomeCanvasRow = {
  id: string;
  label: string;
  count: number;
  selected: boolean;
  indent?: boolean;
  onClick?: () => void;
};

type ProjectHomeCanvasSizeRow = {
  id: string;
  label: string;
  count: number;
  nodeIds: string[];
  sizePercent: number;
};

type ProjectHomeCanvasSectionKey = "sources" | "objects" | "relationships" | "codes" | "annotations";
type ProjectHomeCanvasSizeSectionKey = "sources" | "objects" | "codes";
type PostgresRelationshipLineShape =
  | "solid"
  | "dashed"
  | "long_dashed"
  | "short_dashed"
  | "dotted"
  | "loose_dotted"
  | "dash_dot"
  | "dash_dot_dot";

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

type PostgresExploreSelection =
  | {
      kind: "object";
      object: PostgresObject;
      objectTypeRecord: PostgresObjectType | null;
    }
  | {
      kind: "relationship";
      relationship: PostgresRelationship;
      relationshipTypeRecord: PostgresRelationshipType | null;
    };

function ProjectHomeCanvasSelectorCard({
  title,
  count,
  collapsed,
  rows,
  onToggleCollapsed,
  onSelectAll,
  onClear,
  emptyText,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  rows: ProjectHomeCanvasRow[];
  onToggleCollapsed: () => void;
  onSelectAll?: () => void;
  onClear?: () => void;
  emptyText: string;
}) {
  return (
    <section className="home-project-card project-home-selector-card">
      <div
        className="annotate-card-header project-home-selector-card-header"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleCollapsed();
          }
        }}
      >
        <button
          type="button"
          className="project-home-selector-card-title-btn"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed();
          }}
          aria-expanded={!collapsed}
        >
          <span className="annotate-card-title">{title}</span>
          <span className="project-home-selector-count">{count}</span>
        </button>
        <div className="project-home-selector-header-actions">
          <button
            type="button"
            className="project-home-selector-collapse-btn"
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          >
            {collapsed ? "▶" : "▼"}
          </button>
        </div>
      </div>
      {!collapsed ? (
        <>
          {(onSelectAll || onClear) && rows.length > 0 ? (
            <div className="project-home-selector-actions">
              {onSelectAll ? <button type="button" className="btn" onClick={onSelectAll}>All</button> : null}
              {onClear ? <button type="button" className="btn" onClick={onClear}>Clear</button> : null}
            </div>
          ) : null}
          <div className="users-table-wrap project-home-selector-table-wrap">
            <table className="users-table project-home-selector-table">
              <thead>
                <tr>
                  <th className="users-th" style={{ width: "72%" }}>Name</th>
                  <th className="users-th" style={{ width: "28%" }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td className="users-td-msg" colSpan={2}>{emptyText}</td>
                  </tr>
                ) : rows.map((row) => (
                  <tr
                    key={row.id}
                    className="users-row"
                    style={{ background: row.selected ? "rgba(53, 80, 112, 0.10)" : undefined }}
                    onClick={row.onClick}
                  >
                    <td className="users-td users-td--name" style={{ paddingLeft: row.indent ? 28 : undefined }}>
                      {row.label}
                    </td>
                    <td className="users-td users-td--muted">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

function ProjectHomeCanvasSizeSection({
  title,
  count,
  collapsed,
  rows,
  onToggleCollapsed,
  onResize,
  emptyText,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  rows: ProjectHomeCanvasSizeRow[];
  onToggleCollapsed: () => void;
  onResize: (nodeIds: string[], scale: number) => void;
  emptyText: string;
}) {
  return (
    <section className="home-project-card project-home-selector-card project-home-size-section">
      <div
        className="annotate-card-header project-home-selector-card-header"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleCollapsed();
          }
        }}
      >
        <button
          type="button"
          className="project-home-selector-card-title-btn"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed();
          }}
          aria-expanded={!collapsed}
        >
          <span className="annotate-card-title">{title}</span>
          <span className="project-home-selector-count">{count}</span>
        </button>
        <div className="project-home-selector-header-actions">
          <button
            type="button"
            className="project-home-selector-collapse-btn"
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          >
            {collapsed ? "▶" : "▼"}
          </button>
        </div>
      </div>
      {!collapsed ? (
        <div className="users-table-wrap project-home-selector-table-wrap">
          <table className="users-table project-home-selector-table project-home-size-table">
            <thead>
              <tr>
                <th className="users-th" style={{ width: "52%" }}>Name</th>
                <th className="users-th" style={{ width: "16%" }}>Count</th>
                <th className="users-th" style={{ width: "32%" }}>Size</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="users-td-msg" colSpan={3}>{emptyText}</td>
                </tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="users-row">
                  <td className="users-td users-td--name">{row.label}</td>
                  <td className="users-td users-td--muted">{row.count}</td>
                  <td className="users-td">
                    <div className="project-home-size-slider-wrap" onClick={(event) => event.stopPropagation()}>
                      <input
                        className="project-home-size-slider"
                        type="range"
                        min={10}
                        max={300}
                        step={5}
                        value={row.sizePercent}
                        onChange={(event) => onResize(row.nodeIds, Number(event.target.value) / 100)}
                        aria-label={`Resize ${row.label}`}
                      />
                      <span className="project-home-size-slider-value">{row.sizePercent}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function PostgresProjectHomeGraphView({
  createControlRef,
  filterControlRef,
  sizeControlRef,
  createMenuOpen,
  setCreateMenuOpen,
  filterDrawerOpen,
  setFilterDrawerOpen,
  sizeMenuOpen,
  setSizeMenuOpen,
  graphLoading,
  canvasStateLoaded,
  loadingFallback,
  canManageSources,
  canManageAnnotations,
  onCreateSource,
  onCreateObject,
  onCreateRelationship,
  onCreateCode,
  objectTypes,
  homeCanvasVirtualObjectTypes,
  homeCanvasObjects,
  homeCanvasRelationships,
  homeCanvasRelationshipTypes,
  canvasNodes,
  setCanvasNodes,
  hiddenCanvasRelationshipIds,
  getObjectAppearance,
  getObjectSurfaceStyle,
  getRelationshipAppearance,
  getRelationshipStrokeWidth,
  getNodeDefaultDimensions,
  getNodeRenderedDimensions,
  getInspectorDetails,
  onCanvasContextMenu,
  onCanvasSelectionDelete,
  getRelationshipEndpointKey,
  onCanvasRelationshipDraftComplete,
  fitOnVisibleKey,
  filteringActive,
  collapsedSections,
  sourceRows,
  objectRows,
  relationshipRows,
  codeRows,
  sourceCount,
  objectCount,
  relationshipCount,
  codeCount,
  onToggleCollapsedSection,
  showSection,
  clearSection,
  setSourceKinds,
  setObjectTypeIds,
  setRelationshipTypeIds,
  setCodeIds,
  customSizesActive,
  resetAllNodeSizes,
  sizeGroupCount,
  sizeCollapsedSections,
  sourceSizeRows,
  objectSizeRows,
  codeSizeRows,
  onToggleSizeSectionCollapsed,
  onResizeNodeGroup,
}: {
  createControlRef: RefObject<HTMLDivElement | null>;
  filterControlRef: RefObject<HTMLDivElement | null>;
  sizeControlRef: RefObject<HTMLDivElement | null>;
  createMenuOpen: boolean;
  setCreateMenuOpen: Dispatch<SetStateAction<boolean>>;
  filterDrawerOpen: boolean;
  setFilterDrawerOpen: Dispatch<SetStateAction<boolean>>;
  sizeMenuOpen: boolean;
  setSizeMenuOpen: Dispatch<SetStateAction<boolean>>;
  graphLoading: boolean;
  canvasStateLoaded: boolean;
  loadingFallback: ReactNode;
  canManageSources: boolean;
  canManageAnnotations: boolean;
  onCreateSource: () => void;
  onCreateObject: () => void;
  onCreateRelationship: () => void;
  onCreateCode: () => void;
  objectTypes: PostgresObjectType[];
  homeCanvasVirtualObjectTypes: PostgresObjectType[];
  homeCanvasObjects: PostgresObject[];
  homeCanvasRelationships: PostgresRelationship[];
  homeCanvasRelationshipTypes: PostgresRelationshipType[];
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
  getInspectorDetails: (selection: PostgresExploreSelection) => PostgresExploreInspectorDetails;
  onCanvasContextMenu: (context: {
    kind: "background" | "node" | "edge";
    id: string | null;
    clientX: number;
    clientY: number;
    canvasPosition: { x: number; y: number } | null;
  }) => void;
  onCanvasSelectionDelete?: (context: { kind: "node" | "edge"; id: string }) => void;
  getRelationshipEndpointKey: (context: {
    object: PostgresObject;
    objectTypeRecord: PostgresObjectType | null;
  }) => string | null;
  onCanvasRelationshipDraftComplete: (context: { fromEndpointKey: string; toEndpointKey: string }) => void;
  fitOnVisibleKey: number;
  filteringActive: boolean;
  collapsedSections: Set<ProjectHomeCanvasSectionKey>;
  sourceRows: ProjectHomeCanvasRow[];
  objectRows: ProjectHomeCanvasRow[];
  relationshipRows: ProjectHomeCanvasRow[];
  codeRows: ProjectHomeCanvasRow[];
  sourceCount: number;
  objectCount: number;
  relationshipCount: number;
  codeCount: number;
  onToggleCollapsedSection: (section: ProjectHomeCanvasSectionKey) => void;
  showSection: (section: ProjectHomeCanvasSectionKey) => void;
  clearSection: (section: ProjectHomeCanvasSectionKey) => void;
  setSourceKinds: Dispatch<SetStateAction<Set<string>>>;
  setObjectTypeIds: Dispatch<SetStateAction<Set<string>>>;
  setRelationshipTypeIds: Dispatch<SetStateAction<Set<string>>>;
  setCodeIds: Dispatch<SetStateAction<Set<string>>>;
  customSizesActive: boolean;
  resetAllNodeSizes: () => void;
  sizeGroupCount: number;
  sizeCollapsedSections: Set<ProjectHomeCanvasSizeSectionKey>;
  sourceSizeRows: ProjectHomeCanvasSizeRow[];
  objectSizeRows: ProjectHomeCanvasSizeRow[];
  codeSizeRows: ProjectHomeCanvasSizeRow[];
  onToggleSizeSectionCollapsed: (section: ProjectHomeCanvasSizeSectionKey) => void;
  onResizeNodeGroup: (nodeIds: string[], scale: number) => void;
}) {
  const renderGraphCreateControl = () => (
    <div className="project-home-canvas-create-control project-home-canvas-create-control--dock" ref={createControlRef}>
      <button
        type="button"
        className="btn btn--primary project-home-canvas-create-main"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setCreateMenuOpen((current) => !current);
        }}
        aria-expanded={createMenuOpen}
        aria-label={createMenuOpen ? "Close create menu" : "Create project item"}
      >
        <PlusIcon className="project-home-canvas-create-icon" />
      </button>
      {createMenuOpen ? (
        <div className="project-home-canvas-create-menu" role="menu">
          <button
            type="button"
            className="btn project-home-canvas-create-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCreateSource();
            }}
            disabled={!canManageSources}
            aria-label="Add source"
            title="Source"
          >
            <SourceIcon className="project-home-canvas-create-action-icon" />
          </button>
          <button
            type="button"
            className="btn project-home-canvas-create-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCreateObject();
            }}
            disabled={!canManageSources}
            aria-label="Add object"
            title="Object"
          >
            <ObjectIcon className="project-home-canvas-create-action-icon" />
          </button>
          <button
            type="button"
            className="btn project-home-canvas-create-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCreateRelationship();
            }}
            disabled={!canManageSources}
            aria-label="Add relationship"
            title="Relationship"
          >
            <RelationshipIcon className="project-home-canvas-create-action-icon" />
          </button>
          <button
            type="button"
            className="btn project-home-canvas-create-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCreateCode();
            }}
            disabled={!canManageAnnotations}
            aria-label="Add code"
            title="Code"
          >
            <CodeIcon className="project-home-canvas-create-action-icon" />
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="home-dashboard postgres-experiment-home-dashboard">
      <div className="postgres-experiment-home-canvas-column">
        {graphLoading && !canvasStateLoaded ? (
          loadingFallback
        ) : (
          <Suspense fallback={loadingFallback}>
            <PostgresExploreCanvasViewLazy
              objectTypes={[...objectTypes, ...homeCanvasVirtualObjectTypes]}
              objects={homeCanvasObjects}
              relationships={homeCanvasRelationships}
              relationshipTypes={homeCanvasRelationshipTypes}
              canvasNodes={canvasNodes}
              setCanvasNodes={setCanvasNodes}
              hiddenCanvasRelationshipIds={hiddenCanvasRelationshipIds}
              getObjectAppearance={getObjectAppearance}
              getObjectSurfaceStyle={getObjectSurfaceStyle}
              getRelationshipAppearance={getRelationshipAppearance}
              getRelationshipStrokeWidth={getRelationshipStrokeWidth}
              getNodeDefaultDimensions={getNodeDefaultDimensions}
              getNodeRenderedDimensions={getNodeRenderedDimensions}
              getInspectorDetails={getInspectorDetails}
              onCanvasContextMenu={onCanvasContextMenu}
              onCanvasSelectionDelete={onCanvasSelectionDelete}
              getRelationshipEndpointKey={getRelationshipEndpointKey}
              onCanvasRelationshipDraftComplete={onCanvasRelationshipDraftComplete}
              fitOnVisibleKey={fitOnVisibleKey}
              controlStart={(
                <>
                  {renderGraphCreateControl()}
                  <div className="project-home-canvas-filter-control" ref={filterControlRef}>
                    <button
                      type="button"
                      className={`btn ${filteringActive ? "btn--primary" : "btn--ghost"}`}
                      onClick={() => setFilterDrawerOpen((current) => !current)}
                      aria-expanded={filterDrawerOpen}
                      aria-label={filterDrawerOpen ? "Hide canvas filters" : "Show canvas filters"}
                      title="Canvas filters"
                    >
                      <FilterIcon className="postgres-explore-canvas-control-icon" />
                    </button>
                    {filterDrawerOpen ? (
                      <div className="project-home-filter-drawer">
                        <div className="home-primary-column postgres-experiment-home-primary-column project-home-selector-column project-home-selector-column--drawer">
                          <ProjectHomeCanvasSelectorCard
                            title="Sources"
                            count={sourceCount}
                            collapsed={collapsedSections.has("sources")}
                            rows={sourceRows}
                            onToggleCollapsed={() => onToggleCollapsedSection("sources")}
                            onSelectAll={() => {
                              showSection("sources");
                              setSourceKinds(new Set());
                            }}
                            onClear={() => {
                              clearSection("sources");
                              setSourceKinds(new Set(["__none"]));
                            }}
                            emptyText="No sources yet."
                          />
                          <ProjectHomeCanvasSelectorCard
                            title="Objects"
                            count={objectCount}
                            collapsed={collapsedSections.has("objects")}
                            rows={objectRows}
                            onToggleCollapsed={() => onToggleCollapsedSection("objects")}
                            onSelectAll={() => {
                              showSection("objects");
                              setObjectTypeIds(new Set());
                            }}
                            onClear={() => {
                              clearSection("objects");
                              setObjectTypeIds(new Set(["__none"]));
                            }}
                            emptyText="No objects yet."
                          />
                          <ProjectHomeCanvasSelectorCard
                            title="Relationships"
                            count={relationshipCount}
                            collapsed={collapsedSections.has("relationships")}
                            rows={relationshipRows}
                            onToggleCollapsed={() => onToggleCollapsedSection("relationships")}
                            onSelectAll={() => {
                              showSection("relationships");
                              setRelationshipTypeIds(new Set());
                            }}
                            onClear={() => {
                              clearSection("relationships");
                              setRelationshipTypeIds(new Set(["__none"]));
                            }}
                            emptyText="No relationships yet."
                          />
                          <ProjectHomeCanvasSelectorCard
                            title="Codes"
                            count={codeCount}
                            collapsed={collapsedSections.has("codes")}
                            rows={codeRows}
                            onToggleCollapsed={() => onToggleCollapsedSection("codes")}
                            onSelectAll={() => {
                              showSection("codes");
                              setCodeIds(new Set());
                            }}
                            onClear={() => {
                              clearSection("codes");
                              setCodeIds(new Set(["__none"]));
                            }}
                            emptyText="No codes yet."
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="project-home-canvas-size-control" ref={sizeControlRef}>
                    <button
                      type="button"
                      className={`btn ${customSizesActive ? "btn--primary" : "btn--ghost"}`}
                      onClick={() => setSizeMenuOpen((current) => !current)}
                      aria-expanded={sizeMenuOpen}
                      aria-label={sizeMenuOpen ? "Hide size controls" : "Show size controls"}
                      title="Canvas item sizes"
                    >
                      <FitCornersIcon className="postgres-explore-canvas-control-icon" />
                    </button>
                    {sizeMenuOpen ? (
                      <div className="project-home-size-menu">
                        <div className="project-home-size-menu-header">
                          <div className="project-home-size-menu-title">Item Sizes</div>
                          <button
                            type="button"
                            className="btn btn--ghost project-home-size-reset-btn"
                            onClick={resetAllNodeSizes}
                            disabled={!customSizesActive}
                          >
                            Reset all
                          </button>
                        </div>
                        {sizeGroupCount === 0 ? (
                          <div className="project-home-size-menu-empty">No visible items.</div>
                        ) : (
                          <div className="home-primary-column postgres-experiment-home-primary-column project-home-selector-column project-home-selector-column--drawer project-home-size-section-column">
                            <ProjectHomeCanvasSizeSection
                              title="Sources"
                              count={sourceSizeRows.reduce((total, row) => total + row.count, 0)}
                              collapsed={sizeCollapsedSections.has("sources")}
                              rows={sourceSizeRows}
                              onToggleCollapsed={() => onToggleSizeSectionCollapsed("sources")}
                              onResize={onResizeNodeGroup}
                              emptyText="No visible sources."
                            />
                            <ProjectHomeCanvasSizeSection
                              title="Objects"
                              count={objectSizeRows.reduce((total, row) => total + row.count, 0)}
                              collapsed={sizeCollapsedSections.has("objects")}
                              rows={objectSizeRows}
                              onToggleCollapsed={() => onToggleSizeSectionCollapsed("objects")}
                              onResize={onResizeNodeGroup}
                              emptyText="No visible objects."
                            />
                            <ProjectHomeCanvasSizeSection
                              title="Codes"
                              count={codeSizeRows.reduce((total, row) => total + row.count, 0)}
                              collapsed={sizeCollapsedSections.has("codes")}
                              rows={codeSizeRows}
                              onToggleCollapsed={() => onToggleSizeSectionCollapsed("codes")}
                              onResize={onResizeNodeGroup}
                              emptyText="No visible codes."
                            />
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
              embedded
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
