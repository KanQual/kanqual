import type { PostgresCanvasPoint } from "../lib/postgres";

export type PostgresHomeCanvasContextKind = "background" | "source" | "object" | "relationship" | "code" | "annotation";

export type PostgresHomeCanvasContextMenuState = {
  kind: PostgresHomeCanvasContextKind;
  id: string | null;
  x: number;
  y: number;
  canvasPosition: PostgresCanvasPoint | null;
  timelineGroupId?: string;
};

export type PostgresHomeCanvasDeleteTarget = {
  kind: "source" | "object" | "relationship" | "code";
  id: string;
  label: string;
};

export function PostgresHomeCanvasContextMenu(props: {
  menu: PostgresHomeCanvasContextMenuState;
  canManageSources: boolean;
  canManageAnnotations: boolean;
  canDeleteItems: boolean;
  hasDeleteTarget: boolean;
  onClose: () => void;
  onCreateSource: () => void;
  onCreateObject: (preferredPosition?: PostgresCanvasPoint) => void;
  onCreateRelationship: () => void;
  onCreateCode: () => void;
  onEditCanvas: () => void;
  onViewDetails: (menu: PostgresHomeCanvasContextMenuState) => void;
  onEditItem: (menu: PostgresHomeCanvasContextMenuState) => void;
  onRemoveFromGroup: (menu: PostgresHomeCanvasContextMenuState) => void;
  onDeleteItem: (menu: PostgresHomeCanvasContextMenuState) => void;
}) {
  const {
    menu,
    canManageSources,
    canManageAnnotations,
    canDeleteItems,
    hasDeleteTarget,
    onClose,
    onCreateSource,
    onCreateObject,
    onCreateRelationship,
    onCreateCode,
    onEditCanvas,
    onViewDetails,
    onEditItem,
    onRemoveFromGroup,
    onDeleteItem,
  } = props;
  const canEditItem = menu.kind === "code" ? canManageAnnotations : canManageSources;
  const canRemoveFromGroup = canManageSources && menu.timelineGroupId?.startsWith("group:");

  return (
    <div
      className="context-menu"
      data-home-canvas-context-menu
      role="menu"
      style={{ left: menu.x, top: menu.y, minWidth: 174 }}
    >
      {menu.kind === "background" ? (
        <>
          <button
            type="button"
            className={canManageSources ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
            disabled={!canManageSources}
            onClick={() => {
              onClose();
              onCreateSource();
            }}
          >
            Add source
          </button>
          <button
            type="button"
            className={canManageSources ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
            disabled={!canManageSources}
            onClick={() => {
              const preferredPosition = menu.canvasPosition ?? undefined;
              onClose();
              onCreateObject(preferredPosition);
            }}
          >
            Add object
          </button>
          <button
            type="button"
            className={canManageSources ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
            disabled={!canManageSources}
            onClick={() => {
              onClose();
              onCreateRelationship();
            }}
          >
            Add relationship
          </button>
          <button
            type="button"
            className={canManageAnnotations ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
            disabled={!canManageAnnotations}
            onClick={() => {
              onClose();
              onCreateCode();
            }}
          >
            Add code
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              onClose();
              onEditCanvas();
            }}
          >
            Edit canvas
          </button>
        </>
      ) : (
        <>
          <button type="button" className="context-menu-item" onClick={() => onViewDetails(menu)}>
            View details
          </button>
          {menu.kind === "annotation" ? (
            <div className="context-menu-item context-menu-item--disabled">Edit</div>
          ) : (
            <button
              type="button"
              className={canEditItem ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
              disabled={!canEditItem}
              onClick={() => onEditItem(menu)}
            >
              Edit
            </button>
          )}
          {menu.timelineGroupId !== undefined ? (
            <button
              type="button"
              className={canRemoveFromGroup ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
              disabled={!canRemoveFromGroup}
              onClick={() => onRemoveFromGroup(menu)}
            >
              Remove from group
            </button>
          ) : null}
          {hasDeleteTarget ? (
            <button
              type="button"
              className={canDeleteItems ? "context-menu-item context-menu-item--danger" : "context-menu-item context-menu-item--disabled"}
              disabled={!canDeleteItems}
              title={!canDeleteItems ? "Coders and viewers cannot delete canvas items." : undefined}
              onClick={() => onDeleteItem(menu)}
            >
              Delete
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled">Delete</div>
          )}
        </>
      )}
    </div>
  );
}
