import type { PostgresUserPreferences } from "./postgres";

export type GettingStartedState = PostgresUserPreferences["gettingStartedState"];

export const DEFAULT_GETTING_STARTED_STATE: GettingStartedState = {
  dismissed: false,
  completed: false,
  step: "",
  projectId: "",
  userId: "",
  sourceId: "",
  codeId: "",
  adminUserId: "",
  currentActor: "",
  temporaryUsername: "",
};

export function normalizeGettingStartedState(value: Partial<GettingStartedState> | null | undefined): GettingStartedState {
  return {
    ...DEFAULT_GETTING_STARTED_STATE,
    ...(value ?? {}),
    dismissed: !!value?.dismissed,
    completed: !!value?.completed,
    step: String(value?.step ?? ""),
    projectId: String(value?.projectId ?? ""),
    userId: String(value?.userId ?? ""),
    sourceId: String(value?.sourceId ?? ""),
    codeId: String(value?.codeId ?? ""),
    adminUserId: String(value?.adminUserId ?? ""),
    currentActor: String(value?.currentActor ?? ""),
    temporaryUsername: String(value?.temporaryUsername ?? ""),
  };
}

const GETTING_STARTED_HANDOFF_KEY = "kanqual.gettingStarted.handoff";

export type GettingStartedHandoffState = Pick<
  GettingStartedState,
  "projectId" | "userId" | "sourceId" | "codeId" | "adminUserId" | "currentActor" | "temporaryUsername"
> & {
  step:
    | "loginAsUser"
    | "changePassword"
    | "chooseLocalWorkspace"
    | "chooseProject"
    | "projectHomeDetailsIntro"
    | "projectHomeModesIntro"
    | "projectHomeSidebarCollapsedIntro"
    | "projectHomeSidebarExpandedIntro"
    | "projectHomeIntro"
    | "addTextSource";
  dismissed?: boolean;
};

export function readGettingStartedHandoff(): GettingStartedHandoffState | null {
  try {
    const raw = window.localStorage.getItem(GETTING_STARTED_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GettingStartedHandoffState>;
    if (!parsed || typeof parsed !== "object" || parsed.dismissed) return null;
    return {
      projectId: String(parsed.projectId ?? ""),
      userId: String(parsed.userId ?? ""),
      sourceId: String(parsed.sourceId ?? ""),
      codeId: String(parsed.codeId ?? ""),
      adminUserId: String(parsed.adminUserId ?? ""),
      currentActor: String(parsed.currentActor ?? ""),
      temporaryUsername: String(parsed.temporaryUsername ?? ""),
      step: parsed.step ?? "loginAsUser",
    };
  } catch {
    return null;
  }
}

export function writeGettingStartedHandoff(state: GettingStartedHandoffState): void {
  try {
    window.localStorage.setItem(GETTING_STARTED_HANDOFF_KEY, JSON.stringify(state));
  } catch {
    // Ignore local handoff failures; durable guide state still lives in preferences.
  }
}

export function updateGettingStartedHandoff(patch: Partial<GettingStartedHandoffState>): GettingStartedHandoffState | null {
  const current = readGettingStartedHandoff();
  if (!current) return null;
  const next = { ...current, ...patch } as GettingStartedHandoffState;
  writeGettingStartedHandoff(next);
  return next;
}

export function clearGettingStartedHandoff(): void {
  try {
    window.localStorage.removeItem(GETTING_STARTED_HANDOFF_KEY);
  } catch {
    // Best effort only.
  }
}
