import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import type { Project, SaveDestinationConfig } from '../types/workspace';
import {
  buildBriefMarkdown,
  buildScriptText,
  buildStoryboardCsv,
  buildStoryboardRows,
} from './workflow';

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '创作项目';
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export interface DirectoryHandleLike {
  name: string;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob | ArrayBuffer | string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

export async function generateProjectBundleFiles(project: Project): Promise<{
  zipBlob: Blob;
  zipFilename: string;
  individualFiles: Array<{ name: string; content: string | ArrayBuffer }>;
}> {
  const safeName = sanitizeFilename(project.name);
  const zip = new JSZip();

  // 1. 策划纪要 (.md)
  const briefMd = buildBriefMarkdown(project);
  const mdName = `${safeName}_策划纪要.md`;
  zip.file(mdName, briefMd);

  // 2. 口播脚本 (.txt)
  const scriptTxt = buildScriptText(project);
  const txtName = `${safeName}_口播脚本.txt`;
  zip.file(txtName, scriptTxt);

  // 3. 分镜提示词表 (.csv)
  const storyboardCsv = buildStoryboardCsv(project);
  const csvName = `${safeName}_分镜提示词表.csv`;
  zip.file(csvName, storyboardCsv);

  // 4. 分镜提示词表 (.xlsx)
  const rows = buildStoryboardRows(project);
  const worksheet = XLSX.utils.json_to_sheet(
    rows.length > 0
      ? rows
      : [
          {
            镜号: 'Shot 01',
            景别: '待拆解',
            时长秒: 0,
            画面描述: '尚无分镜数据，请在阶段三生成导演分镜',
            对应台词: '',
            Midjourney英文提示词: '',
            运镜指令: '',
          },
        ]
  );
  worksheet['!cols'] = [
    { wch: 10 },
    { wch: 14 },
    { wch: 10 },
    { wch: 44 },
    { wch: 36 },
    { wch: 64 },
    { wch: 28 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '分镜提示词表');
  const xlsxBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const xlsxName = `${safeName}_分镜提示词表.xlsx`;
  zip.file(xlsxName, xlsxBuffer);

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const zipFilename = `${safeName}_完整创作包.zip`;

  return {
    zipBlob,
    zipFilename,
    individualFiles: [
      { name: mdName, content: briefMd },
      { name: txtName, content: scriptTxt },
      { name: csvName, content: storyboardCsv },
      { name: xlsxName, content: xlsxBuffer },
    ],
  };
}

export async function exportProjectPackageZip(
  project: Project,
  options?: {
    destination?: SaveDestinationConfig;
    directoryHandle?: DirectoryHandleLike | null;
  }
): Promise<{
  filename: string;
  fileCount: number;
  destinationSummary: string;
}> {
  const { zipBlob, zipFilename, individualFiles } = await generateProjectBundleFiles(project);
  const dest = options?.destination;

  // Option A: Write directly into user-chosen local folder if available
  if (dest?.mode === 'local-folder' && options?.directoryHandle) {
    const dir = options.directoryHandle;
    const zipHandle = await dir.getFileHandle(zipFilename, { create: true });
    const writable = await zipHandle.createWritable();
    try {
      await writable.write(zipBlob);
    } finally {
      await writable.close();
    }

    for (const file of individualFiles) {
      const fh = await dir.getFileHandle(file.name, { create: true });
      const w = await fh.createWritable();
      try {
        await w.write(file.content);
      } finally {
        await w.close();
      }
    }

    return {
      filename: zipFilename,
      fileCount: 4,
      destinationSummary: `本地文件夹「${dir.name}」`,
    };
  }

  // Option B: Upload to user's own WebDAV cloud drive (via stateless proxy)
  if (dest?.mode === 'webdav' && dest.webdavUrl.trim()) {
    const contentBase64 = await blobToBase64(zipBlob);
    const controller = new AbortController();
    const timerId = window.setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch('/api/storage/webdav', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          webdavUrl: dest.webdavUrl,
          webdavPath: dest.webdavPath,
          username: dest.webdavUsername,
          password: dest.webdavPassword,
          filename: zipFilename,
          contentBase64,
        }),
      });
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? ((await res.json().catch(() => ({}))) as { error?: string; targetUrl?: string })
        : {};
      if (!res.ok) {
        throw new Error(data.error || `WebDAV 网盘上传失败（HTTP ${res.status}）`);
      }
      return {
        filename: zipFilename,
        fileCount: 4,
        destinationSummary: `个人 WebDAV 网盘（${dest.webdavPath || '/'}）`,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('WebDAV 网盘上传超时，请检查网络连接或稍后重试。');
      }
      throw err;
    } finally {
      window.clearTimeout(timerId);
    }
  }

  // Option C: Standard browser local download (default or fallback)
  triggerBlobDownload(zipBlob, zipFilename);

  return {
    filename: zipFilename,
    fileCount: 4,
    destinationSummary:
      dest?.mode === 'cloud-sync'
        ? '浏览器下载 + 个人云端同步'
        : '电脑默认下载目录',
  };
}
