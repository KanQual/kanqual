import type { CSSProperties } from "react";
import {
  POSTGRES_OBJECT_FILL_OPTIONS,
  POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY,
  POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH,
  POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS,
  POSTGRES_RELATIONSHIP_ARROWHEAD_OPTIONS,
  POSTGRES_RELATIONSHIP_DEFAULT_COLOR,
  POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS,
  POSTGRES_RELATIONSHIP_PICKER_PREVIEW_COLOR,
  POSTGRES_SHAPE_PICKER_PREVIEW_COLOR,
  POSTGRES_SHAPE_PICKER_PREVIEW_FILL_TRANSPARENCY,
  getObjectShapePreviewStyle,
  getPostgresRelationshipStrokeDasharray,
  getPostgresRelationshipStrokeWidth,
  hexToRgba,
  normalizePostgresObjectOutlineWidth,
  renderSvgObjectShape,
  type PostgresObjectFill,
  type PostgresObjectTypeShape,
  type PostgresRelationshipArrowhead,
  type PostgresRelationshipLineShape,
  type PostgresSourceObjectVisualKey,
} from "../lib/postgresGraphics";
import { usePostgresStoredImageUrl } from "../lib/postgresStoredImages";

export function RelationshipTypeLinePreview(props: {
  lineShape: PostgresRelationshipLineShape;
  lineWeight: number;
  arrowhead: PostgresRelationshipArrowhead;
  color: string;
}) {
  const { lineShape, lineWeight, arrowhead, color } = props;
  const strokeWidth = getPostgresRelationshipStrokeWidth(lineWeight);
  const dasharray = getPostgresRelationshipStrokeDasharray(lineShape);
  const lineStartX = arrowhead === "double_sided" ? 14 : 8;
  const lineEndX = arrowhead === "none" ? 62 : 56;

  return (
    <svg aria-hidden="true" viewBox="0 0 70 24" width="70" height="24" style={{ display: "block", flexShrink: 0 }}>
      <line
        x1={lineStartX}
        y1="12"
        x2={lineEndX}
        y2="12"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dasharray}
      />
      {arrowhead === "double_sided" ? <path d="M8 12 L16 7.5 L16 16.5 Z" fill={color} /> : null}
      {arrowhead !== "none" ? <path d="M64 12 L56 7.5 L56 16.5 Z" fill={color} /> : null}
    </svg>
  );
}

export function ObjectShapeSwatch(props: {
  shape: PostgresObjectTypeShape;
  fill: PostgresObjectFill;
  color: string;
  outlineColor?: string;
  sourceVisualKey?: PostgresSourceObjectVisualKey | null;
  imageStoragePath?: string;
  projectStoragePath?: string;
  width: number;
  minHeight: number;
  fillTransparency?: number;
  outlineWidth?: number;
  selected?: boolean;
  style?: CSSProperties;
}) {
  const {
    shape,
    fill,
    color,
    outlineColor = color,
    sourceVisualKey = null,
    imageStoragePath = "",
    projectStoragePath = "",
    width,
    minHeight,
    fillTransparency = POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY,
    outlineWidth = POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH,
    selected = false,
    style,
  } = props;
  const imageUrl = usePostgresStoredImageUrl(projectStoragePath, imageStoragePath);
  const hasUploadedImage = Boolean(imageStoragePath);
  const frameWidth = hasUploadedImage ? minHeight : width;
  const normalizedOutlineWidth = normalizePostgresObjectOutlineWidth(outlineWidth);
  const strokePadding = hasUploadedImage
    ? 0
    : shape === "star"
      ? Math.ceil(normalizedOutlineWidth * 2.5) + 4
      : Math.ceil(normalizedOutlineWidth / 2) + 2;
  const swatchWidth = frameWidth + (strokePadding * 2);
  const swatchHeight = minHeight + (strokePadding * 2);
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${swatchWidth}" height="${swatchHeight}" viewBox="0 0 ${swatchWidth} ${swatchHeight}"><g transform="translate(${strokePadding} ${strokePadding})">${renderSvgObjectShape(shape, frameWidth, minHeight, color, outlineColor, fill, sourceVisualKey, fillTransparency, outlineWidth)}</g></svg>`;

  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "inline-flex",
        width: swatchWidth,
        height: swatchHeight,
        overflow: "hidden",
        flexShrink: 0,
        verticalAlign: "middle",
        lineHeight: 0,
        ...style,
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "rgba(248, 250, 252, 0.94)",
            borderRadius: 6,
            border: `${normalizedOutlineWidth}px solid ${hexToRgba(outlineColor, selected ? 0.72 : 0.42)}`,
            boxSizing: "border-box",
          }}
        />
      ) : (
        <span
          style={{ position: "absolute", inset: 0, display: "block", opacity: selected ? 1 : undefined }}
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      )}
    </span>
  );
}

