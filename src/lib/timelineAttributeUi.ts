type TimelineAttributeUiDefinition = {
  name: string;
  timelineRole?: string | null;
};

const HIDDEN_ITEM_TIMELINE_ROLES = new Set(["timeline_group", "timeline_item_type"]);
const HIDDEN_ITEM_TIMELINE_NAMES = new Set([
  "timeline group",
  "group",
  "lane",
  "timeline lane",
  "multi day",
  "multiday",
  "multi-day",
]);

function normalizeTimelineAttributeName(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function isVisibleItemTimelineAttribute(definition: TimelineAttributeUiDefinition): boolean {
  const role = (definition.timelineRole ?? "").trim().toLowerCase();
  if (!role) return false;
  if (HIDDEN_ITEM_TIMELINE_ROLES.has(role)) return false;
  return !HIDDEN_ITEM_TIMELINE_NAMES.has(normalizeTimelineAttributeName(definition.name));
}

export function itemTimelineAttributeLabel(definition: TimelineAttributeUiDefinition): string {
  switch ((definition.timelineRole ?? "").trim().toLowerCase()) {
    case "timeline_start":
      return "Start";
    case "timeline_end":
      return "End";
    case "timeline_label":
      return "Timeline label";
    default:
      return definition.name;
  }
}

export function itemTimelineAttributeDefaultValue(
  definition: TimelineAttributeUiDefinition,
  itemTitle: string,
): string {
  return (definition.timelineRole ?? "").trim().toLowerCase() === "timeline_label"
    ? itemTitle.trim()
    : "";
}
