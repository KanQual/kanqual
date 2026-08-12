import { readAppSettings, type LlmSettings } from "./appSettings";
import { htmlToPlainText } from "./htmlText";
import {
  loadPostgresProjectWorkspaceSnapshot,
  type PostgresProjectWorkspaceSnapshot,
} from "./postgresProjectWorkspace";

export type ProjectEmbeddingBuildItem = {
  id: string;
  itemType: string;
  sourceId?: string;
  title: string;
  text: string;
  contentHash: string;
  documentId?: string;
  caseId?: string;
  relationshipId?: string;
  objectId?: string;
  codeId?: string;
  annotationId?: string;
  memoId?: string;
  startOffset?: number;
  endOffset?: number;
};

export type ProjectEmbeddingBuildSource = {
  sourceType:
    | "source"
    | "object"
    | "relationship"
    | "code"
    | "annotation"
    | "memo"
    | "source-attribute-definition"
    | "object-attribute-definition"
    | "relationship-attribute-definition"
    | "object-type"
    | "relationship-type";
  sourceId: string;
  title: string;
  sourceHash: string;
  items: ProjectEmbeddingBuildItem[];
};

export type ProjectEmbeddingStoreStatus = {
  exists: boolean;
  generatedAtMs: number | null;
  itemCount: number;
  modelRepoId?: string | null;
  modelDisplayName?: string | null;
  contentFingerprint?: string | null;
};

export type ProjectEmbeddingBuildStatus = {
  phase: "idle" | "running" | "cancelling" | "cancelled" | "completed" | "error";
  projectId: string | null;
  totalItems: number;
  completedItems: number;
  totalSources?: number;
  currentSourceIndex?: number | null;
  progressPercent: number | null;
  startedAtMs?: number | null;
  currentLabel: string | null;
  message: string | null;
};

export type ProjectEmbeddingBuildPreflight = {
  totalItems: number;
  pendingItems: number;
  reusedItems: number;
  pendingCharacters: number;
  estimatedSecondsLow: number | null;
  estimatedSecondsHigh: number | null;
  parallelism: number;
  estimateLabel: string;
};

