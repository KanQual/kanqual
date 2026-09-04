type ExportTable = {
  name: string;
  rows: Record<string, unknown>[];
};

type ProjectExportAsset = {
  collection: string;
  recordId: string;
  field: string;
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

export type ProjectExportData = {
  format: "kanqual-project-export";
  version: 1;
  exportedAt: string;
  project: Record<string, unknown>;
  tables: ExportTable[];
  assets: ProjectExportAsset[];
};

export type ProjectBackupReason = "automatic" | "manual" | "session";

export type ProjectBackupEnvelope = {
  kind: "kanqual-project-backup";
  version: 1;
  createdAt: string;
  projectId: string;
  projectName: string;
  reason: ProjectBackupReason;
  payload: ProjectExportData;
};

export type RefiCodeNode = {
  guid: string;
  name: string;
  color: string;
  description: string;
  children: RefiCodeNode[];
};

const XLSX_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function flattenForSheet(row: Record<string, unknown>): Record<string, string | number | boolean> {
  const flat: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null) {
      flat[key] = "";
    } else if (Array.isArray(value)) {
      flat[key] = value.map((v) => typeof v === "object" ? JSON.stringify(v) : String(v)).join("; ");
    } else if (typeof value === "object") {
      flat[key] = JSON.stringify(value);
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      flat[key] = value;
    } else {
      flat[key] = String(value);
    }
  }
  return flat;
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(flattenForSheet(row))) seen.add(key);
  }
  return [...seen];
}

export function makeProjectBackupEnvelope(
  data: ProjectExportData,
  reason: ProjectBackupReason = "manual",
): ProjectBackupEnvelope {
  return {
    kind: "kanqual-project-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    projectId: String(data.project.id ?? ""),
    projectName: String(data.project.name ?? "Kanqual Project"),
    reason,
    payload: data,
  };
}

export function makeProjectBackupJson(
  data: ProjectExportData,
  reason: ProjectBackupReason = "manual",
): string {
  return JSON.stringify(makeProjectBackupEnvelope(data, reason), null, 2);
}

function tableRows(data: ProjectExportData, name: string): Record<string, unknown>[] {
  return data.tables.find((table) => table.name === name)?.rows ?? [];
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value) return [value];
  return [];
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sheetName(name: string, index: number): string {
  const safe = name.replace(/[\[\]:*?/\\]/g, "_").slice(0, 28);
  return safe || `Sheet ${index + 1}`;
}

function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - rem - 1) / 26);
  }
  return name;
}

