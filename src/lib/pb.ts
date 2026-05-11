import PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { invoke } from "@tauri-apps/api/core";
import { normalizeAppRole, normalizeProjectRole } from "./permissions";
import type { Role } from "../types";

// ─── Singleton client ────────────────────────────────────────────────────────

let _pb: PocketBase | null = null;
let _setupPromise: Promise<void> | null = null;
let _internalBackendAuthPromise: Promise<InternalBackendAuth> | null = null;

type InternalBackendAuth = {
  superuserEmail: string;
  superuserPassword: string;
};

export async function getPb(): Promise<PocketBase> {
  if (_pb) return _pb;
  const url = await invoke<string>("get_pb_url");
  _pb = new PocketBase(url);
  _pb.autoCancellation(false);
  return _pb;
}

export async function waitForPb(maxWaitMs = 30000): Promise<PocketBase> {
  const pb = await getPb();
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      await pb.health.check();
      return pb;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error("Could not connect to the local database. Please restart the app.");
}

// ─── Internal superuser credentials (mirrors src-tauri/src/lib.rs) ──────────

const APP_METADATA_COLLECTION = "app_metadata";
const BACKEND_IDENTIFIER_KEY = "backend_identifier";
const USERS_TABLE_IDENTIFIER_KEY = "users_table_identifier";
const LARGE_REPORT_SNAPSHOT_MAX = 2_000_000;

async function getInternalBackendAuth(): Promise<InternalBackendAuth> {
  if (_internalBackendAuthPromise) return _internalBackendAuthPromise;
  _internalBackendAuthPromise = invoke<InternalBackendAuth>("get_internal_backend_auth");
  try {
    return await _internalBackendAuthPromise;
  } catch (error) {
    _internalBackendAuthPromise = null;
    throw error;
  }
}

// ─── Superuser helper ────────────────────────────────────────────────────────

/**
 * Run `fn` with a short-lived superuser-authed PocketBase instance.
 * The main `_pb` singleton's auth state (including localStorage) is fully
 * preserved — the admin instance uses its own separate auth slot.
 */
async function withSuperuser<T>(fn: (admin: PocketBase) => Promise<T>): Promise<T> {
  const pb = await getPb();
  const auth = await getInternalBackendAuth();
  // Snapshot the current user session so we can restore it after the
  // admin instance's authStore.clear() removes the shared localStorage key.
  const savedToken = pb.authStore.token;
  const savedRecord = pb.authStore.record;

  const admin = new PocketBase(pb.baseURL);
  admin.autoCancellation(false);
  await admin.collection("_superusers").authWithPassword(
    auth.superuserEmail,
    auth.superuserPassword,
  );
  try {
    return await fn(admin);
  } finally {
    // Discard the superuser token from the admin instance (removes localStorage key).
    admin.authStore.clear();
    // Restore the main user's session to localStorage so it survives the clear.
    if (savedToken) {
      pb.authStore.save(savedToken, savedRecord);
    }
  }
}

