import type { Project } from '../types/workspace';
import {
  buildBriefMarkdown,
  buildScriptText,
  buildStoryboardCsv,
  buildStoryboardRows,
} from '../utils/workflow';
import * as XLSX from 'xlsx';

export interface LocalFolderSaveResult {
  ok: boolean;
  message: string;
  folderPath: string;
  filesWritten: string[];
  timestamp: string;
}

export interface LocalFolderProjectSummary {
  fileName: string;
  projectId: string;
  projectName: string;
  updatedAt: string;
  fileSize: number;
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      selectDirectory: (defaultPath?: string) => Promise<string | null>;
      saveProjectFiles: (
        folderPath: string,
        payload: {
          project: Project;
          jsonString: string;
          briefMd: string;
          scriptTxt: string;
          storyboardCsv: string;
          storyboardXlsxBase64: string;
        }
      ) => Promise<{ ok: boolean; filesWritten: string[]; error?: string }>;
      listProjectFiles: (folderPath: string) => Promise<LocalFolderProjectSummary[]>;
      loadProjectFile: (filePath: string) => Promise<Project | null>;
      openPath: (dirPath: string) => Promise<boolean>;
      getDefaultWorkspacePath: () => Promise<string>;
    };
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || '创作项目';
}

function generateXlsxBase64(project: Project): string {
  try {
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
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '分镜提示词表');
    const xlsxBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' }) as string;
    return xlsxBuffer;
  } catch {
    return '';
  }
}

/**
 * 自动保存项目到本地文件夹（优先使用 Electron 原生通道，其次使用后端本地文件系统 API）
 */
export async function saveProjectToLocalFolder(
  folderPath: string,
  project: Project
): Promise<LocalFolderSaveResult> {
  const safeTitle = sanitizeName(project.name);
  const jsonString = JSON.stringify(project, null, 2);
  const briefMd = buildBriefMarkdown(project);
  const scriptTxt = buildScriptText(project);
  const storyboardCsv = buildStoryboardCsv(project);
  const storyboardXlsxBase64 = generateXlsxBase64(project);
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });

  // 1. Electron 原生通道
  if (window.electronAPI?.saveProjectFiles) {
    try {
      const res = await window.electronAPI.saveProjectFiles(folderPath, {
        project,
        jsonString,
        briefMd,
        scriptTxt,
        storyboardCsv,
        storyboardXlsxBase64,
      });
      if (res.ok) {
        return {
          ok: true,
          message: `已自动保存至本地目录 (${now})`,
          folderPath,
          filesWritten: res.filesWritten,
          timestamp: now,
        };
      }
      throw new Error(res.error || 'Electron 本地保存失败');
    } catch (err) {
      console.warn('Electron save error, trying server fallback:', err);
    }
  }

  // 2. 本地 Node.js 后端接口通道
  try {
    const res = await fetch('/api/storage/local-folder/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath,
        project,
        safeTitle,
        jsonString,
        briefMd,
        scriptTxt,
        storyboardCsv,
        storyboardXlsxBase64,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        ok: boolean;
        filesWritten: string[];
        error?: string;
      };
      if (data.ok) {
        return {
          ok: true,
          message: `已自动保存至本地「${folderPath}」 (${now})`,
          folderPath,
          filesWritten: data.filesWritten,
          timestamp: now,
        };
      }
      throw new Error(data.error || '服务器本地写入失败');
    }
  } catch (err) {
    console.warn('Server local-folder save failed:', err);
  }

  return {
    ok: false,
    message: '未能写入本地文件夹，请检查目录权限或路径有效性',
    folderPath,
    filesWritten: [],
    timestamp: now,
  };
}

/**
 * 弹出原生系统目录选择对话框
 */
export async function pickSystemDirectory(currentPath?: string): Promise<string | null> {
  // 1. Electron 桌面端
  if (window.electronAPI?.selectDirectory) {
    return await window.electronAPI.selectDirectory(currentPath);
  }

  // 2. 本地服务端探测
  try {
    const res = await fetch('/api/storage/local-folder/dialog-select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPath }),
    });
    if (res.ok) {
      const data = (await res.json()) as { selectedPath?: string };
      if (data.selectedPath) return data.selectedPath;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * 在文件资源管理器中打开目标文件夹
 */
export async function revealLocalFolder(folderPath: string): Promise<boolean> {
  if (window.electronAPI?.openPath) {
    return await window.electronAPI.openPath(folderPath);
  }

  try {
    const res = await fetch('/api/storage/local-folder/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 获取本地文件夹中的项目备份列表
 */
export async function listLocalFolderProjects(
  folderPath: string
): Promise<LocalFolderProjectSummary[]> {
  if (window.electronAPI?.listProjectFiles) {
    return await window.electronAPI.listProjectFiles(folderPath);
  }

  try {
    const res = await fetch(
      `/api/storage/local-folder/list?path=${encodeURIComponent(folderPath)}`
    );
    if (res.ok) {
      const data = (await res.json()) as { projects: LocalFolderProjectSummary[] };
      return data.projects || [];
    }
  } catch {
    // fallback
  }

  return [];
}
