import PocketBase from "pocketbase";
import { invoke } from "@tauri-apps/api/core";

// ─── Singleton client ────────────────────────────────────────────────────────

let _pb: PocketBase | null = null;

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

const SUPERUSER_EMAIL = "app@kanqual.internal";
const SUPERUSER_PASSWORD = "Kanqual_Internal_2024!";

// ─── Superuser helper ────────────────────────────────────────────────────────

/**
 * Run `fn` with a short-lived superuser-authed PocketBase instance.
 * The main `_pb` singleton's auth state (including localStorage) is fully
 * preserved — the admin instance uses its own separate auth slot.
 */
async function withSuperuser<T>(fn: (admin: PocketBase) => Promise<T>): Promise<T> {
  const pb = await getPb();
  // Snapshot the current user session so we can restore it after the
  // admin instance's authStore.clear() removes the shared localStorage key.
  const savedToken = pb.authStore.token;
  const savedRecord = pb.authStore.record;

  const admin = new PocketBase(pb.baseURL);
  admin.autoCancellation(false);
  await admin.collection("_superusers").authWithPassword(
    SUPERUSER_EMAIL,
    SUPERUSER_PASSWORD,
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
}): Promise<string> {
  return withSuperuser(async (admin) => {
    const record = await admin.collection("users").create({ ...data, emailVisibility: true });
    return record.id;
  });
}

/** Delete a user account (requires superuser). */
export async function deleteUserAccount(userId: string): Promise<void> {
  await withSuperuser((admin) => admin.collection("users").delete(userId));
}

