import { Fragment, useMemo, useState } from "react";
import { useStore } from "../context/StoreContext";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import type { ProjectLogEntry } from "../types";

export const PROJECT_LOG_ACTION_LABELS: Record<string, string> = {
  "project.create":      "Project created",
  "project.open":        "Project opened",
  "project.close":       "Project left",
  "project.update":      "Project updated",
  "project.export":      "Project exported",
  "project.encrypted_backup.export": "Encrypted project backup exported",
  "project.log.export":  "Project log exported",
  "project.import":      "Project imported",
  "project.encrypted_backup.import": "Encrypted project backup imported",
  "project.restore_backup": "Project restored from backup",
  "project.snapshot.create": "Project snapshot created",
  "project.snapshot.settings": "Project snapshot settings updated",
  "project.snapshot.delete": "Project snapshot deleted",
  "project.backup.create": "Project snapshot created",
  "project.backup.settings": "Project snapshot settings updated",
  "project.backup.delete": "Project snapshot deleted",
  "project.network_mode.update": "LAN mode updated",
  "auth.login": "Signed in",
  "auth.logout": "Signed out",
  "auth.register": "Account registered",
  "project.ai_assist.update": "Project AI Assist updated",
  "project.canvas.update": "Project canvas updated",
  "project.ai_chat.message": "AI chat message sent",
  "project.ai_chat.response": "AI chat response received",
  "project.ai_assist.embeddings.delete": "Project AI Assist embeddings deleted",
  "project.ai_processed_document.export": "Processed document exported",
  "project_uploaded_file.create": "Retained source file created",
  "project_uploaded_file.delete": "Original file deleted",
  "project_uploaded_file.status": "Retained source file updated",
  "codebook.export":     "Codebook exported",
  "codebook.import":     "Codebook imported",
  "ai_assist.index":     "AI Assist embeddings built",
  "ai_assist.reindex":   "AI Assist embeddings rebuilt",
  "source.create":       "Source added",
  "source.update":       "Source updated",
  "source.delete":       "Source deleted",
  "source.restore":      "Source restored",
  "source.associations": "Source associations updated",
  "code.create":         "Code added",
  "code.update":         "Code updated",
  "code.delete":         "Code deleted",
  "code.restore":        "Code restored",
  "annotation.create":   "Annotation added",
  "annotation.update":   "Annotation updated",
  "annotation.delete":   "Annotation deleted",
  "annotation.restore":  "Annotation restored",
  "case.create":         "Case created",
  "case.update":         "Case updated",
  "case.delete":         "Case deleted",
  "case.restore":        "Case restored",
  "case.associations":   "Case associations updated",
  "case_attribute.create": "Case attribute added",
  "case_attribute.update": "Case attribute updated",
  "case_attribute.delete": "Case attribute deleted",
  "document_attribute.create": "Source attribute added",
  "document_attribute.update": "Source attribute updated",
  "document_attribute.delete": "Source attribute deleted",
  "object_type.create": "Object type added",
  "object_type.update": "Object type updated",
  "object_type.delete": "Object type deleted",
  "object.create": "Object added",
  "object.update": "Object updated",
  "object.delete": "Object deleted",
  "relationship_type.create": "Relationship type added",
  "relationship_type.update": "Relationship type updated",
  "relationship_type.delete": "Relationship type deleted",
  "relationship.create": "Relationship added",
  "relationship.update": "Relationship updated",
  "relationship.delete": "Relationship deleted",
  "saved_drawing.create": "Drawing saved",
  "saved_drawing.update": "Drawing updated",
  "saved_drawing.delete": "Drawing deleted",
  "memo.create":         "Memo created",
  "memo.update":         "Memo updated",
  "memo.delete":         "Memo deleted",
  "memo.restore":        "Memo restored",
  "code_report.create":  "Report created",
  "code_report.update":  "Report updated",
  "code_report.delete":  "Report deleted",
  "code_report.restore": "Report restored",
  "coder_report.create": "Coder report created",
  "coder_report.update": "Coder report updated",
  "coder_report.delete": "Coder report deleted",
  "coder_report.restore": "Coder report restored",
  "report.create": "Report created",
  "report.update": "Report updated",
  "report.delete": "Report deleted",
  "report.export": "Report exported",
  "ai_analysis.create": "AI analysis created",
  "ai_analysis.update": "AI analysis updated",
  "ai_analysis.delete": "AI analysis deleted",
  "ai_attribute_suggestion_run.create": "Saved suggestions created",
  "ai_attribute_suggestion_run.update": "Saved suggestions updated",
  "ai_attribute_suggestion_run.delete": "Saved suggestions deleted",
  "member.add":          "Member added",
  "member.update":       "Member updated",
  "member.remove":       "Member removed",
  "member.reassociate":  "Imported member reassociated",
  "member.remove_unresolved": "Imported member removed",
  "presence.inactive": "Inactive",
};

