# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Strict Ownership & Verified Identity**: All user documents (`/users/{userId}`), projects (`/users/{userId}/projects/{projectId}`), and chatbot messages (`/users/{userId}/chatThreads/{threadId}/messages/{messageId}`) require `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`.
2. **No Blanket Reads or PII Exposure**: `/users/{userId}` contains `email` (PII) and is strictly limited to `get` by the owner (`request.auth.uid == userId`). `allow list` on `/users` is denied.
3. **Subcollection Master Gate**: Writing or listing a project under `/users/{userId}/projects/{projectId}` or a message under `/users/{userId}/chatThreads/{threadId}/messages/{messageId}` requires the parent `/users/{userId}` profile document to exist (`exists(...)`), and `incoming().ownerUid == request.auth.uid`.
4. **Immutable Ownership & Temporal Integrity**:
   - `uid`, `ownerUid`, `id`, `projectId`, and `createdAt` are immutable after creation.
   - `createdAt == request.time` on `create`; `updatedAt == request.time` on `create` and `update`.
5. **Path Variable & Payload Bounding**:
   - Every document ID path variable (`userId`, `projectId`, `threadId`, `messageId`) must pass `isValidId()` (`<= 128` chars matching `^[a-zA-Z0-9_\-]+$`).
   - Every string field enforces strict `.size()` bounds; every array enforces `.size() <= MAX` bounds.
   - `keys().hasAll(...)` + `keys().hasOnly(...)` blocks shadow/ghost fields on create, and `affectedKeys().hasOnly(...)` locks update mutations to action-specific keys.
6. **Immutable Chat History**: `ChatMessage` documents are append-only (`update` denied) and may only be deleted or read by their verified owner.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Project Create**: Anonymous caller attempts `create` on `/users/u1/projects/proj_1` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts `create` on `/users/u1` -> `PERMISSION_DENIED`.
3. **Identity Spoofing (Cross-Tenant Create)**: User `u2` creates `/users/u1/projects/proj_1` or sets `ownerUid: "u1"` inside `/users/u2/projects/proj_1` -> `PERMISSION_DENIED`.
4. **Privilege Escalation / Shadow Field (`hasOnly` Check)**: User `u1` creates `/users/u1` with extra ghost field `isAdmin: true` or `role: "admin"` -> `PERMISSION_DENIED`.
5. **PII Cross-User Read**: User `u2` calls `get` on `/users/u1` -> `PERMISSION_DENIED`.
6. **Blanket User List Scraping**: Any user attempts `list` on `/users` -> `PERMISSION_DENIED`.
7. **ID Poisoning Attack**: User `u1` attempts `create` with a 300-char or `../bad` document ID `projectId` -> `PERMISSION_DENIED`.
8. **Orphaned Subcollection Write**: User `u1` attempts to create `/users/u1/projects/proj_1` before parent `/users/u1` exists -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: User `u1` creates a project with `createdAt` set to a fake past timestamp instead of `request.time` -> `PERMISSION_DENIED`.
10. **Immutable Field Tampering on Update**: User `u1` updates `/users/u1/projects/proj_1` attempting to mutate `ownerUid` or `createdAt` -> `PERMISSION_DENIED`.
11. **Value Poisoning / Type Mismatch on Update**: User `u1` updates `currentStage` to `99` or `name` to a 5000-character string -> `PERMISSION_DENIED`.
12. **Unbounded Array / Denial-of-Wallet Exhaustion**: User `u1` submits `stage3.shots` with `> 60` elements or `stage1.messages` with `> 100` elements -> `PERMISSION_DENIED`.
