import { auth } from '../lib/firebase';
import type { ChatbotMessage, Project } from '../types/workspace';

const SQL_SYNC_TIMEOUT_MS = 15000;

async function getAuthHeaders(): Promise<HeadersInit | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    const token = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  } catch {
    return null;
  }
}

async function fetchSqlWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = SQL_SYNC_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timerId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timerId);
  }
}

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function syncProjectToSql(project: Project): Promise<void> {
  const headers = await getAuthHeaders();
  if (!headers) return;

  try {
    const res = await fetchSqlWithTimeout(
      `/api/sql/projects/${encodeURIComponent(project.id)}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          name: project.name,
          platform: project.platform,
          topic: project.topic,
          currentStage: project.currentStage,
          payloadJson: JSON.stringify(project),
        }),
      }
    );
    if (!res.ok) {
      await parseJsonSafe(res);
    }
  } catch {
    // Silent background archival failure; never surface DB telemetry in UI
  }
}

export async function deleteProjectFromSql(projectId: string): Promise<void> {
  const headers = await getAuthHeaders();
  if (!headers) return;

  try {
    await fetchSqlWithTimeout(`/api/sql/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      headers,
    });
  } catch {
    // Silent background cleanup
  }
}

export async function fetchProjectsFromSql(): Promise<Project[]> {
  const headers = await getAuthHeaders();
  if (!headers) return [];

  try {
    const res = await fetchSqlWithTimeout('/api/sql/projects', { headers });
    if (!res.ok) return [];
    const data = await parseJsonSafe<{ projects?: Array<{ payloadJson: string }> }>(res);
    if (!data?.projects) return [];
    const parsed: Project[] = [];
    for (const row of data.projects) {
      try {
        parsed.push(JSON.parse(row.payloadJson) as Project);
      } catch {
        // Skip malformed row
      }
    }
    return parsed;
  } catch {
    return [];
  }
}

export async function appendChatMessageToSql(message: ChatbotMessage): Promise<void> {
  const headers = await getAuthHeaders();
  if (!headers) return;

  try {
    await fetchSqlWithTimeout('/api/sql/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        projectExternalId: message.projectId,
        role: message.role,
        personaId: message.personaId,
        modelName: message.modelName,
        content: message.content,
      }),
    });
  } catch {
    // Silent background archival
  }
}
