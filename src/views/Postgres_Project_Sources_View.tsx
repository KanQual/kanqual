import { PostgresSourcesView, type PostgresSourcesViewProps } from "./Postgres_Sources_View";

type PostgresProjectSourcesViewProps = Omit<PostgresSourcesViewProps, "codingEnabled">;

export function PostgresProjectSourcesView(props: PostgresProjectSourcesViewProps) {
  return <PostgresSourcesView {...props} codingEnabled={false} />;
}
