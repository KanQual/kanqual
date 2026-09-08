import { SourcesView, type SourcesViewProps } from "./Sources_View";

type AIAssistAssistedCodingViewProps = Omit<
  SourcesViewProps,
  "allowedSourceKinds" | "codingEnabled" | "pageTitleOverride" | "textCodingMode"
>;

export function AIAssistAssistedCodingView(props: AIAssistAssistedCodingViewProps) {
  return (
    <SourcesView
      {...props}
          codingEnabled
          textCodingMode="ai-assisted"
          pageTitleOverride="Assisted Coding"
          allowedSourceKinds={["text", "Transcript"]}
        />
      );
}
