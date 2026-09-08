import { SourcesView, type SourcesViewProps } from "./Sources_View";

type AnalysisCodeSourcesViewProps = Omit<SourcesViewProps, "codingEnabled">;

export function AnalysisCodeSourcesView(props: AnalysisCodeSourcesViewProps) {
  return <SourcesView {...props} codingEnabled />;
}