/** Update a user's name and/or email (requires superuser). */
export async function updateUserAccount(
  userId: string,
  data: { name?: string; email?: string },
): Promise<void> {
  await withSuperuser((admin) => admin.collection("users").update(userId, data));
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

export async function ensureSetup(pb: PocketBase): Promise<void> {
  // Preserve any existing user session before temporarily authenticating as
  // superuser. This allows persistent logins to survive across app restarts.
  const savedToken = pb.authStore.token;
  const savedRecord = pb.authStore.record;

  // Authenticate as the internal superuser (created by Rust before window shows).
  // Retry several times because PocketBase's auth system can take a moment to
  // become ready even after the health check passes.
  const maxAttempts = 8;
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await pb.collection("_superusers").authWithPassword(
        SUPERUSER_EMAIL,
        SUPERUSER_PASSWORD
      );
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (lastError) {
    // Restore any user session before throwing.
    if (savedToken) pb.authStore.save(savedToken, savedRecord);
    else pb.authStore.clear();
    console.error("Superuser auth failed after retries:", lastError);
    throw new Error("Database initialisation failed. Please restart the app.");
  }

  try {
    await ensureCollections(pb);
  } finally {
    // Drop the superuser token and restore the previous user session (if any).
    if (savedToken) {
      pb.authStore.save(savedToken, savedRecord);
    } else {
      pb.authStore.clear();
    }
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
  definition: Record<string, unknown>
): Promise<void> {
  const existing = await getCollection(pb, name);
  if (existing) {
    const needsRuleUpdate = existing.listRule !== AUTH_RULE;
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

    const missingDates = AUTO_DATE_FIELDS.filter(
      (f) => !existingFields.some((e) => e["name"] === f.name)
    );

    if (needsRuleUpdate || missingDates.length > 0 || missingCustom.length > 0 || existingChanged) {
      const patch: Record<string, unknown> = {};
      if (needsRuleUpdate) Object.assign(patch, OPEN_RULES);
      if (missingDates.length > 0 || missingCustom.length > 0 || existingChanged) {
        patch.fields = [...mergedExisting, ...missingCustom, ...missingDates];
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
    if (usersCol.listRule !== AUTH_RULE || usersCol.createRule !== "") {
      await pb.collections.update(usersCol.id, {
        listRule:   AUTH_RULE,
        viewRule:   AUTH_RULE,
        createRule: "",
        updateRule: AUTH_RULE,
        deleteRule: AUTH_RULE,
      });
    }
  } catch {
    // users collection not yet available — PocketBase creates it automatically
  }

  // projects
  await upsertCollection(pb, "projects", {
    fields: [
      { name: "name",        type: "text", required: true },
      { name: "description", type: "text" },
    ],
  });

  // project_members  — joins a user to a project with a role
  const projects = await pb.collections.getOne("projects");
  await upsertCollection(pb, "project_members", {
    fields: [
      { name: "project",     type: "relation", collectionId: projects.id,       required: true, maxSelect: 1 },
      { name: "user",        type: "relation", collectionId: "_pb_users_auth_", required: true, maxSelect: 1 },
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
      { name: "file_path",  type: "text" },
      { name: "content",    type: "text", max: 10000000, required: false },
      { name: "notes",      type: "text" },
      { name: "created_by", type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      { name: "deleted_at", type: "text" },
    ],
  });

  // codes — first pass (without self-referential parent)
  await upsertCollection(pb, "codes", {
    fields: [
      { name: "project",     type: "relation", collectionId: projects.id,        required: true, maxSelect: 1 },
      { name: "label",       type: "text",     required: true },
      { name: "color",       type: "text",     required: true },
      { name: "description", type: "text" },
      { name: "shortcut",    type: "text" },
      { name: "created_by",  type: "relation", collectionId: "_pb_users_auth_",  maxSelect: 1 },
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
      { name: "parent",      type: "relation", collectionId: codes.id,           maxSelect: 1 },
      { name: "deleted_at",  type: "text" },
    ],
  });

  // annotations
  const documents   = await pb.collections.getOne("documents");
  await upsertCollection(pb, "annotations", {
    fields: [
      { name: "document",     type: "relation", collectionId: documents.id,        required: true, maxSelect: 1 },
      { name: "code",         type: "relation", collectionId: codes.id,            required: true, maxSelect: 1 },
      { name: "start_offset", type: "number",   required: true },
      { name: "end_offset",   type: "number",   required: true },
      { name: "quote",        type: "text",     required: true },
      { name: "note",         type: "text" },
      { name: "created_by",   type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      { name: "deleted_at",   type: "text" },
    ],
  });

  // memos
  const annotations = await pb.collections.getOne("annotations");
  await upsertCollection(pb, "memos", {
    fields: [
      { name: "project",    type: "relation", collectionId: projects.id,    required: true, maxSelect: 1 },
      { name: "document",   type: "relation", collectionId: documents.id,   maxSelect: 1 },
      { name: "annotation", type: "relation", collectionId: annotations.id, maxSelect: 1 },
      { name: "title",      type: "text", required: true },
      { name: "body",       type: "text" },
      { name: "created_by", type: "relation", collectionId: "_pb_users_auth_", maxSelect: 1 },
      { name: "deleted_at", type: "text" },
    ],
  });

  // cases
  await upsertCollection(pb, "cases", {
    fields: [
      { name: "project",    type: "relation", collectionId: projects.id,        required: true, maxSelect: 1 },
      { name: "name",       type: "text",     required: true },
      { name: "notes",      type: "text" },
      { name: "created_by", type: "relation", collectionId: "_pb_users_auth_",  maxSelect: 1 },
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

  // project_log — append-only audit trail of mutations within a project
  await upsertCollection(pb, "project_log", {
    fields: [
      { name: "project",      type: "relation", collectionId: projects.id,        required: true, maxSelect: 1 },
      { name: "user",         type: "relation", collectionId: "_pb_users_auth_",  maxSelect: 1 },
      { name: "user_name",    type: "text" },
      { name: "action",       type: "text",     required: true },
      { name: "label",        type: "text",     required: true },
      { name: "record_id",    type: "text" },
      { name: "occurred_at",  type: "autodate", system: false, hidden: false, presentable: false, onCreate: true, onUpdate: false },
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
      { name: "snapshot",   type: "text" },
      { name: "deleted_at", type: "text" },
    ],
  });
}