/** Create a new user account (requires superuser). Returns the new user's ID. */
export async function createUserAccount(data: {
  name: string;
  email: string;
  password: string;
  passwordConfirm: string;
  userIdentifier?: string;
  mustChangePassword?: boolean;
  appRole?: "administrator" | "standard";
}): Promise<string> {
  return invoke<string>("create_user_account_command", { request: data });
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

/** Delete a user account (requires superuser). */
export async function deleteUserAccount(userId: string): Promise<void> {
  await invoke("delete_user_account_command", { userId });
}

export async function clearAppDataRecords(): Promise<void> {
  await invoke("clear_app_data_records_command");
}

/** Update a user's name and/or email (requires superuser). */
export async function updateUserAccount(
  userId: string,
  data: { name?: string; email?: string },
): Promise<void> {
  await invoke("update_user_account_command", { request: { userId, ...data } });
}

export type ImportedUserAccountResult = {
  id: string;
  created: boolean;
  temporaryPassword?: string;
};

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function generateIdentifier(): string {
  return crypto.randomUUID();
}

async function getMetadataRecord(pb: PocketBase, key: string) {
  return pb.collection(APP_METADATA_COLLECTION).getFirstListItem(`key="${escapeFilterValue(key)}"`).catch(() => null);
}

async function ensureMetadataValue(pb: PocketBase, key: string): Promise<string> {
  const existing = await getMetadataRecord(pb, key);
  if (existing?.value) return String(existing.value);
  const value = generateIdentifier();
  if (existing) {
    await pb.collection(APP_METADATA_COLLECTION).update(existing.id, { value });
  } else {
    await pb.collection(APP_METADATA_COLLECTION).create({ key, value });
  }
  return value;
}

async function backfillUserIdentifiers(pb: PocketBase): Promise<void> {
  const users = await pb.collection("users").getFullList({ sort: "created" });
  await Promise.all(
    users
      .filter((user) => !user.user_identifier)
      .map((user) => pb.collection("users").update(user.id, { user_identifier: generateIdentifier() }))
  );
}

async function backfillUserAppRoles(pb: PocketBase): Promise<void> {
  const users = await pb.collection("users").getFullList({ sort: "created" });
  if (users.length === 0) return;

  const hasAdministrator = users.some((user) => normalizeAppRole(user.app_role) === "administrator");
  const firstUserId = users[0]?.id;

  await Promise.all(
    users.flatMap((user) => {
      const currentRole = String(user.app_role ?? "").trim();
      const normalizedRole = normalizeAppRole(currentRole);
      if (currentRole && normalizedRole === currentRole) {
        return [];
      }
      return [
        pb.collection("users").update(user.id, {
          app_role: !hasAdministrator && user.id === firstUserId ? "administrator" : normalizedRole,
        }),
      ];
    }),
  );
}

async function backfillProjectMemberRoles(pb: PocketBase): Promise<void> {
  const memberships = await pb.collection("project_members").getFullList({ sort: "created" });
  if (memberships.length === 0) return;

  const normalizedById = new Map<string, Role>();
  const updates: Promise<unknown>[] = [];

  for (const membership of memberships) {
    const normalizedRole = normalizeProjectRole(membership.role) ?? "viewer";
    normalizedById.set(membership.id, normalizedRole);
    if (membership.role !== normalizedRole) {
      updates.push(pb.collection("project_members").update(membership.id, { role: normalizedRole }));
    }
  }

  const membershipsByProject = new Map<string, Array<{ id: string; role: Role }>>();
  for (const membership of memberships) {
    const projectMemberships = membershipsByProject.get(String(membership.project)) ?? [];
    projectMemberships.push({
      id: membership.id,
      role: normalizedById.get(membership.id) ?? "viewer",
    });
    membershipsByProject.set(String(membership.project), projectMemberships);
  }

  for (const projectMemberships of membershipsByProject.values()) {
    if (projectMemberships.length === 0) continue;
    const hasOwner = projectMemberships.some((membership) => membership.role === "owner");
    if (!hasOwner) {
      const fallbackOwner = projectMemberships[0];
      updates.push(pb.collection("project_members").update(fallbackOwner.id, { role: "owner" }));
    }
  }

  if (updates.length > 0) {
    await Promise.all(updates);
  }
}

async function backfillDocumentTypes(pb: PocketBase): Promise<void> {
  const documents = await pb.collection("documents").getFullList({
    sort: "created",
    filter: 'deleted_at=""',
  }).catch(() => [] as RecordModel[]);

  await Promise.all(
    documents
      .filter((document) => !String(document.type ?? "").trim())
      .map((document) =>
        pb.collection("documents").update(document.id, { type: "Text" }),
      ),
  );
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
  name: string;
  email: string;
  password?: string;
}): Promise<ImportedUserAccountResult> {
  return invoke<ImportedUserAccountResult>("ensure_imported_user_account_command", { request: data });
}

// ─── Access rules ────────────────────────────────────────────────────────────
// All collections allow any authenticated user to read/write at the PocketBase
// layer. Role enforcement (owner / editor / coder / viewer) is handled in the
// application layer so we can evolve the rules without re-migrating the DB.

