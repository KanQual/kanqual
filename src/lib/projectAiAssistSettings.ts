export type ProjectAiAssistSettings = {
  enabled: boolean;
  allowSemanticSearch: boolean;
  allowQuestionAnswering: boolean;
  allowSummaries: boolean;
  allowCodeSuggestions: boolean;
  allowDraftReports: boolean;
};

export const DEFAULT_PROJECT_AI_ASSIST_SETTINGS: ProjectAiAssistSettings = {
  enabled: false,
  allowSemanticSearch: true,
  allowQuestionAnswering: true,
  allowSummaries: true,
  allowCodeSuggestions: false,
  allowDraftReports: false,
};

export const PROJECT_AI_ASSIST_SETTINGS_CHANGED_EVENT = "kanqual:project-ai-assist-settings-changed";

function projectAiAssistKey(projectId: string): string {
  return `kq_project_ai_assist_${projectId}`;
}

export function readProjectAiAssistSettings(projectId: string): ProjectAiAssistSettings {
  try {
    const raw = localStorage.getItem(projectAiAssistKey(projectId));
    if (!raw) return DEFAULT_PROJECT_AI_ASSIST_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ProjectAiAssistSettings>;
    return {
      ...DEFAULT_PROJECT_AI_ASSIST_SETTINGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_PROJECT_AI_ASSIST_SETTINGS;
  }
}

export function saveProjectAiAssistSettings(projectId: string, settings: ProjectAiAssistSettings): void {
  localStorage.setItem(projectAiAssistKey(projectId), JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent(PROJECT_AI_ASSIST_SETTINGS_CHANGED_EVENT, {
    detail: { projectId, settings },
  }));
}
