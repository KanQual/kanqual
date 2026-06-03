import { readAppSettings, type LlmSettings } from "./appSettings";
import { htmlToPlainText } from "./htmlText";
import type { Annotation, Case, Code, Document, Memo } from "../types";

export type ProjectEmbeddingBuildItem = {
  id: string;
  itemType: string;
  sourceId: string;
  title: string;
  text: string;
  contentHash: string;
  documentId?: string;
  caseId?: string;
  codeId?: string;
  annotationId?: string;
  memoId?: string;
  startOffset?: number;
  endOffset?: number;
};

export type ProjectEmbeddingBuildSource = {
  sourceType: "document" | "case" | "code" | "annotation" | "memo";
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
};

export type ProjectEmbeddingBuildStatus = {
  phase: "idle" | "running" | "cancelling" | "cancelled" | "completed" | "error";
  projectId: string | null;
  totalItems: number;
  completedItems: number;
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

function buildDocumentSource(document: Document, llmSettings: LlmSettings): ProjectEmbeddingBuildSource | null {
  const chunks = chunkDocumentText(document.content || "", llmSettings.chunkSize, llmSettings.overlapSize);
  const normalizeWhitespace = llmSettings.normalizeWhitespace;
  const passagePrefix = llmSettings.prefixPassages ? "passage: " : "";
  const items: ProjectEmbeddingBuildItem[] = [];

  chunks.forEach((chunk, index) => {
    const normalizedChunk = normalizeEmbeddingText(chunk.text, normalizeWhitespace);
    if (!normalizedChunk) return;
    const embeddingText = `${passagePrefix}${normalizedChunk}`;
    items.push({
      id: `${document.id}::chunk-${index + 1}`,
      itemType: "document",
      sourceId: document.id,
      title: `${document.name} (chunk ${index + 1})`,
      text: embeddingText,
      contentHash: hashEmbeddingText(embeddingText),
      documentId: document.id,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
    });
  });

  if (items.length === 0) return null;

  return {
    sourceType: "document",
    sourceId: document.id,
    title: document.name,
    sourceHash: hashEmbeddingText(
      `document\n${document.name}\n${normalizeEmbeddingText(document.content || "", normalizeWhitespace)}`,
    ),
    items,
  };
}

export function buildProjectEmbeddingSources(
  documents: Document[],
  cases: Case[],
  codes: Code[],
  annotations: Annotation[],
  memos: Memo[],
  llmSettings: LlmSettings = readAppSettings().llm,
): ProjectEmbeddingBuildSource[] {
  const normalizeWhitespace = llmSettings.normalizeWhitespace;
  const passagePrefix = llmSettings.prefixPassages ? "passage: " : "";
  const codeById = new Map(codes.map((code) => [code.id, code]));
  const annotationById = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const sources: ProjectEmbeddingBuildSource[] = [];

  for (const document of documents) {
    const source = buildDocumentSource(document, llmSettings);
    if (source) sources.push(source);
  }

  for (const caseItem of cases) {
    const caseText = normalizeEmbeddingText(
      [
        caseItem.name ? `Case: ${caseItem.name}` : "",
        caseItem.notes ? `Description: ${htmlToPlainText(caseItem.notes)}` : "",
      ].filter(Boolean).join("\n\n"),
      normalizeWhitespace,
    );
    if (!caseText) continue;
    const embeddingText = `${passagePrefix}${caseText}`;
    sources.push({
      sourceType: "case",
      sourceId: caseItem.id,
      title: `Case: ${caseItem.name}`,
      sourceHash: hashEmbeddingText(`case\n${caseItem.name}\n${caseText}`),
      items: [{
        id: `case::${caseItem.id}`,
        itemType: "case",
        sourceId: caseItem.id,
        title: `Case: ${caseItem.name}`,
        text: embeddingText,
        contentHash: hashEmbeddingText(embeddingText),
        caseId: caseItem.id,
      }],
    });
  }

  for (const code of codes) {
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
        sourceId: code.id,
        title: `Code: ${code.label}`,
        text: embeddingText,
        contentHash: hashEmbeddingText(embeddingText),
        codeId: code.id,
      }],
    });
  }

  for (const annotation of annotations) {
    const code = codeById.get(annotation.codeId);
    const document = documentById.get(annotation.documentId);
    const annotationText = normalizeEmbeddingText(
      [
        code?.label ? `Code: ${code.label}` : "",
        document?.name ? `Document: ${document.name}` : "",
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
      title: `Annotation in ${document?.name ?? "document"}`,
      sourceHash: hashEmbeddingText(
        `annotation\n${annotation.id}\n${document?.name ?? ""}\n${code?.label ?? ""}\n${annotationText}`,
      ),
      items: [{
        id: `annotation::${annotation.id}`,
        itemType: "annotation",
        sourceId: annotation.id,
        title: `Annotation in ${document?.name ?? "document"}`,
        text: embeddingText,
        contentHash: hashEmbeddingText(embeddingText),
        documentId: annotation.documentId,
        codeId: annotation.codeId,
        annotationId: annotation.id,
        startOffset: annotation.startOffset,
        endOffset: annotation.endOffset,
      }],
    });
  }

  for (const memo of memos) {
    const annotation = memo.annotationId ? annotationById.get(memo.annotationId) : undefined;
    const document = memo.documentId
      ? documentById.get(memo.documentId)
      : annotation?.documentId
        ? documentById.get(annotation.documentId)
        : undefined;
    const code = annotation?.codeId ? codeById.get(annotation.codeId) : undefined;
    const memoText = normalizeEmbeddingText(
      [
        memo.title ? `Memo: ${memo.title}` : "",
        memo.body ? `Body: ${htmlToPlainText(memo.body)}` : "",
        document?.name ? `Document: ${document.name}` : "",
        code?.label ? `Code: ${code.label}` : "",
        annotation?.quote ? `Quote: ${annotation.quote}` : "",
        annotation?.note ? `Annotation note: ${annotation.note}` : "",
      ].filter(Boolean).join("\n"),
      normalizeWhitespace,
    );
    if (!memoText) continue;
    const embeddingText = `${passagePrefix}${memoText}`;
    sources.push({
      sourceType: "memo",
      sourceId: memo.id,
      title: `Memo: ${memo.title}`,
      sourceHash: hashEmbeddingText(
        `memo\n${memo.title}\n${document?.name ?? ""}\n${code?.label ?? ""}\n${memoText}`,
      ),
      items: [{
        id: `memo::${memo.id}`,
        itemType: "memo",
        sourceId: memo.id,
        title: `Memo: ${memo.title}`,
        text: embeddingText,
        contentHash: hashEmbeddingText(embeddingText),
        documentId: document?.id,
        codeId: code?.id,
        annotationId: annotation?.id,
        memoId: memo.id,
      }],
    });
  }

  return sources;
}

export function buildProjectEmbeddingItems(
  documents: Document[],
  cases: Case[],
  codes: Code[],
  annotations: Annotation[],
  memos: Memo[],
  llmSettings: LlmSettings = readAppSettings().llm,
): ProjectEmbeddingBuildItem[] {
  return buildProjectEmbeddingSources(documents, cases, codes, annotations, memos, llmSettings)
    .flatMap((source) => source.items);
}
