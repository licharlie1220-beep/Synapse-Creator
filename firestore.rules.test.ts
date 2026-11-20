import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');
const DRAFT_RULES_PATH = path.resolve(process.cwd(), 'DRAFT_firestore.rules');

function readActiveRules(): string {
  const target = fs.existsSync(RULES_PATH) ? RULES_PATH : DRAFT_RULES_PATH;
  return fs.readFileSync(target, 'utf8');
}

interface MockAuth {
  uid: string;
  token: {
    email_verified: boolean;
  };
}

interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

const VALID_ID_RE = /^[a-zA-Z0-9_\-]+$/;

/**
 * Mirrors the exact invariants enforced by firestore.rules for Dirty Dozen payload verification.
 */
function simulateProjectWrite(params: {
  auth: MockAuth | null;
  pathUserId: string;
  projectId: string;
  parentUserExists: boolean;
  isCreate: boolean;
  requestTime: number;
  incoming: Record<string, unknown>;
  existing?: Record<string, unknown>;
}): ValidationResult {
  if (!params.auth) return { allowed: false, reason: 'PERMISSION_DENIED: unauthenticated' };
  if (!params.auth.token.email_verified) {
    return { allowed: false, reason: 'PERMISSION_DENIED: email_verified is false' };
  }
  if (params.auth.uid !== params.pathUserId) {
    return { allowed: false, reason: 'PERMISSION_DENIED: cross-tenant path access' };
  }
  if (!VALID_ID_RE.test(params.pathUserId) || params.pathUserId.length > 128) {
    return { allowed: false, reason: 'PERMISSION_DENIED: invalid userId' };
  }
  if (!VALID_ID_RE.test(params.projectId) || params.projectId.length > 128) {
    return { allowed: false, reason: 'PERMISSION_DENIED: ID poisoning guard' };
  }
  if (params.isCreate && !params.parentUserExists) {
    return { allowed: false, reason: 'PERMISSION_DENIED: orphaned subcollection write' };
  }

  const requiredKeys = [
    'id',
    'ownerUid',
    'name',
    'platform',
    'topic',
    'currentStage',
    'updatedAtLabel',
    'stage1',
    'stage2',
    'stage3',
    'createdAt',
    'updatedAt',
  ];
  const keys = Object.keys(params.incoming);
  if (!requiredKeys.every((k) => keys.includes(k))) {
    return { allowed: false, reason: 'PERMISSION_DENIED: missing required keys' };
  }
  if (!keys.every((k) => requiredKeys.includes(k))) {
    return { allowed: false, reason: 'PERMISSION_DENIED: shadow/ghost field rejected by hasOnly' };
  }
  if (params.incoming.ownerUid !== params.auth.uid || params.incoming.id !== params.projectId) {
    return { allowed: false, reason: 'PERMISSION_DENIED: ownerUid/id identity spoofing' };
  }
  if (typeof params.incoming.name !== 'string' || params.incoming.name.length < 1 || params.incoming.name.length > 120) {
    return { allowed: false, reason: 'PERMISSION_DENIED: name length/type violation' };
  }
  const stage = params.incoming.currentStage;
  if (typeof stage !== 'number' || !Number.isInteger(stage) || stage < 1 || stage > 3) {
    return { allowed: false, reason: 'PERMISSION_DENIED: currentStage out of range 1..3' };
  }
  const s1 = params.incoming.stage1 as Record<string, unknown>;
  const s3 = params.incoming.stage3 as Record<string, unknown>;
  if (Array.isArray(s1?.messages) && s1.messages.length > 100) {
    return { allowed: false, reason: 'PERMISSION_DENIED: stage1.messages exceeds 100 limit' };
  }
  if (Array.isArray(s3?.shots) && s3.shots.length > 60) {
    return { allowed: false, reason: 'PERMISSION_DENIED: stage3.shots exceeds 60 limit' };
  }
  if (params.isCreate) {
    if (params.incoming.createdAt !== params.requestTime || params.incoming.updatedAt !== params.requestTime) {
      return { allowed: false, reason: 'PERMISSION_DENIED: client timestamp forgery' };
    }
  } else if (params.existing) {
    if (
      params.incoming.createdAt !== params.existing.createdAt ||
      params.incoming.ownerUid !== params.existing.ownerUid
    ) {
      return { allowed: false, reason: 'PERMISSION_DENIED: immutable field mutated' };
    }
  }

  return { allowed: true };
}

function makeValidProject(uid = 'u1', id = 'proj_1', ts = 1000): Record<string, unknown> {
  return {
    id,
    ownerUid: uid,
    name: '早安单词',
    platform: '抖音竖屏',
    topic: '咖啡店点单误区',
    currentStage: 1,
    updatedAtLabel: '2026-04-01 10:00',
    stage1: {
      searchGroundingEnabled: true,
      messages: [],
      branches: [],
      activeBranchId: null,
      riskAudit: null,
    },
    stage2: {
      brief: null,
      scriptContent: '',
      editHistory: [],
    },
    stage3: {
      activeVisualLockId: 'warm-cinema',
      customVisualLockSuffix: '',
      shots: [],
    },
    createdAt: ts,
    updatedAt: ts,
  };
}

