import type { PostgresSourceCodingViewProps } from "./Postgres_Source_Coding_Shared";
import { PostgresSourceMediaCodingView } from "./Postgres_Source_Media_Coding_View";

export function PostgresSourceAudioCodingView(
  props: PostgresSourceCodingViewProps & { projectStoragePath: string },
) {
  return <PostgresSourceMediaCodingView {...props} mediaKind="audio" />;
}
