import type { SharedAttributeDraft } from "../components/AttributeValuesModal";

export type TypeAttributeDraft = SharedAttributeDraft & { localId: string };
export type TimelineFieldRole = Exclude<NonNullable<SharedAttributeDraft["timelineRole"]>, "">;

export const TIMELINE_FIELD_OPTIONS: Array<{
  role: TimelineFieldRole;
  label: string;
  dataTypes: SharedAttributeDraft["dataType"][];
  defaultName: string;
}> = [
  { role: "timeline_start", label: "Start", dataTypes: ["datetime"], defaultName: "Timeline start" },
  { role: "timeline_end", label: "End", dataTypes: ["datetime"], defaultName: "Timeline end" },
  { role: "timeline_label", label: "Label", dataTypes: ["text", "categorical"], defaultName: "Timeline label" },
  { role: "timeline_item_type", label: "Item Type", dataTypes: ["categorical"], defaultName: "Timeline item type" },
];

export function createTypeAttributeDraft(draft?: Partial<SharedAttributeDraft> & { id?: string }): TypeAttributeDraft {
  return {
    localId: `${draft?.id ?? "new"}-${Math.random().toString(36).slice(2, 10)}`,
    ...(draft?.id ? { id: draft.id } : {}),
    name: draft?.name ?? "",
    dataType: draft?.dataType ?? "text",
    description: draft?.description ?? "",
    options: draft?.options ?? [],
    timelineRole: draft?.timelineRole ?? "",
  };
}

export function defaultTimelineAttributeOptions(role: TimelineFieldRole): string[] {
  return role === "timeline_item_type" ? ["Point", "Range"] : [];
}

export function formatTimelineModalDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}
