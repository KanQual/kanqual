import { useEffect, useMemo, useState } from "react";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import {
  listPostgresAttributeValueHistory,
  type PostgresAttributeValueHistoryEntry,
  type PostgresAttributeValueHistoryOwnerKind,
} from "../lib/postgres";
import { SettingsModal } from "./SettingsModal";

export type PostgresAttributeValueHistoryTarget = {
  projectId: string;
  ownerKind: PostgresAttributeValueHistoryOwnerKind;
  ownerId: string;
  ownerName: string;
  attributeDefinitionId: string;
  attributeName: string;
};

function formatAction(action: string, t: ReturnType<typeof useI18n>["t"]): string {
  const normalized = action.trim().toLowerCase();
  if (normalized === "set") return t("sharedModals.attributes.actions.set");
  if (normalized === "clear") return t("sharedModals.attributes.actions.clear");
  if (normalized === "accept") return t("sharedModals.attributes.actions.accept");
  if (normalized === "edit") return t("sharedModals.attributes.actions.edit");
  if (normalized === "reject") return t("sharedModals.attributes.actions.reject");
  return action.trim() || "-";
}

function formatValue(value: string): string {
  return value.trim() ? value : "-";
}

function formatChangedAt(value: string): string {
  if (!value) return "-";
  try {
    return formatCurrentDateTime(value);
  } catch {
    return value;
  }
}

export function PostgresAttributeValueHistoryModal({
  target,
  onClose,
}: {
  target: PostgresAttributeValueHistoryTarget;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<PostgresAttributeValueHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    listPostgresAttributeValueHistory({
      projectId: target.projectId,
      ownerKind: target.ownerKind,
      ownerId: target.ownerId,
      attributeDefinitionId: target.attributeDefinitionId,
    })
      .then((history) => {
        if (!cancelled) setEntries(history);
      })
      .catch((historyError) => {
        if (!cancelled) {
          setError(historyError instanceof Error ? historyError.message : t("sharedModals.attributes.loadHistoryFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t, target.attributeDefinitionId, target.ownerId, target.ownerKind, target.projectId]);

  const ownerLabel = useMemo(() => {
    const kindLabel = target.ownerKind.slice(0, 1).toUpperCase() + target.ownerKind.slice(1);
    return t("sharedModals.attributes.ownerLabel", { kind: kindLabel, name: target.ownerName || target.ownerId });
  }, [t, target.ownerId, target.ownerKind, target.ownerName]);

  return (
    <SettingsModal
      title={t("sharedModals.attributes.historyTitle")}
      subtitle={t("sharedModals.attributes.historySubtitle", { attributeName: target.attributeName, ownerLabel })}
      onClose={onClose}
      modalClassName="modal--wide"
    >
      <div className="app-settings-modal-body">
        {loading ? (
          <p className="case-card-empty">{t("sharedModals.attributes.loadingHistory")}</p>
        ) : error ? (
          <p className="auth-error">{error}</p>
        ) : entries.length === 0 ? (
          <p className="case-card-empty">{t("sharedModals.attributes.emptyHistory")}</p>
        ) : (
          <div className="users-table-wrap attribute-history-table-wrap">
            <table className="users-table attribute-history-table">
              <thead>
                <tr>
                  <th className="users-th attribute-history-col-date">{t("sharedModals.attributes.changed")}</th>
                  <th className="users-th attribute-history-col-action">{t("sharedModals.attributes.action")}</th>
                  <th className="users-th attribute-history-col-value">{t("sharedModals.attributes.previous")}</th>
                  <th className="users-th attribute-history-col-value">{t("sharedModals.attributes.new")}</th>
                  <th className="users-th attribute-history-col-ai">{t("sharedModals.attributes.ai")}</th>
                  <th className="users-th attribute-history-col-user">{t("sharedModals.attributes.user")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="users-row">
                    <td className="users-td users-td--muted">{formatChangedAt(entry.changedAt)}</td>
                    <td className="users-td">{formatAction(entry.aiAssistAction || entry.changeAction, t)}</td>
                    <td className="users-td">{formatValue(entry.previousValue)}</td>
                    <td className="users-td">{formatValue(entry.newValue)}</td>
                    <td className="users-td">{entry.aiAssistRelated ? t("common.yes") : t("common.no")}</td>
                    <td className="users-td users-td--muted">{entry.changedByName || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SettingsModal>
  );
}
