import { PostgresMemosView } from "./Postgres_Memos_View";

export type PostgresMemoDraftTarget = {
  sourceIds?: string[];
  annotationIds?: string[];
  codeIds?: string[];
};

export function PostgresProjectMemosView({
  projectId,
  projectStoragePath,
  canManageMemos,
  draftTarget,
  onDraftHandled,
}: {
  projectId: string;
  projectStoragePath?: string;
  canManageMemos: boolean;
  draftTarget: PostgresMemoDraftTarget | null;
  onDraftHandled: () => void;
}) {
  return (
    <PostgresMemosView
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
