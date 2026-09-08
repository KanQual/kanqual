import type { SourceCodingViewProps } from "./Source_Coding_Shared";
import { SourceMediaCodingView } from "./Source_Media_Coding_View";

export function SourceAudioCodingView(
  props: SourceCodingViewProps & { projectStoragePath: string },
) {
  return <SourceMediaCodingView {...props} mediaKind="audio" />;
}
