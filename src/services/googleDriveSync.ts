import { getDriveAccessToken } from '../lib/firebase';
import type { Project } from '../types/workspace';
import { normalizeProjectData } from '../utils/workflow';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export function getEffectiveDriveToken(customToken?: string): string | null {
  if (customToken && customToken.trim()) {
    return customToken.trim();
  }
  return getDriveAccessToken();
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '创作项目';
}

/**
 * 查找或自动创建 Google Drive 中的 Synapse 专属工程同步文件夹
 */
export async function findOrCreateDriveFolder(
  folderName: string = 'Synapse_Projects',
  accessToken: string
): Promise<string> {
  const cleanName = folderName.trim() || 'Synapse_Projects';
  const query = `name = '${cleanName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  const searchRes = await fetch(
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!searchRes.ok) {
    if (searchRes.status === 401 || searchRes.status === 403) {
      throw new Error('Google Drive 授权已过期或权限不足，请重新授权。');
    }
    throw new Error(`查询 Google Drive 同步文件夹失败 (HTTP ${searchRes.status})`);
  }

  const searchData = (await searchRes.json()) as { files?: Array<{ id: string; name: string }> };
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // 创建文件夹
  const createRes = await fetch(`${DRIVE_API_BASE}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: cleanName,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Synapse 创作者工作台自动云端同步备份目录',
    }),
  });

  if (!createRes.ok) {
    throw new Error(`创建 Google Drive 文件夹失败 (HTTP ${createRes.status})`);
  }

  const createData = (await createRes.json()) as { id: string };
  return createData.id;
}

/**
 * 将单个项目同步至 Google Drive（若已存在同名项目文件则自动更新版本，否则新建）
 */
export async function syncProjectToGoogleDrive(
  project: Project,
  accessToken: string,
  folderName: string = 'Synapse_Projects'
): Promise<{ ok: boolean; fileId: string; fileName: string; timestamp: string }> {
  const folderId = await findOrCreateDriveFolder(folderName, accessToken);
  const fileName = `${sanitizeName(project.name)}.synapse.json`;
  const fileContent = JSON.stringify(project, null, 2);
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  // 1. 查找是否已存在同名文件
  const query = `'${folderId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`;
  const searchRes = await fetch(
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  let existingFileId: string | null = null;
  if (searchRes.ok) {
    const searchData = (await searchRes.json()) as { files?: Array<{ id: string; name: string }> };
    if (searchData.files && searchData.files.length > 0) {
      existingFileId = searchData.files[0].id;
    }
  }

  const boundary = '-------SynapseDriveSyncBoundary' + Math.random().toString(36).substring(2);
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  if (existingFileId) {
    // PATCH 更新文件
    const metadata = {
      name: fileName,
      mimeType: 'application/json',
      description: `Synapse 同步备份 · 更新于 ${new Date().toISOString()}`,
    };

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      fileContent +
      closeDelimiter;

    const patchRes = await fetch(
      `${DRIVE_UPLOAD_BASE}/files/${existingFileId}?uploadType=multipart`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );

    if (!patchRes.ok) {
      throw new Error(`更新 Google Drive 文件失败 (HTTP ${patchRes.status})`);
    }

    return {
      ok: true,
      fileId: existingFileId,
      fileName,
      timestamp: now,
    };
  } else {
    // POST 新建文件
    const metadata = {
      name: fileName,
      mimeType: 'application/json',
      parents: [folderId],
      description: `Synapse 同步备份 · 创建于 ${new Date().toISOString()}`,
    };

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      fileContent +
      closeDelimiter;

    const postRes = await fetch(
      `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );

    if (!postRes.ok) {
      throw new Error(`上传 Google Drive 文件失败 (HTTP ${postRes.status})`);
    }

    const postData = (await postRes.json()) as { id: string };
    return {
      ok: true,
      fileId: postData.id,
      fileName,
      timestamp: now,
    };
  }
}

export interface DriveProjectFile {
  id: string;
  name: string;
  modifiedTime: string;
  sizeBytes: number;
}

/**
 * 获取 Google Drive 同步文件夹中的所有项目列表
 */
export async function listGoogleDriveProjects(
  accessToken: string,
  folderName: string = 'Synapse_Projects'
): Promise<DriveProjectFile[]> {
  const folderId = await findOrCreateDriveFolder(folderName, accessToken);
  const query = `'${folderId}' in parents and name contains '.synapse.json' and trashed = false`;

  const res = await fetch(
    `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=50`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    throw new Error(`读取 Google Drive 项目列表失败 (HTTP ${res.status})`);
  }

  const data = (await res.json()) as {
    files?: Array<{ id: string; name: string; modifiedTime?: string; size?: string }>;
  };

  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name.replace('.synapse.json', ''),
    modifiedTime: f.modifiedTime ? f.modifiedTime.slice(0, 16).replace('T', ' ') : '',
    sizeBytes: Number(f.size || 0),
  }));
}

/**
 * 从 Google Drive 下载并还原项目
 */
export async function downloadProjectFromGoogleDrive(
  fileId: string,
  accessToken: string
): Promise<Project> {
  const res = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`下载 Google Drive 项目失败 (HTTP ${res.status})`);
  }

  const rawJson = (await res.json()) as Project;
  return normalizeProjectData(rawJson);
}

/**
 * 全量同步所有项目至 Google Drive
 */
export async function syncAllProjectsToGoogleDrive(
  projects: Project[],
  accessToken: string,
  folderName: string = 'Synapse_Projects'
): Promise<{ total: number; succeeded: number }> {
  let succeeded = 0;
  for (const project of projects) {
    try {
      await syncProjectToGoogleDrive(project, accessToken, folderName);
      succeeded++;
    } catch (err) {
      console.error(`Failed to sync project ${project.name}:`, err);
    }
  }
  return { total: projects.length, succeeded };
}