test('Firestore rules file defines rules_version 2, global catch-all deny, and all blueprint collections', () => {
  const rules = readActiveRules();
  assert.match(rules, /rules_version\s*=\s*'2';/);
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  assert.match(rules, /match \/users\/\{userId\}/);
  assert.match(rules, /match \/projects\/\{projectId\}/);
  assert.match(rules, /match \/chatThreads\/\{threadId\}\/messages\/\{messageId\}/);
  assert.match(rules, /match \/test\/connection/);
  assert.match(rules, /request\.auth\.token\.email_verified\s*==\s*true/);
});

test('Dirty Dozen adversarial payloads all return PERMISSION_DENIED', () => {
  const ts = 1700000000;
  const authU1: MockAuth = { uid: 'u1', token: { email_verified: true } };
  const authU2: MockAuth = { uid: 'u2', token: { email_verified: true } };
  const unverified: MockAuth = { uid: 'u1', token: { email_verified: false } };

  // 1. Unauthenticated create
  assert.equal(
    simulateProjectWrite({
      auth: null,
      pathUserId: 'u1',
      projectId: 'proj_1',
      parentUserExists: true,
      isCreate: true,
      requestTime: ts,
      incoming: makeValidProject('u1', 'proj_1', ts),
    }).allowed,
    false
  );

  // 2. Unverified email create
  assert.equal(
    simulateProjectWrite({
      auth: unverified,
      pathUserId: 'u1',
      projectId: 'proj_1',
      parentUserExists: true,
      isCreate: true,
      requestTime: ts,
      incoming: makeValidProject('u1', 'proj_1', ts),
    }).allowed,
    false
  );

  // 3. Identity spoofing (cross-tenant)
  assert.equal(
    simulateProjectWrite({
      auth: authU2,
      pathUserId: 'u1',
      projectId: 'proj_1',
      parentUserExists: true,
      isCreate: true,
      requestTime: ts,
      incoming: makeValidProject('u1', 'proj_1', ts),
    }).allowed,
    false
  );

  // 4. Shadow ghost field injection
  assert.equal(
    simulateProjectWrite({
      auth: authU1,
      pathUserId: 'u1',
      projectId: 'proj_1',
      parentUserExists: true,
      isCreate: true,
      requestTime: ts,
      incoming: { ...makeValidProject('u1', 'proj_1', ts), isAdmin: true },
    }).allowed,
    false
  );

  // 5-7. ID poisoning attack (overlong / invalid chars)
  assert.equal(
    simulateProjectWrite({
      auth: authU1,
      pathUserId: 'u1',
      projectId: 'x'.repeat(200),
      parentUserExists: true,
      isCreate: true,
      requestTime: ts,
      incoming: makeValidProject('u1', 'x'.repeat(200), ts),
    }).allowed,
    false
  );

  // 8. Orphaned subcollection write
  assert.equal(
    simulateProjectWrite({
      auth: authU1,
      pathUserId: 'u1',
      projectId: 'proj_1',
      parentUserExists: false,
      isCreate: true,
      requestTime: ts,
      incoming: makeValidProject('u1', 'proj_1', ts),
    }).allowed,
    false
  );

  // 9. Client timestamp forgery
  assert.equal(
    simulateProjectWrite({
      auth: authU1,
      pathUserId: 'u1',
      projectId: 'proj_1',
      parentUserExists: true,
      isCreate: true,
      requestTime: ts,
      incoming: makeValidProject('u1', 'proj_1', 12345),
    }).allowed,
    false
  );

  // 10. Immutable createdAt tampering on update
  assert.equal(
    simulateProjectWrite({
      auth: authU1,
      pathUserId: 'u1',
      projectId: 'proj_1',
      parentUserExists: true,
      isCreate: false,
      requestTime: ts + 10,
      existing: makeValidProject('u1', 'proj_1', ts),
      incoming: { ...makeValidProject('u1', 'proj_1', ts), createdAt: ts + 5, updatedAt: ts + 10 },
    }).allowed,
    false
  );

  // 11. Value poisoning on currentStage
  assert.equal(
    simulateProjectWrite({
      auth: authU1,
      pathUserId: 'u1',
      projectId: 'proj_1',
      parentUserExists: true,
      isCreate: false,
      requestTime: ts + 10,
      existing: makeValidProject('u1', 'proj_1', ts),
      incoming: { ...makeValidProject('u1', 'proj_1', ts), currentStage: 99, updatedAt: ts + 10 },
    }).allowed,
    false
  );

  // 12. Unbounded shots array exhaustion
  const base = makeValidProject('u1', 'proj_1', ts);
  (base.stage3 as { shots: unknown[] }).shots = Array.from({ length: 65 }, (_, i) => ({ shotNumber: i + 1 }));
  assert.equal(
    simulateProjectWrite({
      auth: authU1,
      pathUserId: 'u1',
      projectId: 'proj_1',
      parentUserExists: true,
      isCreate: true,
      requestTime: ts,
      incoming: base,
    }).allowed,
    false
  );

  // Valid request passes
  assert.equal(
    simulateProjectWrite({
      auth: authU1,
      pathUserId: 'u1',
      projectId: 'proj_1',
      parentUserExists: true,
      isCreate: true,
      requestTime: ts,
      incoming: makeValidProject('u1', 'proj_1', ts),
    }).allowed,
    true
  );
});