const EMBEDDING_CHUNK_TOKEN_LIMIT = 448;
const PROJECT_EMBEDDING_CHUNKING_VERSION = 2;
const CJK_CHARACTER = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u;
const TOKEN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]|[\p{L}\p{N}]+(?:['_-][\p{L}\p{N}]+)*|[^\s]/gu;

function normalizeEmbeddingText(text: string, normalizeWhitespace: boolean): string {
  return normalizeWhitespace ? text.replace(/\s+/g, " ").trim() : text.trim();
}

function hashEmbeddingText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function projectEmbeddingSettingsHash(llmSettings: LlmSettings): string {
  return hashEmbeddingText(
    `chunk:${llmSettings.chunkSize}|overlap:${llmSettings.overlapSize}|prefix:${llmSettings.prefixPassages}|normalize:${llmSettings.normalizeWhitespace}|chunking:${PROJECT_EMBEDDING_CHUNKING_VERSION}`,
  );
}

export function buildPostgresProjectEmbeddingSourcesFingerprint(
  sources: ProjectEmbeddingBuildSource[],
  llmSettings: LlmSettings = readAppSettings().llm,
): string {
  const sourceLines = sources
    .map((source) => `source|${source.sourceType}|${source.sourceId}|${source.sourceHash}|${source.items.length}`)
    .sort();
  const itemLines = sources
    .flatMap((source) => source.items.map((item) => `item|${source.sourceType}|${source.sourceId}|${item.id}|${item.contentHash}`))
    .sort();
  return hashEmbeddingText([
    `settings|${projectEmbeddingSettingsHash(llmSettings)}`,
    ...sourceLines,
    ...itemLines,
  ].join("\n"));
}

type ChunkingToken = {
  startOffset: number;
  endOffset: number;
  estimatedTokens: number;
};

function estimateTokenWeight(token: string): number {
  if (!token) return 0;
  if (CJK_CHARACTER.test(token)) return [...token].length;
  if (/^[\p{L}\p{N}]+(?:['_-][\p{L}\p{N}]+)*$/u.test(token)) {
    return Math.max(1, Math.ceil([...token].length / 4));
  }
  return 1;
}

function tokenizeForChunking(text: string): ChunkingToken[] {
  const tokens: ChunkingToken[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const value = match[0];
    const startOffset = match.index ?? 0;
    tokens.push({
      startOffset,
      endOffset: startOffset + value.length,
      estimatedTokens: estimateTokenWeight(value),
    });
  }
  return tokens;
}

function findNextTokenIndex(tokens: ChunkingToken[], fromIndex: number, desiredStartOffset: number): number {
  let low = fromIndex;
  let high = tokens.length - 1;
  let nextIndex = tokens.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (tokens[mid].startOffset >= desiredStartOffset) {
      nextIndex = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return nextIndex;
}

function chunkDocumentText(text: string, chunkSize: number, overlapSize: number): Array<{ text: string; startOffset: number; endOffset: number }> {
  if (!text) return [];
  const tokens = tokenizeForChunking(text);
  if (tokens.length === 0) return [];
  const chunks: Array<{ text: string; startOffset: number; endOffset: number }> = [];
  let tokenStartIndex = 0;

  while (tokenStartIndex < tokens.length) {
    const chunkStart = tokens[tokenStartIndex].startOffset;
    let chunkEnd = tokens[tokenStartIndex].endOffset;
    let estimatedTokens = 0;
    let tokenEndIndex = tokenStartIndex;

    while (tokenEndIndex < tokens.length) {
      const token = tokens[tokenEndIndex];
      const nextEstimatedTokens = estimatedTokens + token.estimatedTokens;
      const nextChunkEnd = token.endOffset;
      const nextChunkLength = nextChunkEnd - chunkStart;

      if ((nextEstimatedTokens > EMBEDDING_CHUNK_TOKEN_LIMIT || nextChunkLength > chunkSize) && tokenEndIndex > tokenStartIndex) {
        break;
      }

      estimatedTokens = nextEstimatedTokens;
      chunkEnd = nextChunkEnd;
      tokenEndIndex += 1;

      if (estimatedTokens >= EMBEDDING_CHUNK_TOKEN_LIMIT || nextChunkLength >= chunkSize) {
        break;
      }
    }

    const chunk = text.slice(chunkStart, chunkEnd);
    const trimmed = chunk.trim();
    if (trimmed) {
      const leadingWhitespace = chunk.length - chunk.trimStart().length;
      const trailingWhitespace = chunk.length - chunk.trimEnd().length;
      chunks.push({
        text: trimmed,
        startOffset: chunkStart + leadingWhitespace,
        endOffset: chunkEnd - trailingWhitespace,
      });
    }

    if (tokenEndIndex >= tokens.length) break;

    const desiredNextStartOffset = Math.max(chunkStart + 1, chunkEnd - overlapSize);
    const nextTokenIndex = findNextTokenIndex(tokens, tokenStartIndex + 1, desiredNextStartOffset);
    tokenStartIndex = nextTokenIndex < tokens.length ? nextTokenIndex : tokenEndIndex;
  }

  return chunks;
}

function buildPostgresSourceSource(
  source: PostgresProjectWorkspaceSnapshot["sources"][number],
  sourceAttributeValues: PostgresProjectWorkspaceSnapshot["sourceAttributeValues"],
  llmSettings: LlmSettings,
): ProjectEmbeddingBuildSource | null {
  const attributeLines = formatPostgresAttributeValues(sourceAttributeValues);
  const sourceTextExcerpt = normalizeEmbeddingText(source.textContent, llmSettings.normalizeWhitespace)
    .slice(0, Math.max(0, Math.min(llmSettings.chunkSize, 1800)))
    .trim();
  const sourceLevelBody = [
    source.title ? `Source: ${source.title}` : "",
    source.sourceKind ? `Source type: ${source.sourceKind}` : "",
    source.notes ? `Notes: ${htmlToPlainText(source.notes)}` : "",
    attributeLines.length > 0 ? `Attributes:\n${attributeLines.join("\n")}` : "",
    sourceTextExcerpt ? `Source text excerpt:\n${sourceTextExcerpt}` : "",
  ].filter(Boolean).join("\n\n");
  const body = [
    source.title ? `Source: ${source.title}` : "",
    source.sourceKind ? `Source type: ${source.sourceKind}` : "",
    source.textContent,
    source.notes ? `Notes: ${htmlToPlainText(source.notes)}` : "",
    attributeLines.length > 0 ? `Attributes:\n${attributeLines.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const chunks = chunkDocumentText(body, llmSettings.chunkSize, llmSettings.overlapSize);
  const normalizeWhitespace = llmSettings.normalizeWhitespace;
  const passagePrefix = llmSettings.prefixPassages ? "passage: " : "";
  const items: ProjectEmbeddingBuildItem[] = [];
  const normalizedSourceLevelBody = normalizeEmbeddingText(sourceLevelBody, normalizeWhitespace);

  if (normalizedSourceLevelBody) {
    const embeddingText = `${passagePrefix}${normalizedSourceLevelBody}`;
    items.push({
      id: `source::${source.id}`,
      itemType: "source",
      sourceId: source.id,
      title: source.title,
      text: embeddingText,
      contentHash: hashEmbeddingText(embeddingText),
    });
  }

  chunks.forEach((chunk, index) => {
    const normalizedChunk = normalizeEmbeddingText(chunk.text, normalizeWhitespace);
    if (!normalizedChunk) return;
    const embeddingText = `${passagePrefix}${normalizedChunk}`;
    items.push({
      id: `source::${source.id}::chunk-${index + 1}`,
      itemType: "text-segment",
      sourceId: source.id,
      title: `${source.title} (chunk ${index + 1})`,
      text: embeddingText,
      contentHash: hashEmbeddingText(embeddingText),
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
    });
  });

  if (items.length === 0) return null;

  return {
    sourceType: "source",
    sourceId: source.id,
    title: source.title,
    sourceHash: hashEmbeddingText(
      `source\n${source.title}\n${source.sourceKind}\n${normalizeEmbeddingText(body, normalizeWhitespace)}`,
    ),
    items,
  };
}

function formatPostgresAttributeValues(
  values: Array<{ attributeName: string; value: string }>,
): string[] {
  return values
    .filter((value) => value.attributeName.trim() && value.value.trim())
    .sort((left, right) => left.attributeName.localeCompare(right.attributeName))
    .map((value) => `${value.attributeName}: ${value.value}`);
}

function formatOptions(options: string[]): string {
  return options.map((option) => option.trim()).filter(Boolean).join(", ");
}

function buildSingleEmbeddingSource(
  sourceType: ProjectEmbeddingBuildSource["sourceType"],
  sourceId: string,
  title: string,
  textParts: string[],
  normalizeWhitespace: boolean,
  passagePrefix: string,
  hashPrefix: string,
  itemFields: Partial<ProjectEmbeddingBuildItem> = {},
): ProjectEmbeddingBuildSource | null {
  const itemText = normalizeEmbeddingText(textParts.filter(Boolean).join("\n\n"), normalizeWhitespace);
  if (!itemText) return null;
  const embeddingText = `${passagePrefix}${itemText}`;
  return {
    sourceType,
    sourceId,
    title,
    sourceHash: hashEmbeddingText(`${hashPrefix}\n${sourceId}\n${itemText}`),
    items: [{
      id: `${sourceType}::${sourceId}`,
      itemType: sourceType,
      title,
      text: embeddingText,
      contentHash: hashEmbeddingText(embeddingText),
      ...itemFields,
    }],
  };
}

export function buildPostgresProjectEmbeddingSources(
  snapshot: PostgresProjectWorkspaceSnapshot,
  llmSettings: LlmSettings = readAppSettings().llm,
): ProjectEmbeddingBuildSource[] {
  const normalizeWhitespace = llmSettings.normalizeWhitespace;
  const passagePrefix = llmSettings.prefixPassages ? "passage: " : "";
  const codeById = new Map(snapshot.codes.map((code) => [code.id, code]));
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const objectById = new Map(snapshot.objects.map((object) => [object.id, object]));
  const annotationById = new Map(snapshot.annotations.map((annotation) => [annotation.id, annotation]));
  const sourceAttributeValuesBySourceId = new Map<string, PostgresProjectWorkspaceSnapshot["sourceAttributeValues"]>();
  const sourceObjectIdsBySourceId = new Map<string, string[]>();
  const sources: ProjectEmbeddingBuildSource[] = [];

  for (const value of snapshot.sourceAttributeValues) {
    sourceAttributeValuesBySourceId.set(value.sourceId, [
      ...(sourceAttributeValuesBySourceId.get(value.sourceId) ?? []),
      value,
    ]);
  }

  for (const link of snapshot.sourceObjectLinks) {
    sourceObjectIdsBySourceId.set(link.sourceId, [
      ...(sourceObjectIdsBySourceId.get(link.sourceId) ?? []),
      link.objectId,
    ]);
  }

  for (const source of snapshot.sources) {
    const builtSource = buildPostgresSourceSource(source, sourceAttributeValuesBySourceId.get(source.id) ?? [], llmSettings);
    if (builtSource) sources.push(builtSource);
  }

  for (const definition of snapshot.sourceAttributeDefinitions) {
    const title = `Source attribute: ${definition.name}`;
    const builtSource = buildSingleEmbeddingSource(
      "source-attribute-definition",
      definition.id,
      title,
      [
        `Source attribute: ${definition.name}`,
        `Data type: ${definition.dataType}`,
        definition.description ? `Description: ${htmlToPlainText(definition.description)}` : "",
        definition.sourceKinds.length > 0 ? `Applies to source types: ${definition.sourceKinds.join(", ")}` : "",
        definition.options.length > 0 ? `Options: ${formatOptions(definition.options)}` : "",
      ],
      normalizeWhitespace,
      passagePrefix,
      "source-attribute-definition",
    );
    if (builtSource) sources.push(builtSource);
  }

  for (const definition of snapshot.objectAttributeDefinitions) {
    const title = `Object attribute: ${definition.name}`;
    const builtSource = buildSingleEmbeddingSource(
      "object-attribute-definition",
      definition.id,
      title,
      [
        `Object attribute: ${definition.name}`,
        definition.objectType ? `Object type: ${definition.objectType}` : "",
        `Data type: ${definition.dataType}`,
        definition.description ? `Description: ${htmlToPlainText(definition.description)}` : "",
        definition.options.length > 0 ? `Options: ${formatOptions(definition.options)}` : "",
      ],
      normalizeWhitespace,
      passagePrefix,
      "object-attribute-definition",
    );
    if (builtSource) sources.push(builtSource);
  }

  for (const definition of snapshot.relationshipAttributeDefinitions) {
    const title = `Relationship attribute: ${definition.name}`;
    const builtSource = buildSingleEmbeddingSource(
      "relationship-attribute-definition",
      definition.id,
      title,
      [
        `Relationship attribute: ${definition.name}`,
        definition.relationshipType ? `Relationship type: ${definition.relationshipType}` : "",
        `Data type: ${definition.dataType}`,
        definition.description ? `Description: ${htmlToPlainText(definition.description)}` : "",
        definition.options.length > 0 ? `Options: ${formatOptions(definition.options)}` : "",
      ],
      normalizeWhitespace,
      passagePrefix,
      "relationship-attribute-definition",
    );
    if (builtSource) sources.push(builtSource);
  }

  for (const objectType of snapshot.objectTypes) {
    const title = `Object type: ${objectType.name}`;
    const builtSource = buildSingleEmbeddingSource(
      "object-type",
      objectType.id,
      title,
      [
        `Object type: ${objectType.name}`,
        objectType.description ? `Description: ${htmlToPlainText(objectType.description)}` : "",
        objectType.shape ? `Shape: ${objectType.shape}` : "",
        objectType.color ? `Color: ${objectType.color}` : "",
        objectType.fill ? `Fill: ${objectType.fill}` : "",
      ],
      normalizeWhitespace,
      passagePrefix,
      "object-type",
    );
    if (builtSource) sources.push(builtSource);
  }

  for (const relationshipType of snapshot.relationshipTypes) {
    const title = `Relationship type: ${relationshipType.name}`;
    const builtSource = buildSingleEmbeddingSource(
      "relationship-type",
      relationshipType.id,
      title,
      [
        `Relationship type: ${relationshipType.name}`,
        relationshipType.description ? `Description: ${htmlToPlainText(relationshipType.description)}` : "",
        relationshipType.fromObjectTypes.length > 0 ? `From object types: ${relationshipType.fromObjectTypes.join(", ")}` : "",
        relationshipType.toObjectTypes.length > 0 ? `To object types: ${relationshipType.toObjectTypes.join(", ")}` : "",
        relationshipType.fromSourceKinds.length > 0 ? `From source types: ${relationshipType.fromSourceKinds.join(", ")}` : "",
        relationshipType.toSourceKinds.length > 0 ? `To source types: ${relationshipType.toSourceKinds.join(", ")}` : "",
        relationshipType.lineShape ? `Line shape: ${relationshipType.lineShape}` : "",
        relationshipType.arrowhead ? `Arrowhead: ${relationshipType.arrowhead}` : "",
        relationshipType.color ? `Color: ${relationshipType.color}` : "",
      ],
      normalizeWhitespace,
      passagePrefix,
      "relationship-type",
    );
    if (builtSource) sources.push(builtSource);
  }

  for (const object of snapshot.objects) {
    const linkedSources = snapshot.sourceObjectLinks
      .filter((link) => link.objectId === object.id)
      .map((link) => sourceById.get(link.sourceId)?.title)
      .filter((title): title is string => Boolean(title));
    const attributeLines = formatPostgresAttributeValues(object.attributeValues);
    const objectText = normalizeEmbeddingText(
      [
        object.objectType ? `Object type: ${object.objectType}` : "",
        object.title ? `Object: ${object.title}` : "",
        object.description ? `Description: ${htmlToPlainText(object.description)}` : "",
        attributeLines.length > 0 ? `Attributes:\n${attributeLines.join("\n")}` : "",
        linkedSources.length > 0 ? `Linked sources: ${linkedSources.join(", ")}` : "",
        object.eventStartAt ? `Event start: ${object.eventStartAt}` : "",
        object.eventEndAt ? `Event end: ${object.eventEndAt}` : "",
      ].filter(Boolean).join("\n\n"),
      normalizeWhitespace,
    );
    if (!objectText) continue;
    const embeddingText = `${passagePrefix}${objectText}`;
    sources.push({
      sourceType: "object",
      sourceId: object.id,
      title: `Object: ${object.title}`,
      sourceHash: hashEmbeddingText(`object\n${object.objectType}\n${object.title}\n${objectText}`),
      items: [{
        id: `object::${object.id}`,
        itemType: "object",
        title: `Object: ${object.title}`,
        text: embeddingText,
        contentHash: hashEmbeddingText(embeddingText),
        objectId: object.id,
      }],
    });
  }

  for (const relationship of snapshot.relationships) {
    const attributeLines = formatPostgresAttributeValues(relationship.attributeValues);
    const fromSource = relationship.fromEntityType === "source" ? sourceById.get(relationship.fromEntityId) : null;
    const toSource = relationship.toEntityType === "source" ? sourceById.get(relationship.toEntityId) : null;
    const fromObject = relationship.fromEntityType === "object" ? objectById.get(relationship.fromEntityId) : null;
    const toObject = relationship.toEntityType === "object" ? objectById.get(relationship.toEntityId) : null;
    const fromName = relationship.fromEntityName || fromSource?.title || fromObject?.title || relationship.fromEntityId;
    const toName = relationship.toEntityName || toSource?.title || toObject?.title || relationship.toEntityId;
    const relationshipTitle = `${relationship.relationshipType || "Relationship"}: ${fromName} -> ${toName}`;
    const relationshipText = normalizeEmbeddingText(
      [
        relationship.relationshipType ? `Relationship type: ${relationship.relationshipType}` : "",
        fromName ? `From ${relationship.fromEntityType}: ${fromName}` : "",
        toName ? `To ${relationship.toEntityType}: ${toName}` : "",
        relationship.description ? `Description: ${htmlToPlainText(relationship.description)}` : "",
        attributeLines.length > 0 ? `Attributes:\n${attributeLines.join("\n")}` : "",
      ].filter(Boolean).join("\n\n"),
      normalizeWhitespace,
    );
    if (!relationshipText) continue;
    const embeddingText = `${passagePrefix}${relationshipText}`;
    sources.push({
      sourceType: "relationship",
      sourceId: relationship.id,
      title: relationshipTitle,
      sourceHash: hashEmbeddingText(
        `relationship\n${relationship.relationshipType}\n${fromName}\n${toName}\n${relationshipText}`,
      ),
      items: [{
        id: `relationship::${relationship.id}`,
        itemType: "relationship",
        title: relationshipTitle,
        text: embeddingText,
        contentHash: hashEmbeddingText(embeddingText),
        relationshipId: relationship.id,
      }],
    });
  }

  for (const code of snapshot.codes) {
    const codeText = normalizeEmbeddingText(
      [code.label, code.description].filter(Boolean).join("\n\n"),
      normalizeWhitespace,
    );
    if (!codeText) continue;
    const embeddingText = `${passagePrefix}${codeText}`;
    sources.push({
      sourceType: "code",
      sourceId: code.id,
      title: `Code: ${code.label}`,
      sourceHash: hashEmbeddingText(`code\n${code.label}\n${codeText}`),
      items: [{
        id: `code::${code.id}`,
        itemType: "code",
        title: `Code: ${code.label}`,
        text: embeddingText,
        contentHash: hashEmbeddingText(embeddingText),
        codeId: code.id,
      }],
    });
  }

  for (const annotation of snapshot.annotations) {
    const source = sourceById.get(annotation.sourceId);
    const codes = annotation.codeIds
      .map((codeId) => codeById.get(codeId))
      .filter((code): code is NonNullable<typeof code> => Boolean(code));
    const objectIds = sourceObjectIdsBySourceId.get(annotation.sourceId) ?? [];
    const annotationText = normalizeEmbeddingText(
      [
        codes.length > 0 ? `Codes: ${codes.map((code) => code.label).join(", ")}` : "",
        source?.title ? `Source: ${source.title}` : "",
        objectIds.length > 0
          ? `Linked objects: ${objectIds.map((objectId) => objectById.get(objectId)?.title).filter(Boolean).join(", ")}`
          : "",
        annotation.quote ? `Quote: ${annotation.quote}` : "",
        annotation.note ? `Note: ${annotation.note}` : "",
      ].filter(Boolean).join("\n"),
      normalizeWhitespace,
    );
    if (!annotationText) continue;
    const embeddingText = `${passagePrefix}${annotationText}`;
    sources.push({
      sourceType: "annotation",
      sourceId: annotation.id,
      title: `Annotation in ${source?.title ?? "source"}`,
      sourceHash: hashEmbeddingText(
        `annotation\n${annotation.id}\n${source?.title ?? ""}\n${codes.map((code) => code.label).join(",")}\n${annotationText}`,
      ),
      items: [{
        id: `annotation::${annotation.id}`,
        itemType: "annotation",
        title: `Annotation in ${source?.title ?? "source"}`,
        text: embeddingText,
        contentHash: hashEmbeddingText(embeddingText),
        sourceId: annotation.sourceId,
        codeId: annotation.primaryCodeId,
        annotationId: annotation.id,
        startOffset: annotation.startOffset ?? undefined,
        endOffset: annotation.endOffset ?? undefined,
      }],
    });
  }

  for (const memo of snapshot.memos) {
    const memoSources = memo.sourceIds.map((sourceId) => sourceById.get(sourceId)).filter(Boolean);
    const memoAnnotations = memo.annotationIds.map((annotationId) => annotationById.get(annotationId)).filter(Boolean);
    const memoCodes = memo.codeIds.map((codeId) => codeById.get(codeId)).filter(Boolean);
    const memoObjects = memo.objectIds.map((objectId) => objectById.get(objectId)).filter(Boolean);
    const memoText = normalizeEmbeddingText(
      [
        memo.title ? `Memo: ${memo.title}` : "",
        memo.body ? `Body: ${htmlToPlainText(memo.body)}` : "",
        memoSources.length > 0 ? `Sources: ${memoSources.map((source) => source?.title).join(", ")}` : "",
        memoCodes.length > 0 ? `Codes: ${memoCodes.map((code) => code?.label).join(", ")}` : "",
        memoObjects.length > 0 ? `Objects: ${memoObjects.map((object) => object?.title).join(", ")}` : "",
        memoAnnotations.length > 0
          ? `Annotations: ${memoAnnotations.map((annotation) => annotation?.quote).filter(Boolean).join(" | ")}`
          : "",
      ].filter(Boolean).join("\n"),
      normalizeWhitespace,
    );
    if (!memoText) continue;
    const embeddingText = `${passagePrefix}${memoText}`;
    sources.push({
      sourceType: "memo",
      sourceId: memo.id,
      title: `Memo: ${memo.title}`,
      sourceHash: hashEmbeddingText(`memo\n${memo.title}\n${memoText}`),
      items: [{
        id: `memo::${memo.id}`,
        itemType: "memo",
        title: `Memo: ${memo.title}`,
        text: embeddingText,
        contentHash: hashEmbeddingText(embeddingText),
        sourceId: memo.sourceIds[0],
        codeId: memo.codeIds[0],
        annotationId: memo.annotationIds[0],
        objectId: memo.objectIds[0],
        memoId: memo.id,
      }],
    });
  }

  return sources;
}

export async function buildPostgresProjectEmbeddingSourcesForProject(
  projectId: string,
  llmSettings: LlmSettings = readAppSettings().llm,
): Promise<ProjectEmbeddingBuildSource[]> {
  const snapshot = await loadPostgresProjectWorkspaceSnapshot(projectId);
  return buildPostgresProjectEmbeddingSources(snapshot, llmSettings);
}
