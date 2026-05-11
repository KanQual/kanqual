import { invoke } from "@tauri-apps/api/core";

export type AppRuntimeInfo = {
  appDataDir: string;
  appVersion: string;
  portableMode: boolean;
};

let appRuntimeInfoPromise: Promise<AppRuntimeInfo> | null = null;

export async function getAppRuntimeInfo(): Promise<AppRuntimeInfo> {
  if (appRuntimeInfoPromise) return appRuntimeInfoPromise;
  appRuntimeInfoPromise = invoke<AppRuntimeInfo>("get_app_info");
  try {
    return await appRuntimeInfoPromise;
  } catch (error) {
    appRuntimeInfoPromise = null;
    throw error;
  }
}

export async function getKanqualDataRoot(): Promise<string> {
  const info = await getAppRuntimeInfo();
  return info.appDataDir;
}

export function joinFsPath(base: string, ...segments: string[]): string {
  let resolved = base.replace(/[\\/]+$/g, "");
  for (const segment of segments) {
    resolved += `/${segment.replace(/^[/\\]+/g, "")}`;
  }
  return resolved;
}