const AUTH_RULE = "@request.auth.id != ''";

const OPEN_RULES = {
  listRule:   AUTH_RULE,
  viewRule:   AUTH_RULE,
  createRule: AUTH_RULE,
  updateRule: AUTH_RULE,
  deleteRule: AUTH_RULE,
};

// ─── First-run setup ─────────────────────────────────────────────────────────

export async function ensureSetup(_pb: PocketBase): Promise<void> {
  if (_setupPromise) return _setupPromise;

  _setupPromise = (async () => {
    const maxAttempts = 8;
    let lastError: unknown;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        await withSuperuser(async (admin) => {
          await ensureCollections(admin);
        });
        return;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    console.error("Superuser setup failed after retries:", lastError);
    throw new Error("Database initialisation failed. Please restart the app.");
  })();

  try {
    await _setupPromise;
  } catch (e) {
    _setupPromise = null;
    throw e;
  }
}

// ─── Collection helpers ───────────────────────────────────────────────────────

// Get a collection record (requires superuser auth — called only inside ensureSetup).
async function getCollection(pb: PocketBase, name: string) {
  return pb.collections.getOne(name).catch(() => null);
}

// PocketBase 0.25 does not auto-add created/updated to API-created collections,
// so we include them explicitly. Without these, sort=-created returns 400.
const AUTO_DATE_FIELDS = [
  { name: "created", type: "autodate", system: true, hidden: false, presentable: false, onCreate: true, onUpdate: false },
  { name: "updated", type: "autodate", system: true, hidden: false, presentable: false, onCreate: true, onUpdate: true },
];

// Ensure a collection exists with the correct access rules and autodate fields.
// If it already exists, only missing pieces are patched — no data is touched.
// If it doesn't exist, it is created from scratch.
async function upsertCollection(
  pb: PocketBase,
  name: string,
  definition: Record<string, unknown>,
  options?: { exactFields?: boolean }
): Promise<void> {
  const existing = await getCollection(pb, name);
  const exactFields = options?.exactFields ?? false;
  if (existing) {
    const needsRuleUpdate =
      existing.listRule !== OPEN_RULES.listRule ||
      existing.viewRule !== OPEN_RULES.viewRule ||
      existing.createRule !== OPEN_RULES.createRule ||
      existing.updateRule !== OPEN_RULES.updateRule ||
      existing.deleteRule !== OPEN_RULES.deleteRule;
    const existingFields  = (existing.fields as Array<Record<string, unknown>>) ?? [];
    const defFields       = (definition.fields as Array<{ name: string } & Record<string, unknown>>) ?? [];

    // Fields present in the definition but missing from the collection
    const missingCustom = defFields.filter(
      (f) => !existingFields.some((e) => e["name"] === f.name)
    );

    // Existing fields whose explicit definition properties differ (e.g. max changed to 0)
    const mergedExisting = existingFields.map((ef) => {
      const df = defFields.find((f) => f.name === ef["name"]);
      if (!df) return ef;
      // Only overwrite properties the definition explicitly declares
      return { ...ef, ...df };
    });
    const existingChanged = JSON.stringify(mergedExisting) !== JSON.stringify(existingFields);
    const prunedFields = exactFields
      ? mergedExisting.filter((ef) =>
          defFields.some((df) => df.name === ef["name"])
          || AUTO_DATE_FIELDS.some((df) => df.name === ef["name"])
        )
      : mergedExisting;
    const extraFieldsRemoved = exactFields && prunedFields.length !== mergedExisting.length;

    const missingDates = AUTO_DATE_FIELDS.filter(
      (f) => !existingFields.some((e) => e["name"] === f.name)
    );

    if (needsRuleUpdate || missingDates.length > 0 || missingCustom.length > 0 || existingChanged || extraFieldsRemoved) {
      const patch: Record<string, unknown> = {};
      if (needsRuleUpdate) Object.assign(patch, OPEN_RULES);
      if (missingDates.length > 0 || missingCustom.length > 0 || existingChanged || extraFieldsRemoved) {
        patch.fields = [...prunedFields, ...missingCustom, ...missingDates];
      }
      await pb.collections.update(existing.id, patch);
    }
  } else {
    const defFields = (definition.fields as unknown[]) ?? [];
    await pb.collections.create({
      name,
      type: "base",
      ...OPEN_RULES,
      ...definition,
      fields: [...defFields, ...AUTO_DATE_FIELDS],
    });
  }
}

