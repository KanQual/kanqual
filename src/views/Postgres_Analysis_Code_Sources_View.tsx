import { PostgresSourcesView, type PostgresSourcesViewProps } from "./Postgres_Sources_View";

type PostgresAnalysisCodeSourcesViewProps = Omit<PostgresSourcesViewProps, "codingEnabled">;

export function PostgresAnalysisCodeSourcesView(props: PostgresAnalysisCodeSourcesViewProps) {
  return <PostgresSourcesView {...props} codingEnabled />;
}
