import {
  type PostgresCanvasDisplayShape,
  type PostgresCanvasPoint,
  type PostgresCanvasShape,
} from "./postgres";
import {
  formatPostgresObjectShapeLabel,
  getPostgresRelationshipStrokeDasharray,
  getSvgShapePoints,
  hexToRgba,
  normalizePostgresRelationshipLineShape,
  type PostgresObjectFill,
  type PostgresRelationshipLineShape,
} from "./postgresGraphics";

export function normalizeCanvasSvgTextHtml(html: string): string {
  const trimmed = html.trim();
  return trimmed ? html : "<div>Text</div>";
}

export function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function getCanvasSketchShapeType(shape: PostgresCanvasShape): PostgresCanvasDisplayShape {
  if (shape.kind === "shape") return shape.shape;
  return "rectangle";
}

export function getCanvasSketchShapeFill(
  shape: Extract<PostgresCanvasShape, { kind: "rectangle" | "shape" }>,
): PostgresObjectFill {
  return shape.fill === "outline" ? "outline" : "filled";
}

export function getCanvasSketchLineStyle(
  shape: Extract<PostgresCanvasShape, { kind: "pen" | "rectangle" | "shape" }>,
): PostgresRelationshipLineShape {
  return normalizePostgresRelationshipLineShape(shape.lineStyle ?? "");
}

export function formatCanvasSketchShapeLabel(shape: PostgresCanvasDisplayShape): string {
  return formatPostgresObjectShapeLabel(shape);
}

export function stripCanvasRichText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<li>/gi, "* ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

export function renderCanvasTextForeignObjectSvg(
  shape: Extract<PostgresCanvasShape, { kind: "text" }>,
  minX: number,
  minY: number,
): string {
  const x = shape.x - minX;
  const y = shape.y - minY;
  const html = normalizeCanvasSvgTextHtml(shape.html);
  return `
    <foreignObject x="${x}" y="${y}" width="${shape.width}" height="${shape.height}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:${shape.width}px;min-height:${shape.height}px;box-sizing:border-box;padding:6px 8px;color:${shape.color};font: ${shape.fontSize}px/1.35 Inter, sans-serif;text-align:${shape.textAlign};overflow-wrap:anywhere;word-break:break-word;white-space:normal;">
        ${html}
      </div>
    </foreignObject>
  `;
}

export function wrapCanvasTextLines(text: string, width: number, fontSize: number): string[] {
  const normalized = text.replace(/\r/g, "");
  const maxCharsPerLine = Math.max(8, Math.floor((width - 16) / Math.max(fontSize * 0.58, 1)));
  const paragraphs = normalized.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let currentLine = "";
    for (const word of words) {
      const nextLine = currentLine ? `${currentLine} ${word}` : word;
      if (nextLine.length <= maxCharsPerLine) {
        currentLine = nextLine;
        continue;
      }
      if (currentLine) {
        lines.push(currentLine);
      }
      if (word.length <= maxCharsPerLine) {
        currentLine = word;
        continue;
      }
      for (let index = 0; index < word.length; index += maxCharsPerLine) {
        const chunk = word.slice(index, index + maxCharsPerLine);
        if (chunk.length === maxCharsPerLine) {
          lines.push(chunk);
        } else {
          currentLine = chunk;
        }
      }
      if (word.length % maxCharsPerLine === 0) {
        currentLine = "";
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length ? lines : ["Text"];
}

export function renderCanvasSketchShapeElement(
  shape: Extract<PostgresCanvasShape, { kind: "rectangle" | "shape" }>,
  selected: boolean,
  interactive = true,
) {
  const stroke = selected ? "#d62828" : shape.color;
  const strokeWidth = selected ? shape.strokeWidth + 1 : shape.strokeWidth;
  const strokeDasharray = getPostgresRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
  const fillMode = getCanvasSketchShapeFill(shape);
  const fill = selected
    ? "rgba(214, 40, 40, 0.08)"
    : fillMode === "outline"
      ? "transparent"
      : hexToRgba(shape.fillColor || shape.color, (shape.fillOpacity ?? 8) / 100);
  const shapeType = getCanvasSketchShapeType(shape);

  if (shapeType === "rectangle") {
    return (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        pointerEvents={interactive ? "all" : "none"}
        style={{ cursor: interactive ? "pointer" : "default" }}
      />
    );
  }

  if (shapeType === "rounded") {
    const radius = Math.max(0, (Math.min(shape.width, shape.height) / 2) - strokeWidth / 2);
    return (
      <circle
        cx={shape.x + shape.width / 2}
        cy={shape.y + shape.height / 2}
        r={radius}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        pointerEvents={interactive ? "all" : "none"}
        style={{ cursor: interactive ? "pointer" : "default" }}
      />
    );
  }

  const points = getSvgShapePoints(shapeType, shape.width, shape.height);
  const shiftedPoints = (points ?? "")
    .split(" ")
    .map((pair) => {
      const [px, py] = pair.split(",").map(Number);
      return `${shape.x + px},${shape.y + py}`;
    })
    .join(" ");

  return (
    <polygon
      points={shiftedPoints}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={strokeDasharray}
      strokeLinejoin="round"
      pointerEvents={interactive ? "all" : "none"}
      style={{ cursor: interactive ? "pointer" : "default" }}
    />
  );
}

export function getCanvasShapeBounds(shape: PostgresCanvasShape): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (shape.kind === "pen") {
    const xs = shape.points.map((point) => point.x);
    const ys = shape.points.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }
  return {
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
  };
}

export function translateCanvasShape(
  shape: PostgresCanvasShape,
  deltaX: number,
  deltaY: number,
): PostgresCanvasShape {
  if (shape.kind === "pen") {
    return {
      ...shape,
      points: shape.points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })),
    };
  }
  return {
    ...shape,
    x: shape.x + deltaX,
    y: shape.y + deltaY,
  };
}