function worksheetXml(table: ExportTable): string {
  const columns = collectColumns(table.rows);
  const rows = [
    columns,
    ...table.rows.map((row) => {
      const flat = flattenForSheet(row);
      return columns.map((column) => flat[column] ?? "");
    }),
  ];

  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${XLSX_NS}"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function workbookXml(tables: ExportTable[]): string {
  const sheets = tables.map((table, index) =>
    `<sheet name="${xmlEscape(sheetName(table.name, index))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${XLSX_NS}" xmlns:r="${REL_NS}"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelsXml(tables: ExportTable[]): string {
  const worksheetRels = tables.map((_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  const stylesRel = `<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheetRels}${stylesRel}</Relationships>`;
}

function contentTypesXml(tables: ExportTable[]): string {
  const sheetOverrides = tables.map((_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${XLSX_NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pushBytes(out: number[], bytes: Uint8Array): void {
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    out.push(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
  }
}

function pushNumbers(out: number[], values: number[]): void {
  const chunkSize = 0x8000;
  for (let index = 0; index < values.length; index += chunkSize) {
    out.push(...values.slice(index, index + chunkSize));
  }
}

function dosDateTime(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function createZip(files: { path: string; content: string | Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const out: number[] = [];
  const central: number[] = [];
  const timestamp = dosDateTime();

  for (const file of files) {
    const pathBytes = encoder.encode(file.path);
    const contentBytes = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const offset = out.length;
    const crc = crc32(contentBytes);

    writeUint32(out, 0x04034b50);
    writeUint16(out, 20);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, timestamp.time);
    writeUint16(out, timestamp.date);
    writeUint32(out, crc);
    writeUint32(out, contentBytes.length);
    writeUint32(out, contentBytes.length);
    writeUint16(out, pathBytes.length);
    writeUint16(out, 0);
    pushBytes(out, pathBytes);
    pushBytes(out, contentBytes);

    writeUint32(central, 0x02014b50);
    writeUint16(central, 20);
    writeUint16(central, 20);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, timestamp.time);
    writeUint16(central, timestamp.date);
    writeUint32(central, crc);
    writeUint32(central, contentBytes.length);
    writeUint32(central, contentBytes.length);
    writeUint16(central, pathBytes.length);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, 0);
    writeUint32(central, offset);
    pushBytes(central, pathBytes);
  }

  const centralOffset = out.length;
  pushNumbers(out, central);
  writeUint32(out, 0x06054b50);
  writeUint16(out, 0);
  writeUint16(out, 0);
  writeUint16(out, files.length);
  writeUint16(out, files.length);
  writeUint32(out, central.length);
  writeUint32(out, centralOffset);
  writeUint16(out, 0);

  return new Uint8Array(out);
}

function localName(el: Element): string {
  return el.localName || el.nodeName.split(":").pop() || el.nodeName;
}

function childElements(el: Element, name?: string): Element[] {
  return Array.from(el.children).filter((child) => !name || localName(child) === name);
}

function childElement(el: Element, name: string): Element | null {
  return childElements(el, name)[0] ?? null;
}

function childText(el: Element, name: string): string {
  return childElement(el, name)?.textContent?.trim() ?? "";
}

function attrValue(el: Element, name: string): string {
  return el.getAttribute(name) ?? "";
}

function parseRefiCode(el: Element): RefiCodeNode {
  return {
    guid: attrValue(el, "guid"),
    name: attrValue(el, "name") || "Untitled code",
    color: attrValue(el, "color") || "#f59e0b",
    description: childText(el, "Description"),
    children: childElements(el, "Code").map(parseRefiCode),
  };
}

function parseRefiCodebookXml(text: string): RefiCodeNode[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) throw new Error("The selected REFI-QDA Codebook XML could not be parsed.");

  const root = Array.from(doc.getElementsByTagName("*")).find((el) => localName(el) === "CodeBook");
  if (!root) throw new Error("The selected file does not contain a REFI-QDA CodeBook element.");

  const codesEl = childElement(root, "Codes");
  return codesEl ? childElements(codesEl, "Code").map(parseRefiCode) : [];
}

export function parseRefiQdaCodebook(text: string): RefiCodeNode[] {
  return parseRefiCodebookXml(text);
}

export function makeProjectBackupXlsx(data: ProjectExportData): Uint8Array {
  const files = [
    { path: "[Content_Types].xml", content: contentTypesXml(data.tables) },
    { path: "_rels/.rels", content: rootRelsXml() },
    { path: "xl/workbook.xml", content: workbookXml(data.tables) },
    { path: "xl/_rels/workbook.xml.rels", content: workbookRelsXml(data.tables) },
    { path: "xl/styles.xml", content: stylesXml() },
    ...data.tables.map((table, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      content: worksheetXml(table),
    })),
  ];
  return createZip(files);
}

function hash32(value: string, seed: number): number {
  let hash = 0x811c9dc5 ^ seed;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function guidFor(kind: string, id: unknown): string {
  const input = `${kind}:${String(id || kind)}`;
  const hex = [0, 1, 2, 3].map((seed) => hash32(input, seed).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function refiDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function attr(name: string, value: unknown): string {
  if (value == null || value === "") return "";
  return ` ${name}="${xmlEscape(value)}"`;
}

function element(name: string, attrs: Record<string, unknown>, children = ""): string {
  const attrText = Object.entries(attrs).map(([key, value]) => attr(key, value)).join("");
  return children ? `<${name}${attrText}>${children}</${name}>` : `<${name}${attrText}/>`;
}

function textElement(name: string, value: unknown): string {
  if (value == null || value === "") return "";
  return `<${name}>${xmlEscape(value)}</${name}>`;
}

function safeSourceFileName(name: string, id: unknown): string {
  const safeName = (name || "source").replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").replace(/\s+/g, "_").slice(0, 80);
  return `${safeName}_${String(id).slice(0, 8)}.txt`;
}

function safeZipPathPart(value: unknown, fallback: string): string {
  const normalized = String(value || fallback)
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[<>:"|?*\x00-\x1f]+/g, "_").replace(/\s+/g, "_").trim())
    .filter(Boolean)
    .join("/");
  return normalized || fallback;
}

function uniqueZipPath(path: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }
  const dotIndex = path.lastIndexOf(".");
  const base = dotIndex > 0 ? path.slice(0, dotIndex) : path;
  const extension = dotIndex > 0 ? path.slice(dotIndex) : "";
  let index = 2;
  while (usedPaths.has(`${base}_${index}${extension}`)) index += 1;
  const uniquePath = `${base}_${index}${extension}`;
  usedPaths.add(uniquePath);
  return uniquePath;
}

function sourceAssetZipPath(asset: ProjectExportAsset): string {
  return `Sources/Files/${safeZipPathPart(asset.fileName, "source-file")}`;
}

function sourceFileNameFromPath(path: unknown): string {
  const normalized = String(path || "").replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || normalized || "source file";
}

function appendTextBlock(...parts: unknown[]): string {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function variableType(dataType: unknown): string {
  if (dataType === "number") return "Float";
  if (dataType === "datetime") return "DateTime";
  return "Text";
}

function variableValueXml(variableGuid: string, dataType: unknown, value: unknown): string {
  if (value == null || value === "") return "";
  const tag = dataType === "number" ? "FloatValue" : dataType === "datetime" ? "DateTimeValue" : "TextValue";
  return `<VariableValue><VariableRef targetGUID="${variableGuid}"/>${textElement(tag, value)}</VariableValue>`;
}

function codeXml(
  code: Record<string, unknown>,
  childrenByParent: Map<string, Record<string, unknown>[]>,
  codeObjectLinksByCode: Map<string, string[]> = new Map(),
  caseById: Map<string, Record<string, unknown>> = new Map(),
): string {
  const children = childrenByParent.get(String(code.id)) ?? [];
  const linkedObjects = (codeObjectLinksByCode.get(String(code.id)) ?? [])
    .map((objectId) => caseById.get(objectId)?.name || caseById.get(objectId)?.title || objectId)
    .filter(Boolean);
  const description = linkedObjects.length
    ? appendTextBlock(code.description, `Linked objects: ${linkedObjects.join(", ")}`)
    : code.description;
  const body = [
    textElement("Description", description),
    ...children.map((child) => codeXml(child, childrenByParent, codeObjectLinksByCode, caseById)),
  ].join("");
  return element("Code", {
    guid: guidFor("code", code.id),
    name: code.label || "Untitled code",
    isCodable: "true",
    color: code.color,
  }, body);
}

function refiCodeBookXmlFromCodes(codes: Record<string, unknown>[]): string {
  const childrenByParent = new Map<string, Record<string, unknown>[]>();
  for (const code of codes) {
    const parent = typeof code.parent === "string" ? code.parent : "";
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent)!.push(code);
  }
  const topCodes = childrenByParent.get("") ?? [];
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<CodeBook xmlns="urn:QDA-XML:codebook:1.0" xmlns:qda="urn:QDA-XML:codebook:1.0" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="urn:QDA-XML:codebook:1.0 http://schema.qdasoftware.org/versions/Codebook/v1.0/Codebook.xsd">` +
    `<Codes>${topCodes.map((code) => codeXml(code, childrenByParent)).join("")}</Codes>` +
    `</CodeBook>`;
}

