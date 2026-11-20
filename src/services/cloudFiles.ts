import { getDriveAccessToken } from '../lib/firebase';
import type {
  BrainstormAttachmentPayload,
  CloudFileItem,
  SaveDestinationConfig,
} from '../types/workspace';
import {
  classifyAttachmentKind,
  formatFriendlyErrorMessage,
} from '../utils/workflow';

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_SLIDE_MIME = 'application/vnd.google-apps.presentation';
const CLOUD_REQUEST_TIMEOUT_MS = 45000;

async function fetchCloudWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = CLOUD_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timerId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('云端文件请求超时，请检查网络连接或稍后重试。');
    }
    throw new Error(formatFriendlyErrorMessage(err, '云端文件连接失败，请检查网络状态。'));
  } finally {
    window.clearTimeout(timerId);
  }
}

async function parseJsonResponseSafe<T>(res: Response, fallbackErr: string): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`${fallbackErr}（HTTP ${res.status}）`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${fallbackErr}（返回数据解析失败）`);
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function isSupportedGoogleWorkspaceMime(mimeType: string): boolean {
  return (
    mimeType === GOOGLE_DOC_MIME ||
    mimeType === GOOGLE_SHEET_MIME ||
    mimeType === GOOGLE_SLIDE_MIME
  );
}

function isSupportedCloudFile(name: string, mimeType: string): boolean {
  if (isSupportedGoogleWorkspaceMime(mimeType)) return true;
  return classifyAttachmentKind(name, mimeType) !== null;
}

export async function listGoogleDriveCloudFiles(searchQuery?: string): Promise<CloudFileItem[]> {
  const accessToken = getDriveAccessToken();
  if (!accessToken) {
    throw new Error('请先通过 Google 账号登录并授予云盘只读权限后再读取云端文件。');
  }

  try {
    const baseFilter =
      "trashed = false and mimeType != 'application/vnd.google-apps.folder'";
    const escapedSearch = (searchQuery || '').trim().replace(/'/g, "\\'");
    const q = escapedSearch
      ? `${baseFilter} and name contains '${escapedSearch}'`
      : baseFilter;

    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('pageSize', '30');
    url.searchParams.set('orderBy', 'modifiedTime desc');
    url.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime)');
    url.searchParams.set('q', q);

    const res = await fetchCloudWithTimeout(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('Google Drive 授权已过期或权限不足，请重新点击「授权并连接 Google Drive」。');
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`读取 Google Drive 文件列表失败（HTTP ${res.status}）：${errText.slice(0, 140)}`);
    }

    const data = await parseJsonResponseSafe<{
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        modifiedTime?: string;
      }>;
    }>(res, '读取 Google Drive 文件列表失败');

    const items: CloudFileItem[] = [];
    for (const file of data.files ?? []) {
      if (!isSupportedCloudFile(file.name, file.mimeType)) continue;
      const kind = isSupportedGoogleWorkspaceMime(file.mimeType)
        ? 'text'
        : classifyAttachmentKind(file.name, file.mimeType) || 'text';
      items.push({
        id: `gdrive_${file.id}`,
        source: 'google-drive',
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: Number(file.size || 0),
        modifiedAt: file.modifiedTime ? file.modifiedTime.slice(0, 16).replace('T', ' ') : undefined,
        kind,
        downloadRef: file.id,
      });
    }
    return items;
  } catch (err) {
    throw new Error(formatFriendlyErrorMessage(err, '读取 Google Drive 文件列表失败，请稍后重试。'));
  }
}

export async function fetchGoogleDriveFileAsAttachment(
  file: CloudFileItem
): Promise<BrainstormAttachmentPayload> {
  const accessToken = getDriveAccessToken();
  if (!accessToken) {
    throw new Error('请先授权连接你的 Google Drive 账号。');
  }

  const MAX_BYTES = 20 * 1024 * 1024;
  if (file.sizeBytes > MAX_BYTES) {
    throw new Error(`云端文件「${file.name}」超过 20MB 限制，无法直接读取。`);
  }

  try {
    if (isSupportedGoogleWorkspaceMime(file.mimeType)) {
      const exportMime =
        file.mimeType === GOOGLE_SHEET_MIME ? 'text/csv' : 'text/plain';
      const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        file.downloadRef
      )}/export?mimeType=${encodeURIComponent(exportMime)}`;

      const res = await fetchCloudWithTimeout(exportUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`导出 Google 文档「${file.name}」失败（HTTP ${res.status}）。`);
      }
      const textContent = (await res.text()).slice(0, 30000);
      return {
        id: `att_gdrive_${file.downloadRef}_${Date.now()}`,
        name: file.name,
        mimeType: exportMime,
        kind: 'text',
        sizeBytes: textContent.length,
        textContent,
      };
    }

    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      file.downloadRef
    )}?alt=media`;
    const res = await fetchCloudWithTimeout(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`读取 Google Drive 文件「${file.name}」失败（HTTP ${res.status}）。`);
    }

    if (file.kind === 'text') {
      const textContent = (await res.text()).slice(0, 30000);
      return {
        id: `att_gdrive_${file.downloadRef}_${Date.now()}`,
        name: file.name,
        mimeType: file.mimeType || 'text/plain',
        kind: 'text',
        sizeBytes: file.sizeBytes || textContent.length,
        textContent,
      };
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(`云端媒体文件「${file.name}」超过 20MB 限制。`);
    }

    return {
      id: `att_gdrive_${file.downloadRef}_${Date.now()}`,
      name: file.name,
      mimeType:
        file.mimeType || (file.kind === 'image' ? 'image/png' : 'video/mp4'),
      kind: file.kind,
      sizeBytes: buf.byteLength,
      base64Data: arrayBufferToBase64(buf),
    };
  } catch (err) {
    throw new Error(formatFriendlyErrorMessage(err, `读取云端文件「${file.name}」失败，请重试。`));
  }
}

export async function listWebdavCloudFiles(
  saveConfig: SaveDestinationConfig
): Promise<CloudFileItem[]> {
  if (!saveConfig.webdavUrl.trim()) {
    throw new Error('请先在设置中填写你的 WebDAV 网盘地址与凭据。');
  }

  try {
    const res = await fetchCloudWithTimeout('/api/storage/webdav-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webdavUrl: saveConfig.webdavUrl,
        webdavPath: saveConfig.webdavPath,
        username: saveConfig.webdavUsername,
        password: saveConfig.webdavPassword,
      }),
    });

    const data = await parseJsonResponseSafe<{ files?: CloudFileItem[]; error?: string }>(
      res,
      '读取 WebDAV 目录失败'
    );
    if (!res.ok) {
      throw new Error(data.error || `读取 WebDAV 目录失败（HTTP ${res.status}）`);
    }
    return data.files ?? [];
  } catch (err) {
    throw new Error(formatFriendlyErrorMessage(err, '读取 WebDAV 目录失败，请检查网络或网盘配置。'));
  }
}

export async function fetchWebdavFileAsAttachment(
  saveConfig: SaveDestinationConfig,
  file: CloudFileItem
): Promise<BrainstormAttachmentPayload> {
  try {
    const res = await fetchCloudWithTimeout('/api/storage/webdav-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webdavUrl: saveConfig.webdavUrl,
        username: saveConfig.webdavUsername,
        password: saveConfig.webdavPassword,
        fileHref: file.downloadRef,
        fileName: file.name,
        mimeType: file.mimeType,
      }),
    });

    const data = await parseJsonResponseSafe<{
      attachment?: BrainstormAttachmentPayload;
      error?: string;
    }>(res, `读取 WebDAV 文件「${file.name}」失败`);

    if (!res.ok || !data.attachment) {
      throw new Error(data.error || `读取 WebDAV 文件失败（HTTP ${res.status}）`);
    }
    return data.attachment;
  } catch (err) {
    throw new Error(
      formatFriendlyErrorMessage(err, `读取 WebDAV 文件「${file.name}」失败，请稍后重试。`)
    );
  }
}