export function projectLogActionLabel(action: string, t: ReturnType<typeof useI18n>["t"]): string {
  switch (action) {
    case "project.create": return t("projectLog.actions.projectCreate");
    case "project.open": return t("projectLog.actions.projectOpen");
    case "project.close": return t("projectLog.actions.projectClose");
    case "project.update": return t("projectLog.actions.projectUpdate");
    case "project.export": return t("projectLog.actions.projectExport");
    case "project.encrypted_backup.export": return t("projectLog.actions.projectEncryptedBackupExport");
    case "project.log.export": return t("projectLog.actions.projectLogExport");
    case "project.import": return t("projectLog.actions.projectImport");
    case "project.encrypted_backup.import": return t("projectLog.actions.projectEncryptedBackupImport");
    case "project.restore_backup": return t("projectLog.actions.projectRestoreBackup");
    case "project.snapshot.create":
    case "project.backup.create":
      return t("projectLog.actions.projectSnapshotCreate");
    case "project.snapshot.settings":
    case "project.backup.settings":
      return t("projectLog.actions.projectSnapshotSettings");
    case "project.snapshot.delete":
    case "project.backup.delete":
      return t("projectLog.actions.projectSnapshotDelete");
    case "project.network_mode.update": return t("projectLog.actions.projectNetworkModeUpdate");
    case "project.ai_assist.update": return t("projectLog.actions.projectAiAssistUpdate");
    case "project.ai_chat.message": return t("projectLog.actions.projectAiChatMessage");
    case "project.ai_chat.response": return t("projectLog.actions.projectAiChatResponse");
    case "project.ai_assist.embeddings.delete": return t("projectLog.actions.projectAiAssistEmbeddingsDelete");
    case "project.ai_processed_document.export": return t("projectLog.actions.projectAiProcessedDocumentExport");
    case "project_uploaded_file.create": return t("projectLog.actions.projectUploadedFileCreate");
    case "project_uploaded_file.delete": return t("projectLog.actions.projectUploadedFileDelete");
    case "project_uploaded_file.status": return t("projectLog.actions.projectUploadedFileStatus");
    case "codebook.export": return t("projectLog.actions.codebookExport");
    case "codebook.import": return t("projectLog.actions.codebookImport");
    case "ai_assist.index": return t("projectLog.actions.aiAssistIndex");
    case "ai_assist.reindex": return t("projectLog.actions.aiAssistReindex");
    case "source.create": return t("projectLog.actions.sourceCreate");
    case "source.update": return t("projectLog.actions.sourceUpdate");
    case "source.delete": return t("projectLog.actions.sourceDelete");
    case "source.restore": return t("projectLog.actions.sourceRestore");
    case "source.associations": return t("projectLog.actions.sourceAssociations");
    case "code.create": return t("projectLog.actions.codeCreate");
    case "code.update": return t("projectLog.actions.codeUpdate");
    case "code.delete": return t("projectLog.actions.codeDelete");
    case "code.restore": return t("projectLog.actions.codeRestore");
    case "annotation.create": return t("projectLog.actions.annotationCreate");
    case "annotation.update": return t("projectLog.actions.annotationUpdate");
    case "annotation.delete": return t("projectLog.actions.annotationDelete");
    case "annotation.restore": return t("projectLog.actions.annotationRestore");
    case "case.create": return t("projectLog.actions.caseCreate");
    case "case.update": return t("projectLog.actions.caseUpdate");
    case "case.delete": return t("projectLog.actions.caseDelete");
    case "case.restore": return t("projectLog.actions.caseRestore");
    case "case.associations": return t("projectLog.actions.caseAssociations");
    case "case_attribute.create": return t("projectLog.actions.caseAttributeCreate");
    case "case_attribute.update": return t("projectLog.actions.caseAttributeUpdate");
    case "case_attribute.delete": return t("projectLog.actions.caseAttributeDelete");
    case "document_attribute.create": return t("projectLog.actions.documentAttributeCreate");
    case "document_attribute.update": return t("projectLog.actions.documentAttributeUpdate");
    case "document_attribute.delete": return t("projectLog.actions.documentAttributeDelete");
    case "object_type.create": return t("projectLog.actions.objectTypeCreate");
    case "object_type.update": return t("projectLog.actions.objectTypeUpdate");
    case "object_type.delete": return t("projectLog.actions.objectTypeDelete");
    case "object.create": return t("projectLog.actions.objectCreate");
    case "object.update": return t("projectLog.actions.objectUpdate");
    case "object.delete": return t("projectLog.actions.objectDelete");
    case "relationship_type.create": return t("projectLog.actions.relationshipTypeCreate");
    case "relationship_type.update": return t("projectLog.actions.relationshipTypeUpdate");
    case "relationship_type.delete": return t("projectLog.actions.relationshipTypeDelete");
    case "relationship.create": return t("projectLog.actions.relationshipCreate");
    case "relationship.update": return t("projectLog.actions.relationshipUpdate");
    case "relationship.delete": return t("projectLog.actions.relationshipDelete");
    case "memo.create": return t("projectLog.actions.memoCreate");
    case "memo.update": return t("projectLog.actions.memoUpdate");
    case "memo.delete": return t("projectLog.actions.memoDelete");
    case "memo.restore": return t("projectLog.actions.memoRestore");
    case "code_report.create": return t("projectLog.actions.codeReportCreate");
    case "code_report.update": return t("projectLog.actions.codeReportUpdate");
    case "code_report.delete": return t("projectLog.actions.codeReportDelete");
    case "code_report.restore": return t("projectLog.actions.codeReportRestore");
    case "coder_report.create": return t("projectLog.actions.coderReportCreate");
    case "coder_report.update": return t("projectLog.actions.coderReportUpdate");
    case "coder_report.delete": return t("projectLog.actions.coderReportDelete");
    case "coder_report.restore": return t("projectLog.actions.coderReportRestore");
    case "report.create": return t("projectLog.actions.reportCreate");
    case "report.update": return t("projectLog.actions.reportUpdate");
    case "report.delete": return t("projectLog.actions.reportDelete");
    case "report.export": return t("projectLog.actions.reportExport");
    case "ai_analysis.create": return t("projectLog.actions.aiAnalysisCreate");
    case "ai_analysis.update": return t("projectLog.actions.aiAnalysisUpdate");
    case "ai_analysis.delete": return t("projectLog.actions.aiAnalysisDelete");
    case "ai_attribute_suggestion_run.create": return t("projectLog.actions.aiAttributeSuggestionRunCreate");
    case "ai_attribute_suggestion_run.update": return t("projectLog.actions.aiAttributeSuggestionRunUpdate");
    case "ai_attribute_suggestion_run.delete": return t("projectLog.actions.aiAttributeSuggestionRunDelete");
    case "member.add": return t("projectLog.actions.memberAdd");
    case "member.update": return t("projectLog.actions.memberUpdate");
    case "member.remove": return t("projectLog.actions.memberRemove");
    case "member.reassociate": return t("projectLog.actions.memberReassociate");
    case "member.remove_unresolved": return t("projectLog.actions.memberRemoveUnresolved");
    case "presence.inactive": return t("projectLog.actions.presenceInactive");
    default: return PROJECT_LOG_ACTION_LABELS[action] ?? action;
  }
}