export function distancePointToSegment(
  point: PostgresCanvasPoint,
  start: PostgresCanvasPoint,
  end: PostgresCanvasPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / ((dx * dx) + (dy * dy))));
  const projectionX = start.x + (t * dx);
  const projectionY = start.y + (t * dy);
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

export function isWorldPointInsideCanvasShape(
  shape: PostgresCanvasShape,
  point: PostgresCanvasPoint,
): boolean {
  if (shape.kind === "pen") {
    for (let index = 1; index < shape.points.length; index += 1) {
      if (distancePointToSegment(point, shape.points[index - 1], shape.points[index]) <= Math.max(10, shape.strokeWidth + 6)) {
        return true;
      }
    }
    return false;
  }

  const bounds = getCanvasShapeBounds(shape);
  return (
    point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height
  );
}

export function resizeCanvasBoxShape(
  shape: Extract<PostgresCanvasShape, { kind: "rectangle" | "shape" | "text" }>,
  handle: "nw" | "ne" | "sw" | "se",
  currentX: number,
  currentY: number,
): Extract<PostgresCanvasShape, { kind: "rectangle" | "shape" | "text" }> {
  const minSize = 24;
  const left = shape.x;
  const top = shape.y;
  const right = shape.x + shape.width;
  const bottom = shape.y + shape.height;
  const anchorX = handle === "nw" || handle === "sw" ? right : left;
  const anchorY = handle === "nw" || handle === "ne" ? bottom : top;
  const rawLeft = Math.min(anchorX, currentX);
  const rawRight = Math.max(anchorX, currentX);
  const rawTop = Math.min(anchorY, currentY);
  const rawBottom = Math.max(anchorY, currentY);
  const width = Math.max(minSize, rawRight - rawLeft);
  const height = Math.max(minSize, rawBottom - rawTop);

  return {
    ...shape,
    x: handle === "nw" || handle === "sw" ? anchorX - width : anchorX,
    y: handle === "nw" || handle === "ne" ? anchorY - height : anchorY,
    width,
    height,
  };
}

export function renderCanvasSketchShapeSvg(
  shape: PostgresCanvasShape,
  minX: number,
  minY: number,
  mode: "screen" | "pdf" = "screen",
): string {
  if (shape.kind === "pen") {
    const strokeDasharray = getPostgresRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
    return `<polyline points="${shape.points.map((point: PostgresCanvasPoint) => `${point.x - minX},${point.y - minY}`).join(" ")}" fill="none" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} stroke-linecap="round" stroke-linejoin="round" />`;
  }
  if (shape.kind === "text") {
    if (mode === "screen") {
      return renderCanvasTextForeignObjectSvg(shape, minX, minY);
    }
    const plainText = stripCanvasRichText(shape.html) || "Text";
    const lines = wrapCanvasTextLines(plainText, shape.width, shape.fontSize);
    const anchor = shape.textAlign === "center" ? "middle" : shape.textAlign === "right" ? "end" : "start";
    const textX = shape.textAlign === "center"
      ? shape.x - minX + (shape.width / 2)
      : shape.textAlign === "right"
        ? shape.x - minX + shape.width
        : shape.x - minX;
    const baseY = shape.y - minY + shape.fontSize;
    const tspans = lines.map((line, index) => (
      `<tspan x="${textX}" y="${baseY + (index * (shape.fontSize * 1.35))}">${escapeSvgText(line)}</tspan>`
    )).join("");
    return `<text font-family="Inter, sans-serif" font-size="${shape.fontSize}" fill="${shape.color}" text-anchor="${anchor}">${tspans}</text>`;
  }
  const shapeType = getCanvasSketchShapeType(shape);
  const x = shape.x - minX;
  const y = shape.y - minY;
  const strokeDasharray = getPostgresRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
  const fillMode = getCanvasSketchShapeFill(shape);
  const fillColor = fillMode === "outline" ? "#ffffff" : hexToRgba(shape.color, 0.08);
  if (shapeType === "rectangle") {
    return `<rect x="${x}" y="${y}" width="${shape.width}" height="${shape.height}" fill="${fillColor}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} />`;
  }
  if (shapeType === "rounded") {
    const radius = Math.max(0, (Math.min(shape.width, shape.height) / 2) - shape.strokeWidth / 2);
    return `<circle cx="${x + shape.width / 2}" cy="${y + shape.height / 2}" r="${radius}" fill="${fillColor}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} />`;
  }
  const points = getSvgShapePoints(shapeType, shape.width, shape.height);
  if (points) {
    const shiftedPoints = points
      .split(" ")
      .map((pair) => {
        const [px, py] = pair.split(",").map(Number);
        return `${x + px},${y + py}`;
      })
      .join(" ");
    return `<polygon points="${shiftedPoints}" fill="${fillColor}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} stroke-linejoin="round" />`;
  }
  return `<rect x="${x}" y="${y}" width="${shape.width}" height="${shape.height}" fill="${fillColor}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} />`;
}
