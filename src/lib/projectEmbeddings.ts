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

export type ProjectEmbeddingIndexStatus = {
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

function chunkDocumentText(text: string, chunkSize: number, overlapSize: number): Array<{ text: string; startOffset: number; endOffset: number }> {
  if (!text) return [];
  const chunks: Array<{ text: string; startOffset: number; endOffset: number }> = [];
  const step = Math.max(1, chunkSize - overlapSize);
  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(text.length, start + chunkSize);
    const chunk = text.slice(start, end);
    const trimmed = chunk.trim();
    if (trimmed) {
      const leadingWhitespace = chunk.length - chunk.trimStart().length;
      const trailingWhitespace = chunk.length - chunk.trimEnd().length;
      chunks.push({
        text: trimmed,
        startOffset: start + leadingWhitespace,
        endOffset: end - trailingWhitespace,
      });
    }
    if (start + chunkSize >= text.length) break;
  }
  return chunks;
}

export function buildProjectEmbeddingItems(
  documents: Document[],
  cases: Case[],
  codes: Code[],
  annotations: Annotation[],
  memos: Memo[],
  llmSettings: LlmSettings = readAppSettings().llm,
): ProjectEmbeddingBuildItem[] {
  const normalizeWhitespace = llmSettings.normalizeWhitespace;
  const passagePrefix = llmSettings.prefixPassages ? "passage: " : "";
  const codeById = new Map(codes.map((code) => [code.id, code]));
  const annotationById = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const items: ProjectEmbeddingBuildItem[] = [];

  for (const document of documents) {
    const chunks = chunkDocumentText(document.content || "", llmSettings.chunkSize, llmSettings.overlapSize);
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
    items.push({
      id: `case::${caseItem.id}`,
      itemType: "case",
      sourceId: caseItem.id,
      title: `Case: ${caseItem.name}`,
      text: embeddingText,
      contentHash: hashEmbeddingText(embeddingText),
      caseId: caseItem.id,
    });
  }

  for (const code of codes) {
    const codeText = normalizeEmbeddingText(
      [code.label, code.description].filter(Boolean).join("\n\n"),
      normalizeWhitespace,
    );
    if (!codeText) continue;
    const embeddingText = `${passagePrefix}${codeText}`;
    items.push({
      id: `code::${code.id}`,
      itemType: "code",
      sourceId: code.id,
      title: `Code: ${code.label}`,
      text: embeddingText,
      contentHash: hashEmbeddingText(embeddingText),
      codeId: code.id,
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
    items.push({
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
    items.push({
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
    });
  }

  return items;
}
