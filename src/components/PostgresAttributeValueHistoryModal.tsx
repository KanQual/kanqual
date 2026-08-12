import { useEffect, useMemo, useState } from "react";
import { formatCurrentDateTime } from "../i18n/formatters";
import {
  listPostgresAttributeValueHistory,
  type PostgresAttributeValueHistoryEntry,
  type PostgresAttributeValueHistoryOwnerKind,
} from "../lib/postgres";

export type PostgresAttributeValueHistoryTarget = {
  projectId: string;
  ownerKind: PostgresAttributeValueHistoryOwnerKind;
  ownerId: string;
  ownerName: string;
  attributeDefinitionId: string;
  attributeName: string;
};

function formatAction(action: string): string {
  const normalized = action.trim().toLowerCase();
  if (normalized === "set") return "Set";
  if (normalized === "clear") return "Cleared";
  if (normalized === "accept") return "Accepted";
  if (normalized === "edit") return "Edited";
  if (normalized === "reject") return "Rejected";
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
          setError(historyError instanceof Error ? historyError.message : "Failed to load attribute value history.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target.attributeDefinitionId, target.ownerId, target.ownerKind, target.projectId]);

  const ownerLabel = useMemo(() => {
    const kindLabel = target.ownerKind.slice(0, 1).toUpperCase() + target.ownerKind.slice(1);
    return `${kindLabel}: ${target.ownerName || target.ownerId}`;
  }, [target.ownerId, target.ownerKind, target.ownerName]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-title-bar">
          <div>
            <h2>Attribute value history</h2>
        <p className="auth-hint" style={{ marginTop: 0 }}>
          {target.attributeName} · {ownerLabel}
            </p>
          </div>
          <button
            type="button"
            className="modal-icon-close"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            x
          </button>
        </div>

        {loading ? (
          <p className="case-card-empty">Loading history...</p>
        ) : error ? (
          <p className="auth-error">{error}</p>
        ) : entries.length === 0 ? (
          <p className="case-card-empty">No changes have been recorded for this value yet.</p>
        ) : (
          <div className="users-table-wrap attribute-history-table-wrap">
            <table className="users-table attribute-history-table">
              <thead>
                <tr>
                  <th className="users-th attribute-history-col-date">Changed</th>
                  <th className="users-th attribute-history-col-action">Action</th>
                  <th className="users-th attribute-history-col-value">Previous</th>
                  <th className="users-th attribute-history-col-value">New</th>
                  <th className="users-th attribute-history-col-ai">AI</th>
                  <th className="users-th attribute-history-col-user">User</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="users-row">
                    <td className="users-td users-td--muted">{formatChangedAt(entry.changedAt)}</td>
                    <td className="users-td">{formatAction(entry.aiAssistAction || entry.changeAction)}</td>
                    <td className="users-td">{formatValue(entry.previousValue)}</td>
                    <td className="users-td">{formatValue(entry.newValue)}</td>
                    <td className="users-td">{entry.aiAssistRelated ? "Yes" : "No"}</td>
                    <td className="users-td users-td--muted">{entry.changedByName || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}
