import { PostgresSourcesView, type PostgresSourcesViewProps } from "./Postgres_Sources_View";

type PostgresAiAssistAssistedCodingViewProps = Omit<
  PostgresSourcesViewProps,
  "allowedSourceKinds" | "codingEnabled" | "pageTitleOverride" | "textCodingMode"
>;

export function PostgresAiAssistAssistedCodingView(props: PostgresAiAssistAssistedCodingViewProps) {
  return (
    <PostgresSourcesView
      {...props}
          codingEnabled
          textCodingMode="ai-assisted"
          pageTitleOverride="Assisted Coding"
          allowedSourceKinds={["text", "Transcript"]}
        />
      );
}
