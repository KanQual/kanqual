import { invoke } from "@tauri-apps/api/core";

export type SmokeTestConfig = {
  enabled: boolean;
  runId: string | null;
  statePath: string | null;
  userName: string | null;
  userEmail: string | null;
  userPassword: string | null;
  projectName: string | null;
  appDataDir: string;
  portableMode: boolean;
};

export type SmokeTestStateUpdate = {
  phase: string;
  message?: string | null;
  success?: boolean;
  failure?: string | null;
  projectId?: string | null;
  userEmail?: string | null;
  appDataDir?: string | null;
  portableMode?: boolean;
};

let smokeTestConfigPromise: Promise<SmokeTestConfig> | null = null;

export async function getSmokeTestConfig(): Promise<SmokeTestConfig> {
  if (smokeTestConfigPromise) return smokeTestConfigPromise;
  smokeTestConfigPromise = invoke<SmokeTestConfig>("get_smoke_test_config_command");
  try {
    return await smokeTestConfigPromise;
  } catch (error) {
    smokeTestConfigPromise = null;
    throw error;
  }
}

export async function updateSmokeTestState(update: SmokeTestStateUpdate): Promise<void> {
  await invoke("update_smoke_test_state_command", { request: update });
}
