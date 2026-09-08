import { MemosView } from "./Memos_View";

export type MemoDraftTarget = {
  sourceIds?: string[];
  annotationIds?: string[];
  codeIds?: string[];
};

export function ProjectMemosView({
  projectId,
  projectStoragePath,
  canManageMemos,
  draftTarget,
  onDraftHandled,
}: {
  projectId: string;
  projectStoragePath?: string;
  canManageMemos: boolean;
  draftTarget: MemoDraftTarget | null;
  onDraftHandled: () => void;
}) {
  return (
    <MemosView
      projectId={projectId}
      projectStoragePath={projectStoragePath}
      canManageMemos={canManageMemos}
      initialSourceIds={draftTarget?.sourceIds ?? null}
      initialAnnotationIds={draftTarget?.annotationIds ?? null}
      initialCodeIds={draftTarget?.codeIds ?? null}
      onInitialDraftHandled={onDraftHandled}
    />
  );
}
