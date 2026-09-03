import type { PostgresCanvasPoint } from "../lib/postgres";
import { useI18n } from "../i18n/provider";

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
  kind: "source" | "object" | "relationship" | "code" | "annotation";
  id: string;
  label: string;
  canvasOnly?: boolean;
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
  deleteLabel?: string;
  deleteDisabledTitle?: string;
}) {
  const { t } = useI18n();
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
    deleteLabel = t("common.delete"),
    deleteDisabledTitle = t("sharedModals.canvas.deleteDisabled"),
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
            {t("sharedModals.canvas.addSource")}
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
            {t("sharedModals.canvas.addObject")}
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
            {t("sharedModals.canvas.addRelationship")}
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
            {t("sharedModals.canvas.addCode")}
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              onClose();
              onEditCanvas();
            }}
          >
            {t("sharedModals.canvas.editTitle")}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="context-menu-item" onClick={() => onViewDetails(menu)}>
            {t("sharedModals.canvas.viewDetails")}
          </button>
          {menu.kind === "annotation" ? (
            <div className="context-menu-item context-menu-item--disabled">{t("common.edit")}</div>
          ) : (
            <button
              type="button"
              className={canEditItem ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
              disabled={!canEditItem}
              onClick={() => onEditItem(menu)}
            >
              {t("common.edit")}
            </button>
          )}
          {menu.timelineGroupId !== undefined ? (
            <button
              type="button"
              className={canRemoveFromGroup ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
              disabled={!canRemoveFromGroup}
              onClick={() => onRemoveFromGroup(menu)}
            >
              {t("sharedModals.canvas.removeFromGroup")}
            </button>
          ) : null}
          {hasDeleteTarget ? (
            <button
              type="button"
              className={canDeleteItems ? "context-menu-item context-menu-item--danger" : "context-menu-item context-menu-item--disabled"}
              disabled={!canDeleteItems}
              title={!canDeleteItems ? deleteDisabledTitle : undefined}
              onClick={() => onDeleteItem(menu)}
            >
              {deleteLabel}
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled">{deleteLabel}</div>
          )}
        </>
      )}
    </div>
  );
}