export function PostgresObjectShapePicker(props: {
  value: PostgresObjectTypeShape | "";
  onChange: (value: PostgresObjectTypeShape | "") => void;
  previewColor: string;
  previewOutlineColor?: string;
  previewFill?: PostgresObjectFill;
  previewFillTransparency?: number;
  previewOutlineWidth?: number;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const { value, onChange, allowInherit = false, inheritLabel = "Inherit" } = props;
  return (
    <div className="shape-picker-grid shape-picker-grid--compact-shapes" role="radiogroup" aria-label="Shape selection">
      {allowInherit ? (
        <button
          type="button"
          className={`shape-picker-option${value === "" ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange("")}
          aria-pressed={value === ""}
        >
          <div className="shape-picker-preview shape-picker-preview--inherit" aria-hidden="true">
            <ObjectShapeSwatch
              shape="rounded"
              fill="filled"
              color={POSTGRES_SHAPE_PICKER_PREVIEW_COLOR}
              outlineColor={POSTGRES_SHAPE_PICKER_PREVIEW_COLOR}
              width={34}
              minHeight={34}
              fillTransparency={POSTGRES_SHAPE_PICKER_PREVIEW_FILL_TRANSPARENCY}
              outlineWidth={2}
              style={{ opacity: 0.72 }}
            />
          </div>
          <span className="shape-picker-label">{inheritLabel}</span>
        </button>
      ) : null}
      {POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`shape-picker-option${value === option.value ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          title={option.label}
        >
          <div className="shape-picker-preview" aria-hidden="true">
            <ObjectShapeSwatch
              shape={option.value}
              fill="filled"
              color={POSTGRES_SHAPE_PICKER_PREVIEW_COLOR}
              outlineColor={POSTGRES_SHAPE_PICKER_PREVIEW_COLOR}
              width={Math.round(getObjectShapePreviewStyle(option.value).width * 0.62)}
              minHeight={Math.round(getObjectShapePreviewStyle(option.value).minHeight * 0.62)}
              fillTransparency={POSTGRES_SHAPE_PICKER_PREVIEW_FILL_TRANSPARENCY}
              outlineWidth={2}
            />
          </div>
          <span className="shape-picker-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PostgresObjectFillPicker(props: {
  value: PostgresObjectFill | "";
  onChange: (value: PostgresObjectFill | "") => void;
  previewColor: string;
  previewOutlineColor?: string;
  previewShape?: PostgresObjectTypeShape;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const {
    value,
    onChange,
    previewColor,
    previewOutlineColor = previewColor,
    previewShape = "rounded",
    allowInherit = false,
    inheritLabel = "Inherit",
  } = props;
  return (
    <div className="shape-picker-grid" role="radiogroup" aria-label="Fill selection">
      {allowInherit ? (
        <button
          type="button"
          className={`shape-picker-option${value === "" ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange("")}
          aria-pressed={value === ""}
        >
          <div className="shape-picker-preview" aria-hidden="true">
            <ObjectShapeSwatch
              shape={previewShape}
              fill="outline"
              color="rgba(53, 80, 112, 0.55)"
              width={getObjectShapePreviewStyle(previewShape).width}
              minHeight={getObjectShapePreviewStyle(previewShape).minHeight}
              style={{ opacity: 0.72 }}
            />
          </div>
          <span className="shape-picker-label">{inheritLabel}</span>
        </button>
      ) : null}
      {POSTGRES_OBJECT_FILL_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`shape-picker-option${value === option.value ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          title={option.label}
          style={{
            borderColor: value === option.value ? previewColor : hexToRgba(previewColor, 0.22),
            background: `linear-gradient(180deg, ${hexToRgba(previewColor, value === option.value ? 0.16 : 0.08)}, rgba(255, 255, 255, 0.96))`,
            boxShadow: value === option.value ? `0 0 0 1px ${hexToRgba(previewColor, 0.35)}` : undefined,
          }}
        >
          <div className="shape-picker-preview" aria-hidden="true">
            <ObjectShapeSwatch
              shape={previewShape}
              fill={option.value}
              color={previewColor}
              outlineColor={previewOutlineColor}
              width={getObjectShapePreviewStyle(previewShape).width}
              minHeight={getObjectShapePreviewStyle(previewShape).minHeight}
            />
          </div>
          <span className="shape-picker-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PostgresRelationshipLineShapePicker(props: {
  value: PostgresRelationshipLineShape | "";
  onChange: (value: PostgresRelationshipLineShape | "") => void;
  previewColor: string;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const { value, onChange, allowInherit = false, inheritLabel = "Inherit" } = props;
  return (
    <div className="shape-picker-grid shape-picker-grid--compact-shapes" role="radiogroup" aria-label="Line shape selection">
      {allowInherit ? (
        <button
          type="button"
          className={`shape-picker-option${value === "" ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange("")}
          aria-pressed={value === ""}
        >
          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
            <svg width="46" height="18" viewBox="0 0 46 18">
              <line x1="4" y1="9" x2="42" y2="9" stroke={POSTGRES_RELATIONSHIP_PICKER_PREVIEW_COLOR} strokeWidth="3" strokeDasharray="5 5" />
            </svg>
          </div>
          <span className="shape-picker-label">{inheritLabel}</span>
        </button>
      ) : null}
      {POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`shape-picker-option${value === option.value ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          title={option.label}
        >
          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
            <svg width="46" height="18" viewBox="0 0 46 18">
              <line
                x1="4"
                y1="9"
                x2="42"
                y2="9"
                stroke={POSTGRES_RELATIONSHIP_PICKER_PREVIEW_COLOR}
                strokeWidth="3"
                strokeDasharray={getPostgresRelationshipStrokeDasharray(option.value)}
              />
            </svg>
          </div>
          <span className="shape-picker-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PostgresRelationshipArrowheadPicker(props: {
  value: PostgresRelationshipArrowhead | "";
  onChange: (value: PostgresRelationshipArrowhead | "") => void;
  previewColor: string;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const { value, onChange, allowInherit = false, inheritLabel = "Inherit" } = props;
  return (
    <div className="shape-picker-grid shape-picker-grid--compact-shapes" role="radiogroup" aria-label="Arrowhead selection">
      {allowInherit ? (
        <button
          type="button"
          className={`shape-picker-option${value === "" ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange("")}
          aria-pressed={value === ""}
        >
          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
            <svg width="46" height="18" viewBox="0 0 46 18">
              <line x1="4" y1="9" x2="42" y2="9" stroke={POSTGRES_RELATIONSHIP_PICKER_PREVIEW_COLOR} strokeWidth="2" strokeDasharray="5 5" />
            </svg>
          </div>
          <span className="shape-picker-label">{inheritLabel}</span>
        </button>
      ) : null}
      {POSTGRES_RELATIONSHIP_ARROWHEAD_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`shape-picker-option${value === option.value ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          title={option.label}
        >
          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
            <svg width="46" height="18" viewBox="0 0 46 18">
              <defs>
                <marker id={`arrow-end-${option.value}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill={POSTGRES_RELATIONSHIP_PICKER_PREVIEW_COLOR} />
                </marker>
                <marker id={`arrow-start-${option.value}`} markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto">
                  <path d="M8,0 L0,4 L8,8 z" fill={POSTGRES_RELATIONSHIP_PICKER_PREVIEW_COLOR} />
                </marker>
              </defs>
              <line
                x1="4"
                y1="9"
                x2="42"
                y2="9"
                stroke={POSTGRES_RELATIONSHIP_PICKER_PREVIEW_COLOR}
                strokeWidth="2.5"
                markerEnd={option.value === "none" ? undefined : `url(#arrow-end-${option.value})`}
                markerStart={option.value === "double_sided" ? `url(#arrow-start-${option.value})` : undefined}
              />
            </svg>
          </div>
          <span className="shape-picker-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PostgresRelationshipEndpointRestrictionColumn(props: {
  title: string;
  items: Array<{
    id: string;
    label: string;
    color?: string;
    outlineColor?: string;
    shape?: PostgresObjectTypeShape;
    fill?: PostgresObjectFill;
    sourceVisualKey?: PostgresSourceObjectVisualKey | null;
    imageStoragePath?: string;
  }>;
  value: string[];
  onChange: (value: string[]) => void;
  projectStoragePath: string;
}) {
  const { title, items, value, onChange, projectStoragePath } = props;
  const selected = new Set(value);
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: "#1f2933" }}>{title}</span>
          <span className="auth-hint" style={{ margin: 0 }}>{`${value.length} selected`}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn btn--small" onClick={() => onChange(items.map((item) => item.id))}>
            All
          </button>
          <button type="button" className="btn btn--small" onClick={() => onChange([])}>
            Clear
          </button>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gap: 8,
          maxHeight: 220,
          overflowY: "auto",
          padding: 10,
          borderRadius: 12,
          border: "1px solid rgba(53, 80, 112, 0.16)",
          background: "rgba(255, 255, 255, 0.94)",
        }}
      >
        {items.length === 0 ? (
          <p className="auth-hint" style={{ margin: 0 }}>No options available.</p>
        ) : items.map((item) => {
          const checked = selected.has(item.id);
          const accentColor = item.color || POSTGRES_RELATIONSHIP_DEFAULT_COLOR;
          const outlineColor = item.outlineColor || accentColor;
          const swatchShape = item.shape ?? "rounded";
          const swatchFill = item.fill ?? "outline";
          return (
            <label
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                borderRadius: 10,
                border: `1px solid ${checked ? hexToRgba(outlineColor, 0.42) : "rgba(53, 80, 112, 0.12)"}`,
                background: checked
                  ? `linear-gradient(180deg, ${hexToRgba(accentColor, 0.12)}, rgba(255, 255, 255, 0.96))`
                  : "rgba(255, 255, 255, 0.88)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  if (event.target.checked) {
                    onChange(Array.from(new Set([...value, item.id])));
                    return;
                  }
                  onChange(value.filter((id) => id !== item.id));
                }}
              />
              <ObjectShapeSwatch
                shape={swatchShape}
                fill={swatchFill}
                color={accentColor}
                outlineColor={outlineColor}
                sourceVisualKey={item.sourceVisualKey ?? null}
                imageStoragePath={item.imageStoragePath ?? ""}
                projectStoragePath={projectStoragePath}
                width={28}
                minHeight={22}
                selected={checked}
              />
              <span style={{ fontWeight: 600, color: "#1f2933", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function PostgresObjectGraphicPreviewCard(props: {
  label: string;
  projectStoragePath: string;
  imageStoragePath?: string;
  previewUrl?: string;
  shape: PostgresObjectTypeShape;
  fill: PostgresObjectFill;
  color: string;
  outlineColor: string;
  fillTransparency?: number;
  outlineWidth?: number;
  sourceVisualKey?: PostgresSourceObjectVisualKey | null;
  empty?: boolean;
}) {
  const {
    label,
    projectStoragePath,
    imageStoragePath = "",
    previewUrl = "",
    shape,
    fill,
    color,
    outlineColor,
    fillTransparency = POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY,
    outlineWidth = POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH,
    sourceVisualKey = null,
    empty = false,
  } = props;
  const imageUrl = usePostgresStoredImageUrl(projectStoragePath, imageStoragePath);
  const displayImageUrl = previewUrl || imageUrl;
  return (
    <div className="source-graphics-preview-card" aria-label={label}>
      <span className="form-label">Preview</span>
      <div className="source-graphics-preview-stage">
        {empty ? null : displayImageUrl ? (
          <img
            src={displayImageUrl}
            alt=""
            className="source-graphics-preview-image"
            style={{
              borderColor: outlineColor,
              borderWidth: normalizePostgresObjectOutlineWidth(outlineWidth),
            }}
          />
        ) : (
          <ObjectShapeSwatch
            shape={shape}
            fill={fill}
            color={color}
            outlineColor={outlineColor}
            sourceVisualKey={sourceVisualKey}
            width={144}
            minHeight={108}
            fillTransparency={fillTransparency}
            outlineWidth={outlineWidth}
          />
        )}
      </div>
    </div>
  );
}

export function PostgresRelationshipGraphicPreviewCard(props: {
  label: string;
  lineShape: PostgresRelationshipLineShape;
  lineWeight: number;
  arrowhead: PostgresRelationshipArrowhead;
  color: string;
}) {
  return (
    <div className="source-graphics-preview-card" aria-label={props.label}>
      <span className="form-label">Preview</span>
      <div className="source-graphics-preview-stage">
        <div className="relationship-graphics-preview-line">
          <RelationshipTypeLinePreview
            lineShape={props.lineShape}
            lineWeight={props.lineWeight}
            arrowhead={props.arrowhead}
            color={props.color}
          />
        </div>
      </div>
    </div>
  );
}
