import { SourcesView, type SourcesViewProps } from "./Sources_View";

type ProjectSourcesViewProps = Omit<SourcesViewProps, "codingEnabled">;

export function ProjectSourcesView(props: ProjectSourcesViewProps) {
  return <SourcesView {...props} codingEnabled={false} />;
}