export function makeRefiQdaCodebook(data: ProjectExportData): string {
  const codes = tableRows(data, "codes").filter((row) => !row.deleted_at);
  return refiCodeBookXmlFromCodes(codes);
}

function makeRefiProjectXml(data: ProjectExportData): string {
  const project = data.project;
  const members = tableRows(data, "project_members");
  const documents = tableRows(data, "documents").filter((row) => !row.deleted_at);
  const codes = tableRows(data, "codes").filter((row) => !row.deleted_at);
  const annotations = tableRows(data, "annotations").filter((row) => !row.deleted_at);
  const annotationCodes = tableRows(data, "annotation_codes");
  const annotationObjects = tableRows(data, "annotation_objects");
  const codeObjects = tableRows(data, "code_objects");
  const cases = tableRows(data, "cases").filter((row) => !row.deleted_at);
  const caseDocuments = tableRows(data, "case_documents");
  const caseAttrDefs = tableRows(data, "case_attribute_definitions").filter((row) => !row.deleted_at);
  const caseAttrValues = tableRows(data, "case_attribute_values").filter((row) => !row.deleted_at);
  const docAttrDefs = tableRows(data, "document_attribute_definitions").filter((row) => !row.deleted_at);
  const docAttrValues = tableRows(data, "document_attribute_values").filter((row) => !row.deleted_at);
  const sourceFiles = tableRows(data, "source_files");
  const relationships = tableRows(data, "object_relationships").length
    ? tableRows(data, "object_relationships")
    : tableRows(data, "relationships");
  const relationshipAttrValues = tableRows(data, "relationship_attribute_values");
  const relationshipAttrDefs = tableRows(data, "relationship_attribute_definitions");
  const memos = tableRows(data, "memos").filter((row) => !row.deleted_at);
  const projectStorageAssets = data.assets.filter((asset) => asset.collection === "project_storage_files");
  const assetPathByRelativePath = new Map(projectStorageAssets.map((asset) => [asset.fileName, sourceAssetZipPath(asset)]));

  const userRows = members
    .map((member) => {
      const expanded = member.expand && typeof member.expand === "object" ? member.expand as Record<string, unknown> : {};
      const user = expanded.user && typeof expanded.user === "object" ? expanded.user as Record<string, unknown> : {};
      return {
        guid: guidFor("user", member.user),
        id: member.user,
        name: user.name || user.email || member.user || "Unknown user",
      };
    })
    .filter((user, index, users) => users.findIndex((u) => u.id === user.id) === index);

  const usersXml = userRows.length
    ? element("Users", {}, userRows.map((user) => element("User", user)).join(""))
    : "";

  const childrenByParent = new Map<string, Record<string, unknown>[]>();
  for (const code of codes) {
    const parent = typeof code.parent === "string" ? code.parent : "";
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent)!.push(code);
  }
  const caseById = new Map(cases.map((row) => [String(row.id), row]));
  const codeObjectLinksByCode = new Map<string, string[]>();
  for (const link of codeObjects) {
    const codeId = typeof link.code_id === "string" ? link.code_id : typeof link.code === "string" ? link.code : "";
    const objectId = typeof link.object_id === "string" ? link.object_id : typeof link.object === "string" ? link.object : "";
    if (!codeId || !objectId) continue;
    if (!codeObjectLinksByCode.has(codeId)) codeObjectLinksByCode.set(codeId, []);
    codeObjectLinksByCode.get(codeId)!.push(objectId);
  }
  const topCodes = childrenByParent.get("") ?? [];
  const codeBookXml = topCodes.length
    ? `<CodeBook><Codes>${topCodes.map((code) => codeXml(code, childrenByParent, codeObjectLinksByCode, caseById)).join("")}</Codes></CodeBook>`
    : "";

  const allVariableDefs: Array<Record<string, unknown> & { scope: "case" | "document" }> = [
    ...caseAttrDefs.map((row) => ({ ...row, scope: "case" as const })),
    ...docAttrDefs.map((row) => ({ ...row, scope: "document" as const })),
  ];
  const variablesXml = allVariableDefs.length
    ? element("Variables", {}, allVariableDefs.map((row) =>
        element("Variable", {
          guid: guidFor(`${row.scope}_variable`, row.id),
          name: row.scope === "case" ? `Case: ${row.name}` : `Document: ${row.name}`,
          typeOfVariable: variableType(row.data_type),
        })
      ).join(""))
    : "";

  const caseDocMap = new Map<string, string[]>();
  for (const link of caseDocuments) {
    if (typeof link.case !== "string" || typeof link.document !== "string") continue;
    if (!caseDocMap.has(link.case)) caseDocMap.set(link.case, []);
    caseDocMap.get(link.case)!.push(link.document);
  }
  const caseValuesByCase = new Map<string, Record<string, unknown>[]>();
  for (const value of caseAttrValues) {
    if (typeof value.case !== "string") continue;
    if (!caseValuesByCase.has(value.case)) caseValuesByCase.set(value.case, []);
    caseValuesByCase.get(value.case)!.push(value);
  }
  const caseDefById = new Map(caseAttrDefs.map((def) => [String(def.id), def]));
  const casesXml = cases.length
    ? element("Cases", {}, cases.map((row) => {
        const variableValues = (caseValuesByCase.get(String(row.id)) ?? []).map((value) => {
          const def = caseDefById.get(String(value.attribute));
          return def ? variableValueXml(guidFor("case_variable", def.id), def.data_type, value.value) : "";
        }).join("");
        const sourceRefs = (caseDocMap.get(String(row.id)) ?? [])
          .map((docId) => element("SourceRef", { targetGUID: guidFor("document", docId) }))
          .join("");
        return element("Case", { guid: guidFor("case", row.id), name: row.name }, [
          textElement("Description", row.notes),
          variableValues,
          sourceRefs,
        ].join(""));
      }).join(""))
    : "";

  const annotationObjectLinksByAnnotation = new Map<string, string[]>();
  for (const link of annotationObjects) {
    const annotationId = typeof link.annotation_id === "string" ? link.annotation_id : typeof link.annotation === "string" ? link.annotation : "";
    const objectId = typeof link.object_id === "string" ? link.object_id : typeof link.object === "string" ? link.object : "";
    if (!annotationId || !objectId) continue;
    if (!annotationObjectLinksByAnnotation.has(annotationId)) annotationObjectLinksByAnnotation.set(annotationId, []);
    annotationObjectLinksByAnnotation.get(annotationId)!.push(objectId);
  }
  const annotationCodeIdsByAnnotation = new Map<string, string[]>();
  for (const annotation of annotations) {
    const annotationId = String(annotation.id);
    const codeIds = stringArray(annotation.code_ids);
    if (typeof annotation.code === "string" && annotation.code) codeIds.unshift(annotation.code);
    annotationCodeIdsByAnnotation.set(annotationId, [...new Set(codeIds.filter(Boolean))]);
  }
  for (const link of annotationCodes) {
    const annotationId = typeof link.annotation_id === "string" ? link.annotation_id : typeof link.annotation === "string" ? link.annotation : "";
    const codeId = typeof link.code_id === "string" ? link.code_id : typeof link.code === "string" ? link.code : "";
    if (!annotationId || !codeId) continue;
    const current = annotationCodeIdsByAnnotation.get(annotationId) ?? [];
    if (!current.includes(codeId)) current.push(codeId);
    annotationCodeIdsByAnnotation.set(annotationId, current);
  }
  const sourceFilesBySource = new Map<string, Record<string, unknown>[]>();
  for (const file of sourceFiles) {
    const sourceId = typeof file.source_id === "string" ? file.source_id : typeof file.source === "string" ? file.source : "";
    if (!sourceId) continue;
    if (!sourceFilesBySource.has(sourceId)) sourceFilesBySource.set(sourceId, []);
    sourceFilesBySource.get(sourceId)!.push(file);
  }
  const annotationsByDocument = new Map<string, Record<string, unknown>[]>();
  for (const annotation of annotations) {
    if (typeof annotation.document !== "string") continue;
    if (!annotationsByDocument.has(annotation.document)) annotationsByDocument.set(annotation.document, []);
    annotationsByDocument.get(annotation.document)!.push(annotation);
  }
  const docValuesByDoc = new Map<string, Record<string, unknown>[]>();
  for (const value of docAttrValues) {
    if (typeof value.document !== "string") continue;
    if (!docValuesByDoc.has(value.document)) docValuesByDoc.set(value.document, []);
    docValuesByDoc.get(value.document)!.push(value);
  }
  const docDefById = new Map(docAttrDefs.map((def) => [String(def.id), def]));
  const sourcesXml = documents.length
    ? element("Sources", {}, documents.map((doc) => {
        const selections = (annotationsByDocument.get(String(doc.id)) ?? []).map((annotation, index) => {
          const codings = (annotationCodeIdsByAnnotation.get(String(annotation.id)) ?? [])
            .map((codeId) => element("Coding", {
              guid: guidFor("coding", `${annotation.id}:${codeId}`),
              creatingUser: annotation.created_by ? guidFor("user", annotation.created_by) : undefined,
              creationDateTime: refiDate(annotation.created),
            }, element("CodeRef", { targetGUID: guidFor("code", codeId) })))
            .join("");
          const linkedObjects = (annotationObjectLinksByAnnotation.get(String(annotation.id)) ?? [])
            .map((objectId) => caseById.get(objectId)?.name || caseById.get(objectId)?.title || objectId)
            .filter(Boolean);
          const description = linkedObjects.length
            ? appendTextBlock(annotation.note, `Linked objects: ${linkedObjects.join(", ")}`)
            : annotation.note;
          return element("PlainTextSelection", {
            guid: guidFor("annotation", annotation.id),
            name: `Selection ${index + 1}`,
            startPosition: annotation.start_offset,
            endPosition: annotation.end_offset,
            creatingUser: annotation.created_by ? guidFor("user", annotation.created_by) : undefined,
            creationDateTime: refiDate(annotation.created),
          }, textElement("Description", description) + codings);
        }).join("");
        const variableValues = (docValuesByDoc.get(String(doc.id)) ?? []).map((value) => {
          const def = docDefById.get(String(value.attribute));
          return def ? variableValueXml(guidFor("document_variable", def.id), def.data_type, value.value) : "";
        }).join("");
        const attachedFiles = (sourceFilesBySource.get(String(doc.id)) ?? [])
          .map((file) => {
            const storagePath = String(file.storage_path || "");
            const packagePath = assetPathByRelativePath.get(storagePath);
            const fileName = file.original_file_name || sourceFileNameFromPath(storagePath);
            return packagePath ? `${fileName}: ${packagePath}` : String(fileName);
          })
          .filter(Boolean);
        const sourceStoragePath = typeof doc.storage_path === "string" ? assetPathByRelativePath.get(doc.storage_path) : "";
        const fileDescription = [
          sourceStoragePath ? `Primary source file: ${sourceStoragePath}` : "",
          attachedFiles.length ? `Attached source files:\n${attachedFiles.join("\n")}` : "",
        ].filter(Boolean).join("\n\n");
        return element("TextSource", {
          guid: guidFor("document", doc.id),
          name: doc.name,
          plainTextPath: `internal://${safeSourceFileName(String(doc.name || "source"), doc.id)}`,
          creatingUser: doc.created_by ? guidFor("user", doc.created_by) : undefined,
          creationDateTime: refiDate(doc.created),
          modifiedDateTime: refiDate(doc.updated),
        }, textElement("Description", appendTextBlock(doc.notes, fileDescription)) + selections + variableValues);
      }).join(""))
    : "";

  const relationshipDefById = new Map(relationshipAttrDefs.map((def) => [String(def.id), def]));
  const relationshipValuesByRelationship = new Map<string, Record<string, unknown>[]>();
  for (const value of relationshipAttrValues) {
    const relationshipId = typeof value.relationship_id === "string" ? value.relationship_id : typeof value.relationship === "string" ? value.relationship : "";
    if (!relationshipId) continue;
    if (!relationshipValuesByRelationship.has(relationshipId)) relationshipValuesByRelationship.set(relationshipId, []);
    relationshipValuesByRelationship.get(relationshipId)!.push(value);
  }
  const relationshipNotesXml = relationships.map((relationship) => {
    const relationshipId = String(relationship.id || "");
    const fromId = String(relationship.from_entity_id || relationship.from_object_id || relationship.object1Id || relationship.fromObjectId || "");
    const toId = String(relationship.to_entity_id || relationship.to_object_id || relationship.object2Id || relationship.toObjectId || "");
    const fromName = caseById.get(fromId)?.name || caseById.get(fromId)?.title || fromId || "Unknown";
    const toName = caseById.get(toId)?.name || caseById.get(toId)?.title || toId || "Unknown";
    const attrLines = (relationshipValuesByRelationship.get(relationshipId) ?? [])
      .map((value) => {
        const def = relationshipDefById.get(String(value.attribute_definition_id || value.attribute));
        const name = def?.name || value.attribute_definition_id || value.attribute || "Attribute";
        return `${name}: ${value.value ?? ""}`;
      })
      .filter(Boolean);
    const body = appendTextBlock(
      `${fromName} -> ${toName}`,
      `Type: ${relationship.relationship_type || relationship.relationshipType || "Relationship"}`,
      relationship.description,
      attrLines.length ? attrLines.join("\n") : "",
    );
    return element("Note", {
      guid: guidFor("relationship_note", relationshipId),
      name: `Relationship: ${fromName} -> ${toName}`,
      creationDateTime: refiDate(relationship.created_at || relationship.created),
      modifiedDateTime: refiDate(relationship.updated_at || relationship.updated),
    }, textElement("PlainTextContent", body));
  }).join("");
  const supplementTableNames = [
    "project_settings",
    "source_type_settings",
    "source_files",
    "annotation_codes",
    "annotation_objects",
    "code_objects",
    "event_objects",
    "object_relationships",
    "relationship_attribute_values",
    "source_attribute_value_history",
    "object_attribute_value_history",
    "relationship_attribute_value_history",
    "memo_sources",
    "memo_annotations",
    "memo_codes",
    "memo_objects",
    "saved_drawings",
    "timeline_groups",
    "timeline_item_group_assignments",
    "timeline_group_row_orders",
  ];
  const supplementPayload = {
    format: "kanqual-refi-qda-supplement",
    version: 1,
    exportedAt: data.exportedAt,
    tables: supplementTableNames.map((name) => ({ name, rows: tableRows(data, name) })),
    assets: projectStorageAssets.map((asset) => ({
      fileName: asset.fileName,
      packagePath: sourceAssetZipPath(asset),
      sizeBase64Chars: asset.dataBase64.length,
    })),
  };
  const supplementXml = element("Note", {
    guid: guidFor("kanqual_supplement", project.id || project.name || "project"),
    name: "Kanqual export supplement",
    creationDateTime: refiDate(data.exportedAt),
    modifiedDateTime: refiDate(data.exportedAt),
  }, textElement("PlainTextContent", JSON.stringify(supplementPayload, null, 2)));
  const notesXml = memos.length
    ? element("Notes", {}, memos.map((memo) =>
        element("Note", {
          guid: guidFor("memo", memo.id),
          name: memo.title || "Untitled memo",
          creatingUser: memo.created_by ? guidFor("user", memo.created_by) : undefined,
          creationDateTime: refiDate(memo.created),
          modifiedDateTime: refiDate(memo.updated),
        }, textElement("PlainTextContent", memo.body))
      ).join("") + relationshipNotesXml + supplementXml)
    : element("Notes", {}, relationshipNotesXml + supplementXml);

  const body = [
    usersXml,
    codeBookXml,
    variablesXml,
    casesXml,
    sourcesXml,
    notesXml,
    textElement("Description", project.description),
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Project xmlns="urn:QDA-XML:project:1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    attr("name", project.name || "Kanqual Project") +
    attr("origin", "Kanqual") +
    attr("creationDateTime", refiDate(project.created)) +
    attr("modifiedDateTime", refiDate(project.updated)) +
    attr("basePath", ".") +
    `>${body}</Project>`;
}

export function makeRefiQdaProject(data: ProjectExportData): Uint8Array {
  const documents = tableRows(data, "documents").filter((row) => !row.deleted_at);
  const usedPaths = new Set<string>();
  const projectStorageAssets = data.assets.filter((asset) => asset.collection === "project_storage_files");
  const files = [
    { path: uniqueZipPath("project.qde", usedPaths), content: makeRefiProjectXml(data) },
    ...documents.map((doc) => ({
      path: uniqueZipPath(`Sources/${safeSourceFileName(String(doc.name || "source"), doc.id)}`, usedPaths),
      content: String(doc.content ?? ""),
    })),
    ...projectStorageAssets.map((asset) => ({
      path: uniqueZipPath(sourceAssetZipPath(asset), usedPaths),
      content: base64ToBytes(asset.dataBase64),
    })),
  ];
  return createZip(files);
}
