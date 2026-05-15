import PocketBase from "pocketbase";
import { invoke } from "@tauri-apps/api/core";

let _setupPromise: Promise<void> | null = null;

const APP_METADATA_COLLECTION = "app_metadata";
const BACKEND_IDENTIFIER_KEY = "backend_identifier";
const USERS_TABLE_IDENTIFIER_KEY = "users_table_identifier";

export function createPbClient(url: string): PocketBase {
  const pb = new PocketBase(url);
  pb.autoCancellation(false);
  return pb;
}

export async function waitForPb(url: string, maxWaitMs = 30000): Promise<PocketBase> {
  const pb = createPbClient(url);
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      await pb.health.check();
      return pb;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(
    `Could not reach ${url}. The host may be offline, not sharing on the network, or the address may be wrong.`,
  );
}

export async function startLocalPocketBase(): Promise<string> {
  return invoke<string>("start_local_pocketbase_command");
}

export async function stopLocalPocketBase(): Promise<void> {
  await invoke("stop_local_pocketbase_command");
}

export async function createUserAccount(data: {
  pb: PocketBase;
  name: string;
  email: string;
  password: string;
  passwordConfirm: string;
  userIdentifier?: string;
  mustChangePassword?: boolean;
  appRole?: "administrator" | "standard";
}): Promise<string> {
  return invoke<string>("create_user_account_command", {
    request: {
      authToken: data.pb.authStore.token,
      request: {
        name: data.name,
        email: data.email,
        password: data.password,
        passwordConfirm: data.passwordConfirm,
        userIdentifier: data.userIdentifier,
        mustChangePassword: data.mustChangePassword,
        appRole: data.appRole,
      },
    },
  });
}

export async function registerUserAccount(data: {
  name: string;
  email: string;
  password: string;
  passwordConfirm: string;
}): Promise<{ id: string; appRole: "administrator" | "standard" }> {
  return invoke<{ id: string; appRole: "administrator" | "standard" }>("register_user_account_command", {
    request: data,
  });
}

export async function getRegisteredUserCount(): Promise<number> {
  return invoke<number>("get_registered_user_count_command");
}

export async function deleteUserAccount(pb: PocketBase, userId: string): Promise<void> {
  await invoke("delete_user_account_command", { authToken: pb.authStore.token, userId });
}

export async function clearAppDataRecords(pb: PocketBase): Promise<void> {
  await invoke("clear_app_data_records_command", { authToken: pb.authStore.token });
}

export async function updateUserAccount(
  pb: PocketBase,
  userId: string,
  data: { name?: string; email?: string },
): Promise<void> {
  await invoke("update_user_account_command", {
    request: {
      authToken: pb.authStore.token,
      request: { userId, ...data },
    },
  });
}

export type ImportedUserAccountResult = {
  id: string;
  created: boolean;
  temporaryPassword?: string;
};

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

async function getMetadataRecord(pb: PocketBase, key: string) {
  return pb.collection(APP_METADATA_COLLECTION).getFirstListItem(`key="${escapeFilterValue(key)}"`).catch(() => null);
}

export async function getBackendIdentitySnapshot(pb: PocketBase): Promise<{
  backendIdentifier: string;
  usersTableIdentifier: string;
}> {
  const [backendRecord, usersTableRecord] = await Promise.all([
    getMetadataRecord(pb, BACKEND_IDENTIFIER_KEY),
    getMetadataRecord(pb, USERS_TABLE_IDENTIFIER_KEY),
  ]);
  return {
    backendIdentifier: String(backendRecord?.value ?? ""),
    usersTableIdentifier: String(usersTableRecord?.value ?? ""),
  };
}

export async function ensureImportedUserAccount(data: {
  pb: PocketBase;
  name: string;
  email: string;
  password?: string;
}): Promise<ImportedUserAccountResult> {
  return invoke<ImportedUserAccountResult>("ensure_imported_user_account_command", {
    request: {
      authToken: data.pb.authStore.token,
      request: {
        name: data.name,
        email: data.email,
        password: data.password,
      },
    },
  });
}

export async function ensureSetup(_pb: PocketBase): Promise<void> {
  if (_setupPromise) return _setupPromise;

  _setupPromise = (async () => {
    const maxAttempts = 8;
    let lastError: unknown;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        await invoke("ensure_backend_setup_command");
        return;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    console.error("Native database setup failed after retries:", lastError);
    throw new Error("Database initialisation failed. Please restart the app.");
  })();

  try {
    await _setupPromise;
  } catch (e) {
    _setupPromise = null;
    throw e;
  }
}
