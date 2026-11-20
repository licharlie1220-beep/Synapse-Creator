import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreErrors';
import type { ChatbotMessage, Project } from '../types/workspace';

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
  return cleaned || `id_${Date.now()}`;
}

export async function ensureUserProfileDocument(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const profileFields = {
    email: (user.email || `${user.uid}@users.local`).slice(0, 256),
    displayName: (user.displayName || user.email?.split('@')[0] || '创作者').slice(0, 120),
    photoURL: (user.photoURL || '').slice(0, 512),
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        ...profileFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        ...profileFields,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function buildProjectPayload(uid: string, project: Project) {
  const id = sanitizeId(project.id);
  const stage1 = stripUndefined({
    searchGroundingEnabled: Boolean(project.stage1.searchGroundingEnabled),
    messages: project.stage1.messages.slice(-100),
    branches: project.stage1.branches.slice(0, 30),
    activeBranchId: project.stage1.activeBranchId ?? null,
    riskAudit: project.stage1.riskAudit ?? null,
  });
  const stage2 = stripUndefined({
    brief: project.stage2.brief ?? null,
    scriptContent: project.stage2.scriptContent.slice(0, 30000),
    editHistory: project.stage2.editHistory.slice(-100),
  });
  const stage3 = stripUndefined({
    activeVisualLockId: project.stage3.activeVisualLockId ?? null,
    customVisualLockSuffix: (project.stage3.customVisualLockSuffix || '').slice(0, 500),
    shots: project.stage3.shots.slice(0, 60),
  });

  return {
    id,
    ownerUid: uid,
    name: (project.name || '未命名项目').slice(0, 120),
    platform: (project.platform || '抖音 / 小红书竖屏 9:16').slice(0, 120),
    topic: (project.topic || '短视频选题').slice(0, 500),
    currentStage: project.currentStage,
    updatedAtLabel: (project.updatedAt || new Date().toISOString().slice(0, 16).replace('T', ' ')).slice(0, 40),
    stage1,
    stage2,
    stage3,
  };
}

export async function saveProjectToFirestore(uid: string, project: Project): Promise<void> {
  const safeId = sanitizeId(project.id);
  const path = `users/${uid}/projects/${safeId}`;
  const ref = doc(db, 'users', uid, 'projects', safeId);
  const fields = buildProjectPayload(uid, project);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...fields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        name: fields.name,
        platform: fields.platform,
        topic: fields.topic,
        currentStage: fields.currentStage,
        updatedAtLabel: fields.updatedAtLabel,
        stage1: fields.stage1,
        stage2: fields.stage2,
        stage3: fields.stage3,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteProjectFromFirestore(uid: string, projectId: string): Promise<void> {
  const safeId = sanitizeId(projectId);
  const path = `users/${uid}/projects/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'projects', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeUserProjects(
  uid: string,
  onData: (projects: Project[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/projects`;
  const q = query(collection(db, 'users', uid, 'projects'), where('ownerUid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: Array<{ project: Project; sortMs: number }> = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        const updatedTs = d.updatedAt as Timestamp | undefined;
        const sortMs = updatedTs && typeof updatedTs.toMillis === 'function' ? updatedTs.toMillis() : 0;
        const project: Project = {
          id: String(d.id || docSnap.id),
          name: String(d.name || '未命名项目'),
          platform: String(d.platform || ''),
          topic: String(d.topic || ''),
          currentStage: (d.currentStage === 1 || d.currentStage === 2 || d.currentStage === 3 ? d.currentStage : 1),
          updatedAt: String(d.updatedAtLabel || ''),
          stage1: d.stage1 as Project['stage1'],
          stage2: d.stage2 as Project['stage2'],
          stage3: d.stage3 as Project['stage3'],
        };
        items.push({ project, sortMs });
      });
      items.sort((a, b) => b.sortMs - a.sortMs);
      onData(items.map((item) => item.project));
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeChatMessages(
  uid: string,
  projectId: string,
  onData: (messages: ChatbotMessage[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeProjectId = sanitizeId(projectId);
  const path = `users/${uid}/chatThreads/${safeProjectId}/messages`;
  const q = query(
    collection(db, 'users', uid, 'chatThreads', safeProjectId, 'messages'),
    where('ownerUid', '==', uid),
    where('projectId', '==', safeProjectId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const rows: Array<{ msg: ChatbotMessage; sortMs: number }> = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        const createdTs = d.createdAt as Timestamp | undefined;
        const sortMs = createdTs && typeof createdTs.toMillis === 'function' ? createdTs.toMillis() : 0;
        rows.push({
          sortMs,
          msg: {
            id: String(d.id || docSnap.id),
            projectId: String(d.projectId || safeProjectId),
            role: d.role === 'model' ? 'model' : 'user',
            personaId: String(d.personaId || 'script-coach'),
            modelName: String(d.modelName || 'gemini-4-hydrogen'),
            content: String(d.content || ''),
            createdAt: sortMs
              ? new Date(sortMs).toISOString().slice(11, 16)
              : new Date().toISOString().slice(11, 16),
          },
        });
      });
      rows.sort((a, b) => a.sortMs - b.sortMs || a.msg.id.localeCompare(b.msg.id));
      onData(rows.map((r) => r.msg));
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function addChatMessageToFirestore(
  uid: string,
  message: ChatbotMessage
): Promise<void> {
  const safeProjectId = sanitizeId(message.projectId);
  const safeMessageId = sanitizeId(message.id);
  const path = `users/${uid}/chatThreads/${safeProjectId}/messages/${safeMessageId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'chatThreads', safeProjectId, 'messages', safeMessageId), {
      id: safeMessageId,
      ownerUid: uid,
      projectId: safeProjectId,
      role: message.role,
      personaId: message.personaId.slice(0, 64),
      modelName: message.modelName.slice(0, 64),
      content: message.content.slice(0, 20000),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function clearChatThreadInFirestore(
  uid: string,
  projectId: string,
  messageIds: string[]
): Promise<void> {
  const safeProjectId = sanitizeId(projectId);
  for (const msgId of messageIds) {
    const safeMsgId = sanitizeId(msgId);
    const path = `users/${uid}/chatThreads/${safeProjectId}/messages/${safeMsgId}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'chatThreads', safeProjectId, 'messages', safeMsgId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
}