type ProjectLogDetails = Record<string, unknown>;

export function formatProjectLogDateTime(iso: string): string {
  const d = new Date(iso);
  return formatCurrentDateTime(d, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function projectLogActionCategory(action: string): string {
  if (
    action.startsWith("project.")
    || action.startsWith("auth.")
    || action.startsWith("member.")
    || action.startsWith("ai_assist.")
    || action.startsWith("project_uploaded_file.")
    || action.startsWith("saved_drawing.")
    || action.startsWith("object.")
    || action.startsWith("object_type.")
    || action.startsWith("relationship.")
    || action.startsWith("relationship_type.")
  ) return "project";
  if (action.startsWith("case.") || action.startsWith("case_attribute.")) return "case";
  if (action.startsWith("source.") || action.startsWith("source_attribute.")) return "source";
  if (action.startsWith("document_attribute.")) return "document";
  if (action.startsWith("code.") || action.startsWith("codebook.")) return "code";
  if (action.startsWith("annotation.")) return "annotation";
  if (action.startsWith("memo.")) return "memo";
  if (
    action.startsWith("report.")
    || action.includes("_report.")
    || action.startsWith("ai_analysis.")
    || action.startsWith("ai_attribute_suggestion_run.")
  ) return "report";
  return "other";
}

export function projectLogAccessModeLabel(
  mode?: "local" | "remote",
  t?: ReturnType<typeof useI18n>["t"],
): string {
  if (mode === "local") return t ? t("projectLog.access.local") : "Local";
  if (mode === "remote") return t ? t("projectLog.access.remote") : "Remote";
  return "-";
}

export function parseProjectLogDetails(detailsJson?: string): ProjectLogDetails | null {
  if (!detailsJson?.trim()) return null;
  try {
    const parsed = JSON.parse(detailsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as ProjectLogDetails;
  } catch {
    return null;
  }
}

function formatDetailKey(key: string, t: ReturnType<typeof useI18n>["t"]): string {
  const fieldLabelMap: Record<string, Parameters<typeof t>[0]> = {
    previousRole: "projectLog.fieldLabels.previousRole",
    nextRole: "projectLog.fieldLabels.nextRole",
    snapshotKind: "projectLog.fieldLabels.snapshotKind",
    backupKind: "projectLog.fieldLabels.snapshotKind",
    targetKind: "projectLog.fieldLabels.targetKind",
    attributeName: "projectLog.fieldLabels.attributeName",
    codeId: "projectLog.fieldLabels.codeId",
    annotationId: "projectLog.fieldLabels.annotationId",
    sourceId: "projectLog.fieldLabels.sourceId",
    sourceKind: "projectLog.fieldLabels.sourceKind",
    anchorKind: "projectLog.fieldLabels.anchorKind",
    changedFields: "projectLog.fieldLabels.changedFields",
    changedValueCount: "projectLog.fieldLabels.changedValueCount",
    caseCount: "projectLog.fieldLabels.caseCount",
    documentCount: "projectLog.fieldLabels.documentCount",
    codeCount: "projectLog.fieldLabels.codeCount",
    coderCount: "projectLog.fieldLabels.coderCount",
    snapshotCount: "projectLog.fieldLabels.snapshotCount",
    backupCount: "projectLog.fieldLabels.snapshotCount",
    importedUsersCount: "projectLog.fieldLabels.importedUsersCount",
    requiresUserResolution: "projectLog.fieldLabels.requiresUserResolution",
    sizeBytes: "projectLog.fieldLabels.sizeBytes",
    model: "projectLog.fieldLabels.model",
    usedContextItemCount: "projectLog.fieldLabels.usedContextItemCount",
    responseCharCount: "projectLog.fieldLabels.responseCharCount",
    messageCharCount: "projectLog.fieldLabels.messageCharCount",
    entityType: "projectLog.fieldLabels.entityType",
    presence: "projectLog.fieldLabels.presence",
    dataType: "projectLog.fieldLabels.dataType",
    occurredAt: "projectLog.fieldLabels.occurredAt",
    startOffset: "projectLog.fieldLabels.startOffset",
    endOffset: "projectLog.fieldLabels.endOffset",
    timeStartMs: "projectLog.fieldLabels.timeStartMs",
    timeEndMs: "projectLog.fieldLabels.timeEndMs",
    imageRegion: "projectLog.fieldLabels.imageRegion",
    extractedFromVideoSourceId: "projectLog.fieldLabels.extractedFromVideoSourceId",
    extractedFromVideoTimeMs: "projectLog.fieldLabels.extractedFromVideoTimeMs",
    createdFromVideoFrame: "projectLog.fieldLabels.createdFromVideoFrame",
  };
  const labelKey = fieldLabelMap[key];
  if (labelKey) return t(labelKey);
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function isIsoDateTimeString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
}

function formatMediaMilliseconds(value: number): string {
  const totalMs = Math.max(0, Math.round(value));
  const totalSeconds = Math.floor(totalMs / 1000);
  const ms = totalMs % 1000;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
  return ms > 0 ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

function formatImageRegionSummary(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const region = value as Record<string, unknown>;
  const x = Number(region.x);
  const y = Number(region.y);
  const width = Number(region.width);
  const height = Number(region.height);
  const imageWidth = Number(region.imageWidth);
  const imageHeight = Number(region.imageHeight);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  const bounds = `${Math.round(width)} x ${Math.round(height)} at ${Math.round(x)}, ${Math.round(y)}`;
  return Number.isFinite(imageWidth) && Number.isFinite(imageHeight)
    ? `${bounds} of ${Math.round(imageWidth)} x ${Math.round(imageHeight)}`
    : bounds;
}

function formatDetailValue(
  value: unknown,
  t: ReturnType<typeof useI18n>["t"],
): { text: string; multiline: boolean } {
  if (value == null) return { text: "-", multiline: false };
  if (typeof value === "string") {
    if (!value) return { text: "-", multiline: false };
    if (value === "document") return { text: "source", multiline: false };
    if (value === "document_attribute") return { text: "source attribute", multiline: false };
    if (value === "document_attribute_value") return { text: "source attribute value", multiline: false };
    if (isIsoDateTimeString(value)) {
      return { text: formatProjectLogDateTime(value), multiline: false };
    }
    if (value === "inactive") return { text: t("projectLog.values.presenceInactive"), multiline: false };
    if (value === "active") return { text: t("projectLog.values.presenceActive"), multiline: false };
    if (value === "datetime") return { text: t("projectLog.values.dataTypeDatetime"), multiline: false };
    if (value === "time_range") return { text: t("projectLog.values.anchorKindTimeRange"), multiline: false };
    if (value === "image_rect") return { text: t("projectLog.values.anchorKindImageRect"), multiline: false };
    if (value === "text_span") return { text: t("projectLog.values.anchorKindTextSpan"), multiline: false };
    return { text: value, multiline: value.includes("\n") };
  }
  if (typeof value === "number" || typeof value === "boolean") return { text: String(value), multiline: false };
  if (Array.isArray(value)) {
    if (value.length === 0) return { text: "[]", multiline: false };
    const hasComplexValue = value.some((item) => item && typeof item === "object");
    if (hasComplexValue) {
      return { text: JSON.stringify(value, null, 2), multiline: true };
    }
    return {
      text: value.map((item) => formatDetailValue(item, t).text).join(", "),
      multiline: value.length > 4,
    };
  }
  const imageRegionSummary = formatImageRegionSummary(value);
  if (imageRegionSummary) return { text: imageRegionSummary, multiline: false };
  return { text: JSON.stringify(value, null, 2), multiline: true };
}

export function summarizeProjectLogDetails(action: string, details: ProjectLogDetails, t: ReturnType<typeof useI18n>["t"]): string {
  const pieces: string[] = [];
  const push = (text?: string | null) => {
    if (text && text.trim()) pieces.push(text.trim());
  };

  if (typeof details.previousRole === "string" && typeof details.nextRole === "string") {
    push(t("projectLog.details.roleChanged", {
      previousRole: String(details.previousRole),
      nextRole: String(details.nextRole),
    }));
  }

  const snapshotKind = typeof details.snapshotKind === "string"
    ? details.snapshotKind
    : typeof details.backupKind === "string"
      ? details.backupKind
      : null;
  if (snapshotKind) {
    push(t("projectLog.details.snapshotKind", {
      kind: snapshotKind,
    }));
  }

  if (typeof details.targetKind === "string") {
    push(t("projectLog.details.targetKind", { kind: details.targetKind }));
  }

  if (typeof details.attributeName === "string" && details.attributeName) {
    push(t("projectLog.details.attributeName", { name: details.attributeName }));
  }

  if (typeof details.codeId === "string" && details.codeId) {
    push(t("projectLog.details.codeId", { id: details.codeId }));
  }

  if (typeof details.sourceKind === "string" && details.sourceKind) {
    push(t("projectLog.details.sourceKind", { kind: details.sourceKind }));
  }

  if (typeof details.anchorKind === "string" && details.anchorKind) {
    push(t("projectLog.details.anchorKind", { kind: formatDetailValue(details.anchorKind, t).text }));
  }

  if (typeof details.timeStartMs === "number" && typeof details.timeEndMs === "number") {
    push(t("projectLog.details.mediaTimeRange", {
      start: formatMediaMilliseconds(details.timeStartMs),
      end: formatMediaMilliseconds(details.timeEndMs),
    }));
  }

  if (typeof details.startOffset === "number" && typeof details.endOffset === "number") {
    push(t("projectLog.details.textRange", {
      start: details.startOffset,
      end: details.endOffset,
    }));
  }

  const imageRegionSummary = formatImageRegionSummary(details.imageRegion);
  if (imageRegionSummary) {
    push(t("projectLog.details.imageRegion", { region: imageRegionSummary }));
  }

  if (details.createdFromVideoFrame === true) {
    push(t("projectLog.details.createdFromVideoFrame"));
  }

  if (typeof details.extractedFromVideoTimeMs === "number") {
    push(t("projectLog.details.extractedFromVideoTime", {
      time: formatMediaMilliseconds(details.extractedFromVideoTimeMs),
    }));
  }

  if (Array.isArray(details.changedFields) && details.changedFields.length > 0) {
    push(t("projectLog.details.changedFields", { fields: details.changedFields.join(", ") }));
  }

  if (typeof details.changedValueCount === "number") {
    push(t("projectLog.details.changedValueCount", { count: details.changedValueCount }));
  }

  if (typeof details.caseCount === "number") {
    push(t("projectLog.details.caseCount", { count: details.caseCount }));
  }
  if (typeof details.documentCount === "number") {
    push(t("projectLog.details.documentCount", { count: details.documentCount }));
  }
  if (typeof details.codeCount === "number") {
    push(t("projectLog.details.codeCount", { count: details.codeCount }));
  }
  if (typeof details.coderCount === "number") {
    push(t("projectLog.details.coderCount", { count: details.coderCount }));
  }

  const snapshotCount = typeof details.snapshotCount === "number"
    ? details.snapshotCount
    : typeof details.backupCount === "number"
      ? details.backupCount
      : null;
  if (snapshotCount != null && (action === "project.snapshot.settings" || action === "project.backup.settings")) {
    push(t("projectLog.details.snapshotCount", { count: snapshotCount }));
  }

  if (typeof details.importedUsersCount === "number") {
    push(t("projectLog.details.importedUsers", { count: details.importedUsersCount }));
  }

  if (typeof details.requiresUserResolution === "boolean") {
    push(details.requiresUserResolution ? t("projectLog.details.resolutionRequired") : t("projectLog.details.resolutionNotRequired"));
  }

  if (typeof details.sizeBytes === "number" && details.sizeBytes > 0) {
    const sizeKb = details.sizeBytes / 1024;
    push(
      sizeKb >= 1024
        ? t("projectLog.details.sizeMb", { size: (sizeKb / 1024).toFixed(1) })
        : t("projectLog.details.sizeKb", { size: sizeKb.toFixed(1) }),
    );
  }

  if (typeof details.model === "string" && details.model) {
    push(t("projectLog.details.model", { model: details.model }));
  }

  if (typeof details.usedContextItemCount === "number") {
    push(t("projectLog.details.usedContextItemCount", { count: details.usedContextItemCount }));
  }

  if (typeof details.responseCharCount === "number") {
    push(t("projectLog.details.responseCharCount", { count: details.responseCharCount }));
  }

  if (typeof details.messageCharCount === "number") {
    push(t("projectLog.details.messageCharCount", { count: details.messageCharCount }));
  }

  if (pieces.length > 0) {
    return pieces.join(" ");
  }

  if (typeof details.entityType === "string") {
    return t("projectLog.details.entityType", {
      entityType: details.entityType.replace(/_/g, " "),
    });
  }

  return t("projectLog.details.available");
}

export function projectLogDescriptionLabel(
  entry: ProjectLogEntry,
  details: ProjectLogDetails | null,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const chatTitleFromLabel =
    typeof entry.label === "string"
      ? entry.label.match(/"(.*)"/)?.[1] ?? null
      : null;

  switch (entry.action) {
    case "project.create":
      return typeof details?.name === "string"
        ? t("projectLog.labels.projectCreated", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "project.open":
      return typeof details?.name === "string"
        ? t("projectLog.labels.projectOpened", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "project.close":
      return typeof details?.name === "string"
        ? t("projectLog.labels.projectClosed", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "project.import": {
      if (details?.importFormat === "json") return t("projectLog.labels.projectImportJson");
      if (details?.importFormat === "qdpx") return t("projectLog.labels.projectImportRefiQda");
      return entry.label || projectLogActionLabel(entry.action, t);
    }
    case "project.encrypted_backup.import":
      return t("projectLog.labels.projectImportEncryptedBackup");
    case "project.export": {
      const format = typeof details?.exportFormat === "string" ? details.exportFormat : null;
      return format ? t("projectLog.labels.projectExport", { format }) : projectLogActionLabel(entry.action, t);
    }
    case "project.encrypted_backup.export":
      return t("projectLog.labels.projectEncryptedBackupExport");
    case "project.log.export":
      return t("projectLog.labels.projectLogExport");
    case "project.restore_backup": {
      const date = typeof details?.backupCreatedAt === "string" ? formatProjectLogDateTime(details.backupCreatedAt) : null;
      return date ? t("projectLog.labels.projectRestoreBackup", { date }) : projectLogActionLabel(entry.action, t);
    }
    case "project.ai_assist.update":
      if (details?.enabled === true) return t("projectLog.labels.projectAiAssistEnabled");
      if (details?.enabled === false) return t("projectLog.labels.projectAiAssistDisabled");
      if (entry.label === "Enabled AI Assist for this project") return t("projectLog.labels.projectAiAssistEnabled");
      if (entry.label === "Disabled AI Assist for this project") return t("projectLog.labels.projectAiAssistDisabled");
      return entry.label || projectLogActionLabel(entry.action, t);
    case "project.ai_assist.embeddings.delete":
      return t("projectLog.labels.projectAiAssistEmbeddingsDeleted");
    case "project.ai_chat.message": {
      const chat =
        typeof details?.chatTitle === "string"
          ? details.chatTitle
          : chatTitleFromLabel;
      return chat
        ? t("projectLog.labels.projectAiChatMessage", { chat })
        : projectLogActionLabel(entry.action, t);
    }
    case "project.ai_chat.response": {
      const chat =
        typeof details?.chatTitle === "string"
          ? details.chatTitle
          : chatTitleFromLabel;
      return chat
        ? t("projectLog.labels.projectAiChatResponse", { chat })
        : projectLogActionLabel(entry.action, t);
    }
    case "project_uploaded_file.status":
      if (typeof details?.fileName === "string" && details?.toStatus === "deleted") {
        return t("projectLog.labels.projectUploadedFileDeleted", { name: details.fileName });
      }
      return entry.label || projectLogActionLabel(entry.action, t);
    case "ai_assist.index":
      if (entry.label === "Built local AI Assist embeddings") return t("projectLog.labels.aiAssistIndexBuiltLocal");
      if (entry.label === "Built host AI Assist embeddings") return t("projectLog.labels.aiAssistIndexBuiltHost");
      return projectLogActionLabel(entry.action, t);
    case "ai_assist.reindex":
      if (entry.label === "Rebuilt local AI Assist embeddings") return t("projectLog.labels.aiAssistIndexRebuiltLocal");
      if (entry.label === "Rebuilt host AI Assist embeddings") return t("projectLog.labels.aiAssistIndexRebuiltHost");
      return projectLogActionLabel(entry.action, t);
    case "project.network_mode.update":
      if (details?.mode === "device") return "Returned database access to Device mode";
      if (details?.mode === "network") return "Enabled Network database access";
      if (details?.mode === "internet") return "Enabled Internet database access";
      if (details?.mode === "lan") return t("projectLog.labels.networkModeLanEnabled");
      if (details?.mode === "local") return t("projectLog.labels.networkModeLocalEnabled");
      return projectLogActionLabel(entry.action, t);
    case "project.snapshot.create":
    case "project.backup.create": {
      const snapshotKind = details?.snapshotKind ?? details?.backupKind;
      if (snapshotKind === "manual") return t("projectLog.labels.snapshotCreatedManual");
      if (snapshotKind === "session") return t("projectLog.labels.snapshotCreatedSession");
      if (snapshotKind === "automatic") return t("projectLog.labels.snapshotCreatedAutomatic");
      return projectLogActionLabel(entry.action, t);
    }
    case "presence.inactive":
      return typeof details?.userLabel === "string"
        ? t("projectLog.labels.presenceInactive", { name: details.userLabel })
        : projectLogActionLabel(entry.action, t);
    case "source.create":
      return typeof details?.name === "string"
        ? t("projectLog.labels.sourceCreated", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "source.update":
      return typeof details?.name === "string"
        ? t("projectLog.labels.sourceUpdated", { name: details.name })
        : t("projectLog.labels.sourceUpdatedGeneric");
    case "source.delete":
      return typeof details?.name === "string"
        ? t("projectLog.labels.sourceDeleted", { name: details.name })
        : t("projectLog.labels.sourceDeletedGeneric");
    case "source.associations":
      if (
        typeof details?.name === "string"
        && typeof details?.addedCount === "number"
        && typeof details?.removedCount === "number"
      ) {
        return t("projectLog.labels.sourceAssociationsUpdated", {
          name: details.name,
          added: details.addedCount,
          removed: details.removedCount,
        });
      }
      return entry.label || projectLogActionLabel(entry.action, t);
    case "code.create":
      return typeof details?.label === "string"
        ? t("projectLog.labels.codeCreated", { name: details.label })
        : projectLogActionLabel(entry.action, t);
    case "code.update":
      return typeof details?.label === "string"
        ? t("projectLog.labels.codeUpdated", { name: details.label })
        : t("projectLog.labels.codeUpdatedGeneric");
    case "code.delete":
      return typeof details?.label === "string"
        ? t("projectLog.labels.codeDeleted", { name: details.label })
        : t("projectLog.labels.codeDeletedGeneric");
    case "annotation.create":
      return typeof details?.quote === "string"
        ? t("projectLog.labels.annotationCreated", { quote: details.quote })
        : projectLogActionLabel(entry.action, t);
    case "annotation.update":
      return t("projectLog.labels.annotationUpdated");
    case "annotation.delete":
      return t("projectLog.labels.annotationDeleted");
    case "case.create":
      return typeof details?.name === "string"
        ? t("projectLog.labels.caseCreated", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "case.update":
      return typeof details?.name === "string"
        ? t("projectLog.labels.caseUpdated", { name: details.name })
        : t("projectLog.labels.caseUpdatedGeneric");
    case "case.delete":
      return typeof details?.name === "string"
        ? t("projectLog.labels.caseDeleted", { name: details.name })
        : t("projectLog.labels.caseDeletedGeneric");
    case "case.associations":
      if (
        typeof details?.name === "string"
        && typeof details?.addedCount === "number"
        && typeof details?.removedCount === "number"
      ) {
        return t("projectLog.labels.caseAssociationsUpdated", {
          name: details.name,
          added: details.addedCount,
          removed: details.removedCount,
        });
      }
      return entry.label || projectLogActionLabel(entry.action, t);
    case "memo.create":
      return typeof details?.title === "string"
        ? t("projectLog.labels.memoCreated", { name: details.title })
        : projectLogActionLabel(entry.action, t);
    case "memo.update":
      return typeof details?.title === "string"
        ? t("projectLog.labels.memoUpdated", { name: details.title })
        : t("projectLog.labels.memoUpdatedGeneric");
    case "memo.delete":
      return typeof details?.title === "string"
        ? t("projectLog.labels.memoDeleted", { name: details.title })
        : t("projectLog.labels.memoDeletedGeneric");
    case "code_report.create":
      return typeof details?.name === "string"
        ? t("projectLog.labels.codeReportCreated", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "coder_report.create":
      return typeof details?.name === "string"
        ? t("projectLog.labels.coderReportCreated", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "report.create":
      return typeof details?.title === "string"
        ? t("projectLog.labels.reportCreated", { name: details.title })
        : projectLogActionLabel(entry.action, t);
    case "report.update":
      return typeof details?.title === "string"
        ? t("projectLog.labels.reportUpdated", { name: details.title })
        : projectLogActionLabel(entry.action, t);
    case "report.delete":
      return typeof details?.title === "string"
        ? t("projectLog.labels.reportDeleted", { name: details.title })
        : entry.label || projectLogActionLabel(entry.action, t);
    case "report.export":
      return typeof details?.title === "string" && typeof details?.format === "string"
        ? t("projectLog.labels.reportExported", { name: details.title, format: details.format.toUpperCase() })
        : entry.label || projectLogActionLabel(entry.action, t);
    case "ai_attribute_suggestion_run.create":
      return typeof details?.name === "string"
        ? t("projectLog.labels.savedSuggestionsCreated", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "document_attribute.create":
      if (typeof details?.name === "string") return t("projectLog.labels.documentAttributeAdded", { name: details.name });
      if (typeof details?.attributeName === "string") return t("projectLog.labels.documentAttributeAdded", { name: details.attributeName });
      return entry.label || projectLogActionLabel(entry.action, t);
    case "document_attribute.update":
      if (typeof details?.attributeName === "string" && details?.entityType === "document_attribute_value") {
        return t("projectLog.labels.documentAttributeSuggestionAccepted", { name: details.attributeName });
      }
      if (typeof details?.name === "string") return t("projectLog.labels.documentAttributeUpdated", { name: details.name });
      if (typeof details?.attributeName === "string") return t("projectLog.labels.documentAttributeUpdated", { name: details.attributeName });
      return entry.label || projectLogActionLabel(entry.action, t);
    case "document_attribute.delete":
      if (typeof details?.name === "string") return t("projectLog.labels.documentAttributeDeleted", { name: details.name });
      if (typeof details?.attributeName === "string") return t("projectLog.labels.documentAttributeDeleted", { name: details.attributeName });
      return entry.label || projectLogActionLabel(entry.action, t);
    case "case_attribute.create":
      if (typeof details?.name === "string") return t("projectLog.labels.caseAttributeAdded", { name: details.name });
      if (typeof details?.attributeName === "string") return t("projectLog.labels.caseAttributeAdded", { name: details.attributeName });
      return entry.label || projectLogActionLabel(entry.action, t);
    case "object_type.create":
      return typeof details?.name === "string"
        ? t("projectLog.labels.objectTypeCreated", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "object_type.update":
      return typeof details?.name === "string"
        ? t("projectLog.labels.objectTypeUpdated", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "object_type.delete":
      return typeof details?.name === "string"
        ? t("projectLog.labels.objectTypeDeleted", { name: details.name })
        : entry.label || projectLogActionLabel(entry.action, t);
    case "object.create":
      return typeof details?.title === "string"
        ? t("projectLog.labels.objectCreated", { name: details.title })
        : projectLogActionLabel(entry.action, t);
    case "object.update":
      return typeof details?.title === "string"
        ? t("projectLog.labels.objectUpdated", { name: details.title })
        : projectLogActionLabel(entry.action, t);
    case "object.delete":
      return typeof details?.title === "string"
        ? t("projectLog.labels.objectDeleted", { name: details.title })
        : entry.label || projectLogActionLabel(entry.action, t);
    case "relationship_type.create":
      return typeof details?.name === "string"
        ? t("projectLog.labels.relationshipTypeCreated", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "relationship_type.update":
      return typeof details?.name === "string"
        ? t("projectLog.labels.relationshipTypeUpdated", { name: details.name })
        : projectLogActionLabel(entry.action, t);
    case "relationship_type.delete":
      return typeof details?.name === "string"
        ? t("projectLog.labels.relationshipTypeDeleted", { name: details.name })
        : entry.label || projectLogActionLabel(entry.action, t);
    case "relationship.create":
      return typeof details?.relationshipType === "string"
        ? t("projectLog.labels.relationshipCreated", { name: details.relationshipType })
        : projectLogActionLabel(entry.action, t);
    case "relationship.update":
      return typeof details?.relationshipType === "string"
        ? t("projectLog.labels.relationshipUpdated", { name: details.relationshipType })
        : projectLogActionLabel(entry.action, t);
    case "relationship.delete":
      return typeof details?.relationshipType === "string"
        ? t("projectLog.labels.relationshipDeleted", { name: details.relationshipType })
        : entry.label || projectLogActionLabel(entry.action, t);
    default:
      return entry.label || projectLogActionLabel(entry.action, t);
  }
}

export function ProjectLogDetailsPanel({ details }: { details: ProjectLogDetails }) {
  const { t } = useI18n();
  const entries = Object.entries(details);

  if (entries.length === 0) {
    return <p className="log-details-empty">{t("projectLog.empty.noStructuredDetails")}</p>;
  }

  return (
    <div className="log-details-panel">
      <div className="log-details-grid">
        {entries.map(([key, value]) => {
          const formatted = formatDetailValue(value, t);
          return (
            <div key={key} className="log-details-item">
              <div className="log-details-key">{formatDetailKey(key, t)}</div>
              {formatted.multiline ? (
                <pre className="log-details-value log-details-value--multiline">{formatted.text}</pre>
              ) : (
                <div className="log-details-value">{formatted.text}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProjectLogTable() {
  const { t } = useI18n();
  const { logEntries } = useStore();
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const sorted = useMemo(
    () => [...logEntries].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    ),
    [logEntries],
  );

  if (sorted.length === 0) {
    return (
      <div className="empty-state">
        <p>{t("projectLog.empty.noActivity")}</p>
      </div>
    );
  }

  return (
    <div className="project-log-table-wrap">
      <table className="project-log-table">
        <thead>
          <tr>
            <th>{t("projectLog.columns.time")}</th>
            <th>{t("projectLog.columns.user")}</th>
            <th>{t("projectLog.columns.access")}</th>
            <th>{t("projectLog.columns.category")}</th>
            <th>{t("projectLog.columns.description")}</th>
            <th>{t("projectLog.columns.details")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry: ProjectLogEntry) => {
            const details = parseProjectLogDetails(entry.detailsJson);
            const isExpanded = Boolean(expandedIds[entry.id]);
            const summary = details ? summarizeProjectLogDetails(entry.action, details, t) : "";
            return (
              <Fragment key={entry.id}>
                <tr className={`log-row log-row--${projectLogActionCategory(entry.action)}`}>
                  <td className="log-cell log-cell--time">{formatProjectLogDateTime(entry.occurredAt)}</td>
                  <td className="log-cell log-cell--user">{entry.userName || "-"}</td>
                  <td className="log-cell log-cell--user">
                    {entry.accessMode === "local"
                      ? t("projectLog.access.local")
                      : entry.accessMode === "remote"
                        ? t("projectLog.access.remote")
                        : "-"}
                  </td>
                  <td className="log-cell log-cell--action">
                    <span className={`log-badge log-badge--${projectLogActionCategory(entry.action)}`}>
                      {projectLogActionLabel(entry.action, t)}
                    </span>
                  </td>
                  <td className="log-cell log-cell--label">
                    <div>{projectLogDescriptionLabel(entry, details, t)}</div>
                    {summary && <div className="log-inline-summary">{summary}</div>}
                  </td>
                  <td className="log-cell log-cell--details-toggle">
                    {details ? (
                      <button
                        type="button"
                        className="btn btn--xs log-details-toggle"
                        onClick={() =>
                          setExpandedIds((prev) => ({
                            ...prev,
                            [entry.id]: !prev[entry.id],
                          }))
                        }
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? t("projectLog.actions.hideDetails") : t("projectLog.actions.viewDetails")}
                      </button>
                    ) : (
                      <span className="log-details-none">-</span>
                    )}
                  </td>
                </tr>
                {details && isExpanded && (
                  <tr className="log-details-row">
                    <td className="log-cell log-cell--details" colSpan={6}>
                      <ProjectLogDetailsPanel details={details} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
