# Native Authorization Manual Test Script

## Goal
Verify that native Tauri command authorization matches the intended KanQual permission model, especially for:
- local admin-only maintenance
- embedding model management
- project embedding management
- denied-action error handling

## Recommended Test Setup
- Machine A: host/local KanQual session
- One local `administrator` account
- One local `standard` account
- One project with members assigned as:
  - `owner`
  - `editor`
  - `coder`
  - `viewer`
- AI Assist enabled project with enough content to build embeddings
- embedding model already available for project-embedding tests

## 1. Local Administrator Actions

### 1.1 Delete Local Users
Sign in as local `administrator`.

Steps:
1. Open `Settings -> App Settings -> Administration`.
2. Delete a different registered local user.

Expected:
- action succeeds
- user disappears from the local users list
- no native authorization error appears

### 1.2 Clear Local App Data
Sign in as local `administrator`.

Steps:
1. Open `Settings -> App Settings -> Administration`.
2. Run `Clear Local App Data`.
3. Confirm the warning prompt.

Expected:
- action succeeds
- app logs out / reloads as designed
- no native authorization error appears

Note:
- run this only when you are ready to reset the current local workspace

### 1.3 Embedding Model Management
Sign in as local `administrator`.

Steps:
1. Open `Settings -> App Settings -> AI Assist Settings`.
2. Start embedding model download if not present.
3. Cancel the download if it is in progress.
4. Clear/delete the local embedding model if it is installed.

Expected:
- each action succeeds when available
- no native authorization error appears

## 2. Standard Local User Restrictions

### 2.1 Local User Administration Blocked
Sign in as local `standard` user.

Steps:
1. Navigate to `Settings -> App Settings`.
2. Attempt to reach `Administration` if visible.
3. Attempt any local user management action if reachable.

Expected:
- UI should already block or hide the action appropriately
- if a path still reaches the native command, it must fail cleanly with a readable permission error

### 2.2 Clear Local App Data Blocked
Sign in as local `standard` user.

Steps:
1. Try to reach `Clear Local App Data`.

Expected:
- blocked in UI or denied cleanly by native authorization

### 2.3 Embedding Model Management Blocked
Sign in as local `standard` user.

Steps:
1. Try to start embedding model download.
2. Try to cancel embedding model download.
3. Try to clear/delete embedding model files.

Expected:
- blocked in UI or denied cleanly by native authorization
- no partial host-state mutation occurs

## 3. Project Embedding Permissions

These tests verify the project-role-based native checks.

### 3.1 Owner Allowed
Sign in as project `owner`.

Steps:
1. Open `Settings -> Project Settings -> AI Assist`.
2. Run embeddings.
3. Cancel an active build if possible.
4. Delete project embeddings.

Expected:
- all allowed actions succeed

### 3.2 Editor Allowed
Sign in as project `editor`.

Steps:
1. Open `Settings -> Project Settings -> AI Assist`.
2. Run embeddings.
3. Cancel an active build if possible.
4. Delete project embeddings.

Expected:
- all allowed actions succeed

### 3.3 Coder Blocked
Sign in as project `coder`.

Steps:
1. Open `Settings -> Project Settings -> AI Assist`.
2. Attempt build/cancel/delete if any path is reachable.

Expected:
- UI should block the actions
- if a native path is still hit, command must fail cleanly with a readable permission error

### 3.4 Viewer Blocked
Sign in as project `viewer`.

Steps:
1. Open `Settings -> Project Settings -> AI Assist`.
2. Attempt build/cancel/delete if any path is reachable.

Expected:
- blocked in UI or denied cleanly by native authorization

## 4. Network Mode

### 4.1 Allowed Session Can Change Network Mode
Sign in as a user who can reach `App Settings`.

Steps:
1. Open `Settings -> App Settings -> Network & Collaboration`.
2. Switch from `Local` to `LAN`.
3. Switch back to `Local`.

Expected:
- action succeeds
- app shows the normal status/notice messaging
- if a project is open, the project log records the mode change

### 4.2 Invalid Session Fails Cleanly
If practical, test with an expired or cleared session.

Steps:
1. Create a stale-session condition.
2. Attempt a network mode change.

Expected:
- native command rejects the action cleanly
- user sees a readable session/auth error rather than a crash

## 5. Error Message Quality

For every denied native action above, verify:
- error is readable
- error explains permission/session failure clearly
- app does not hang
- app state remains consistent after denial

Good examples:
- `Only a local administrator can perform this action.`
- `You do not have permission to build project embeddings.`
- `Your session is no longer valid. Please sign in again.`

## 6. Record Results

For each scenario, mark:
- `Pass`
- `Fail`
- `Needs follow-up`

Capture:
- user role used
- whether the block happened in UI or natively
- exact error message if denied
- whether any unintended state changed