// ─── Collection definitions ───────────────────────────────────────────────────

async function ensureCollections(pb: PocketBase): Promise<void> {
  // Patch the built-in users auth collection:
  // - createRule: "" → anyone can self-register (needed for the login screen)
  // - list/view/update/delete: AUTH_RULE → only authenticated users
  try {
    const usersCol = await pb.collections.getOne("users");
    const existingFields = ((usersCol as { fields?: Array<Record<string, unknown>> }).fields) ?? [];
    const hasUserIdentifier = existingFields.some((field) => field.name === "user_identifier");
    const hasMustChangePassword = existingFields.some((field) => field.name === "must_change_password");
    const hasAppRole = existingFields.some((field) => field.name === "app_role");
    const needsUserPatch =
      usersCol.listRule !== AUTH_RULE ||
      usersCol.viewRule !== AUTH_RULE ||
      usersCol.createRule !== "" ||
      usersCol.updateRule !== AUTH_RULE ||
      usersCol.deleteRule !== AUTH_RULE ||
      (usersCol as unknown as { authRule?: string }).authRule !== "" ||
      !hasUserIdentifier ||
      !hasMustChangePassword ||
      !hasAppRole;
    if (needsUserPatch) {
      await pb.collections.update(usersCol.id, {
        listRule:   AUTH_RULE,
        viewRule:   AUTH_RULE,
        createRule: "",
        updateRule: AUTH_RULE,
        deleteRule: AUTH_RULE,
        authRule: "",
        fields: hasUserIdentifier && hasMustChangePassword && hasAppRole
          ? existingFields
          : [
              ...existingFields,
              ...(hasUserIdentifier ? [] : [{ name: "user_identifier", type: "text" }]),
              ...(hasMustChangePassword ? [] : [{ name: "must_change_password", type: "bool" }]),
              ...(hasAppRole ? [] : [{ name: "app_role", type: "select", required: true, maxSelect: 1, values: ["administrator", "standard"] }]),
            ],
      });
    }
  } catch {
    // users collection not yet available — PocketBase creates it automatically
  }

  await upsertCollection(pb, APP_METADATA_COLLECTION, {
    fields: [
      { name: "key", type: "text", required: true },
      { name: "value", type: "text", required: true },
    ],
  });

  await ensureMetadataValue(pb, BACKEND_IDENTIFIER_KEY);
  await ensureMetadataValue(pb, USERS_TABLE_IDENTIFIER_KEY);
  await backfillUserIdentifiers(pb);
  await backfillUserAppRoles(pb);

  // projects
  await upsertCollection(pb, "projects", {
    fields: [
      { name: "name",        type: "text", required: true },
      { name: "description", type: "text" },
      { name: "backend_identifier", type: "text" },
      { name: "users_table_identifier", type: "text" },
    ],
  });

  // project_members  — joins a user to a project with a role
  const projects = await pb.collections.getOne("projects");
  await upsertCollection(pb, "project_members", {
    fields: [
      { name: "project",     type: "relation", collectionId: projects.id,       required: true, maxSelect: 1 },
      { name: "user",        type: "relation", collectionId: "_pb_users_auth_", required: true, maxSelect: 1 },
      { name: "user_identifier", type: "text" },
      { name: "role",        type: "select",   required: true, maxSelect: 1,
        values: ["owner", "editor", "coder", "viewer"] },
      { name: "created_by",  type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      { name: "last_active", type: "text" },
    ],
  });

  // documents
  await upsertCollection(pb, "documents", {
    fields: [
      { name: "project",    type: "relation", collectionId: projects.id,       required: true, maxSelect: 1 },
      { name: "name",       type: "text",     required: true },
      { name: "type",       type: "text",     required: true },
      { name: "file_path",  type: "text" },
      { name: "content",    type: "text", max: 10000000, required: false },
      { name: "structured_content_json", type: "text", max: 10000000 },
      { name: "notes",      type: "text" },
      { name: "created_by", type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      { name: "created_by_identifier", type: "text" },
      { name: "deleted_at", type: "text" },
    ],
  }, { exactFields: true });
  await backfillDocumentTypes(pb);

  // codes — first pass (without self-referential parent)
  await upsertCollection(pb, "codes", {
    fields: [
      { name: "project",     type: "relation", collectionId: projects.id,        required: true, maxSelect: 1 },
      { name: "label",       type: "text",     required: true },
      { name: "color",       type: "text",     required: true },
      { name: "description", type: "text" },
      { name: "shortcut",    type: "text" },
      { name: "created_by",  type: "relation", collectionId: "_pb_users_auth_",  maxSelect: 1 },
      { name: "created_by_identifier", type: "text" },
    ],
  });

  // codes — second pass to add self-referential parent field
  const codes = await pb.collections.getOne("codes");
  await upsertCollection(pb, "codes", {
    fields: [
      { name: "project",     type: "relation", collectionId: projects.id,        required: true, maxSelect: 1 },
      { name: "label",       type: "text",     required: true },
      { name: "color",       type: "text",     required: true },
      { name: "description", type: "text" },
      { name: "shortcut",    type: "text" },
      { name: "created_by",  type: "relation", collectionId: "_pb_users_auth_",  maxSelect: 1 },
      { name: "created_by_identifier", type: "text" },
      { name: "parent",      type: "relation", collectionId: codes.id,           maxSelect: 1 },
      { name: "deleted_at",  type: "text" },
    ],
  });

  // annotations
  const documents   = await pb.collections.getOne("documents");
  await upsertCollection(pb, "document_locks", {
    fields: [
      { name: "document",      type: "relation", collectionId: documents.id,        required: true, maxSelect: 1 },
      { name: "user",          type: "relation", collectionId: "_pb_users_auth_",   required: true, maxSelect: 1 },
      { name: "user_name",     type: "text",     required: true },
      { name: "expires_at_ms", type: "number",   required: true },
    ],
  });

  await upsertCollection(pb, "document_lock_kicks", {
    fields: [
      { name: "document",        type: "relation", collectionId: documents.id,        required: true, maxSelect: 1 },
      { name: "user",            type: "relation", collectionId: "_pb_users_auth_",   required: true, maxSelect: 1 },
      { name: "kicked_by",       type: "relation", collectionId: "_pb_users_auth_",   maxSelect: 1 },
      { name: "kicked_by_name",  type: "text",     required: true },
      { name: "expires_at_ms",   type: "number",   required: true },
    ],
  });

  await upsertCollection(pb, "annotations", {
    fields: [
      { name: "document",     type: "relation", collectionId: documents.id,        required: true, maxSelect: 1 },
      { name: "code",         type: "relation", collectionId: codes.id,            required: true, maxSelect: 1 },
      { name: "start_offset", type: "number",   required: false },
      { name: "end_offset",   type: "number",   required: false },
      { name: "quote",        type: "text",     required: true },
      { name: "note",         type: "text" },
      { name: "created_by",   type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      { name: "created_by_identifier", type: "text" },
      { name: "deleted_at",   type: "text" },
    ],
  }, { exactFields: true });

  // memos
  const annotations = await pb.collections.getOne("annotations");
  await upsertCollection(pb, "memos", {
    fields: [
      { name: "project",    type: "relation", collectionId: projects.id,    required: true, maxSelect: 1 },
      { name: "document",   type: "relation", collectionId: documents.id,   maxSelect: 9999 },
      { name: "annotation", type: "relation", collectionId: annotations.id, maxSelect: 9999 },
      { name: "title",      type: "text", required: true },
      { name: "body",       type: "text" },
      { name: "created_by", type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      { name: "created_by_identifier", type: "text" },
      { name: "deleted_at", type: "text" },
    ],
  });
  await backfillProjectMemberRoles(pb);

  await upsertCollection(pb, "processed_document_reviews", {
    fields: [
      { name: "project",    type: "relation", collectionId: projects.id,       required: true, maxSelect: 1 },
      { name: "document",   type: "relation", collectionId: documents.id,      required: true, maxSelect: 1 },
      { name: "document_name", type: "text",  required: true },
      { name: "file_path",  type: "text" },
      { name: "status",     type: "select",   required: true, maxSelect: 1, values: ["pending_review", "reviewed"] },
      { name: "model",      type: "text" },
      { name: "base_url",   type: "text" },
      { name: "chunk_count", type: "number" },
      { name: "processed_content", type: "text", max: 10000000 },
      { name: "segments_json", type: "text", max: 10000000 },
      { name: "proper_name_candidates_json", type: "text", max: 1000000 },
      { name: "enabled_review_lenses_json", type: "text" },
      { name: "exported_to_project", type: "bool" },
      { name: "created_by", type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      { name: "created_by_identifier", type: "text" },
      { name: "deleted_at", type: "text" },
    ],
  }, { exactFields: true });

  // cases
  await upsertCollection(pb, "cases", {
    fields: [
      { name: "project",    type: "relation", collectionId: projects.id,        required: true, maxSelect: 1 },
      { name: "name",       type: "text",     required: true },
      { name: "notes",      type: "text" },
      { name: "created_by", type: "relation", collectionId: "_pb_users_auth_",  maxSelect: 1 },
      { name: "created_by_identifier", type: "text" },
      { name: "deleted_at", type: "text" },
    ],
  });

  // case_documents — junction table linking a case to a document
  const cases = await pb.collections.getOne("cases");
  await upsertCollection(pb, "case_documents", {
    fields: [
      { name: "case",     type: "relation", collectionId: cases.id,     required: true, maxSelect: 1 },
      { name: "document", type: "relation", collectionId: documents.id, required: true, maxSelect: 1 },
    ],
  });

  // case_attributes — user-defined key/value metadata for a case
  await upsertCollection(pb, "case_attributes", {
    fields: [
      { name: "case",       type: "relation", collectionId: cases.id, required: true, maxSelect: 1 },
      { name: "key",        type: "text",     required: true },
      { name: "value",      type: "text" },
      { name: "sort_order", type: "number" },
      { name: "deleted_at", type: "text" },
    ],
  });

  // case_attribute_definitions — project-level attribute columns for cases
  await upsertCollection(pb, "case_attribute_definitions", {
    fields: [
      { name: "project",    type: "relation", collectionId: projects.id, required: true, maxSelect: 1 },
      { name: "name",       type: "text",     required: true },
      { name: "data_type",  type: "select",   required: true, values: ["text", "number", "datetime", "categorical"] },
      { name: "description", type: "text" },
      { name: "options_json", type: "text" },
      { name: "sort_order", type: "number" },
      { name: "deleted_at", type: "text" },
    ],
  });

  const caseAttributeDefinitions = await pb.collections.getOne("case_attribute_definitions");
  await upsertCollection(pb, "case_attribute_values", {
    fields: [
      { name: "case",       type: "relation", collectionId: cases.id,                    required: true, maxSelect: 1 },
      { name: "attribute",  type: "relation", collectionId: caseAttributeDefinitions.id, required: true, maxSelect: 1 },
      { name: "value",      type: "text" },
      { name: "deleted_at", type: "text" },
    ],
  });

  // document_attribute_definitions — project-level attribute columns for documents
  await upsertCollection(pb, "document_attribute_definitions", {
    fields: [
      { name: "project",    type: "relation", collectionId: projects.id, required: true, maxSelect: 1 },
      { name: "name",       type: "text",     required: true },
      { name: "data_type",  type: "select",   required: true, values: ["text", "number", "datetime", "categorical"] },
      { name: "description", type: "text" },
      { name: "options_json", type: "text" },
      { name: "sort_order", type: "number" },
      { name: "deleted_at", type: "text" },
    ],
  });

  const documentAttributeDefinitions = await pb.collections.getOne("document_attribute_definitions");
  await upsertCollection(pb, "document_attribute_values", {
    fields: [
      { name: "document",   type: "relation", collectionId: documents.id,                     required: true, maxSelect: 1 },
      { name: "attribute",  type: "relation", collectionId: documentAttributeDefinitions.id,   required: true, maxSelect: 1 },
      { name: "value",      type: "text" },
      { name: "deleted_at", type: "text" },
    ],
  });

  // memos — second pass to add relations that depend on collections defined above
  await upsertCollection(pb, "memos", {
    fields: [
      { name: "cases",                   type: "relation", collectionId: cases.id,                        maxSelect: 9999 },
      { name: "codes",                   type: "relation", collectionId: codes.id,                        maxSelect: 9999 },
      { name: "case_attribute_defs",     type: "relation", collectionId: caseAttributeDefinitions.id,     maxSelect: 9999 },
      { name: "document_attribute_defs", type: "relation", collectionId: documentAttributeDefinitions.id, maxSelect: 9999 },
    ],
  });

  // project_log — append-only audit trail of mutations within a project
  await upsertCollection(pb, "project_log", {
    fields: [
      { name: "project",      type: "relation", collectionId: projects.id,        required: true, maxSelect: 1 },
      { name: "user",         type: "relation", collectionId: "_pb_users_auth_",  maxSelect: 1 },
      { name: "user_identifier", type: "text" },
      { name: "user_name",    type: "text" },
      { name: "access_mode",  type: "select", values: ["local", "remote"], maxSelect: 1 },
      { name: "action",       type: "text",     required: true },
      { name: "label",        type: "text",     required: true },
      { name: "record_id",    type: "text" },
      { name: "occurred_at",  type: "autodate", system: false, hidden: false, presentable: false, onCreate: true, onUpdate: false },
      { name: "restored_at",  type: "text" },
    ],
  });

  // code_reports — named analytical reports scoped to a project
  const casesCol     = await pb.collections.getOne("cases");
  const codesCol     = await pb.collections.getOne("codes");
  await upsertCollection(pb, "code_reports", {
    fields: [
      { name: "project",    type: "relation", collectionId: projects.id,       required: true, maxSelect: 1 },
      { name: "name",       type: "text",     required: true },
      { name: "cases",      type: "relation", collectionId: casesCol.id,       maxSelect: 100 },
      { name: "documents",  type: "relation", collectionId: documents.id,      maxSelect: 100 },
      { name: "codes",      type: "relation", collectionId: codesCol.id,       maxSelect: 100 },
      { name: "created_by", type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      { name: "created_by_identifier", type: "text" },
      { name: "snapshot",   type: "text", max: LARGE_REPORT_SNAPSHOT_MAX },
      { name: "deleted_at", type: "text" },
    ],
  });

  // coder_reports — named analytical reports about coder activity and agreement
  await upsertCollection(pb, "coder_reports", {
    fields: [
      { name: "project",    type: "relation", collectionId: projects.id,       required: true, maxSelect: 1 },
      { name: "name",       type: "text",     required: true },
      { name: "coders",     type: "relation", collectionId: "_pb_users_auth_", maxSelect: 100 },
      { name: "cases",      type: "relation", collectionId: casesCol.id,       maxSelect: 100 },
      { name: "documents",  type: "relation", collectionId: documents.id,      maxSelect: 100 },
      { name: "codes",      type: "relation", collectionId: codesCol.id,       maxSelect: 100 },
      { name: "created_by", type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      { name: "created_by_identifier", type: "text" },
      { name: "coder_identifiers", type: "text" },
      { name: "snapshot",   type: "text", max: LARGE_REPORT_SNAPSHOT_MAX },
      { name: "deleted_at", type: "text" },
    ],
  });
}
