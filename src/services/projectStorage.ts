import { SEED_PROJECTS } from '../data/seedProjects';
import type {
  ApiProviderConfig,
  ApiUsageStats,
  ChatbotMessage,
  Project,
  SaveDestinationConfig,
} from '../types/workspace';
import {
  normalizeApiProviderConfig,
  normalizeProjectData,
} from '../utils/workflow';

const PROJECTS_STORAGE_KEY = 'creator_workbench_projects_v1';
const ACTIVE_PROJECT_STORAGE_KEY = 'creator_workbench_active_project_v1';
const CHAT_STORAGE_PREFIX = 'creator_workbench_chat_v1_';
const PROVIDER_CONFIG_KEY = 'creator_workbench_provider_config_v1';
const SAVE_DEST_CONFIG_KEY = 'creator_workbench_save_dest_v1';
const USAGE_STATS_KEY = 'creator_workbench_api_usage_v1';

export function getScopedStorageKey(baseKey: string, scopeUid?: string | null): string {
  const cleanUid = (scopeUid || '').trim();
  return cleanUid ? `${baseKey}_uid_${cleanUid}` : baseKey;
}

export const DEFAULT_API_PROVIDER_CONFIG: ApiProviderConfig = {
  providerType: 'builtin-gemini',
  presetId: 'gemini',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'gemini-3.8-flash',
  apiKey: '',
};

export const DEFAULT_SAVE_DESTINATION_CONFIG: SaveDestinationConfig = {
  mode: 'local-browser',
  folderLabel: '',
  localFolderPath: '',
  autoSaveLocalFolder: true,
  googleDriveFolder: 'Synapse_Projects',
  googleDriveAutoSync: false,
  googleDriveCustomToken: '',
  webdavUrl: '',
  webdavPath: '/creator-workbench',
  webdavUsername: '',
  webdavPassword: '',
};

export const DEFAULT_API_USAGE_STATS: ApiUsageStats = {
  totalRequests: 0,
  promptTokens: 0,
  candidatesTokens: 0,
  totalTokens: 0,
  warningThresholdTokens: 160000,
  budgetLimitTokens: 200000,
  lastUpdatedAt: '',
  recentRecords: [],
};

export function loadLocalProjects(scopeUid?: string | null): Project[] {
  const key = getScopedStorageKey(PROJECTS_STORAGE_KEY, scopeUid);
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // 彻底过滤已删除的历史示例文档《早安单词》与《怪盗妈咪》
        const cleaned = (parsed as Project[])
          .filter(
            (p) =>
              p &&
              p.name !== '早安单词' &&
              p.name !== '怪盗妈咪' &&
              p.id !== 'proj_morning_word' &&
              p.id !== 'proj_phantom_mom'
          )
          .map((p) => normalizeProjectData(p));

        if (cleaned.length !== parsed.length) {
          saveLocalProjects(cleaned, scopeUid);
        }
        return cleaned;
      }
    }
  } catch {
    // Malformed storage
  }
  return [];
}

export function saveLocalProjects(
  projects: Project[],
  scopeUid?: string | null
): boolean {
  const key = getScopedStorageKey(PROJECTS_STORAGE_KEY, scopeUid);
  try {
    window.localStorage.setItem(key, JSON.stringify(projects));
    return true;
  } catch {
    return false;
  }
}

export function loadActiveProjectId(scopeUid?: string | null): string {
  const key = getScopedStorageKey(ACTIVE_PROJECT_STORAGE_KEY, scopeUid);
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function saveActiveProjectId(
  projectId: string,
  scopeUid?: string | null
): void {
  const key = getScopedStorageKey(ACTIVE_PROJECT_STORAGE_KEY, scopeUid);
  try {
    if (projectId) {
      window.localStorage.setItem(key, projectId);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors
  }
}

export function createLocalProject(payload: {
  name: string;
  platform: string;
  topic: string;
}): Project {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: payload.name.trim(),
    platform: payload.platform.trim() || '抖音 / 小红书竖屏 9:16',
    topic: payload.topic.trim(),
    currentStage: 1,
    updatedAt: now,
    stage1: {
      searchGroundingEnabled: false,
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
      activeVisualLockId: 'ratio-9-16',
      customVisualLockSuffix: '',
      shots: [],
    },
  };
}

export function loadLocalChatMessages(
  projectId: string,
  scopeUid?: string | null
): ChatbotMessage[] {
  const key = getScopedStorageKey(`${CHAT_STORAGE_PREFIX}${projectId}`, scopeUid);
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as ChatbotMessage[];
      }
    }
  } catch {
    // Ignore malformed chat history
  }
  return [];
}

export function saveLocalChatMessages(
  projectId: string,
  messages: ChatbotMessage[],
  scopeUid?: string | null
): void {
  const key = getScopedStorageKey(`${CHAT_STORAGE_PREFIX}${projectId}`, scopeUid);
  try {
    window.localStorage.setItem(key, JSON.stringify(messages));
  } catch {
    // Ignore storage quota errors
  }
}

export function removeLocalChatMessages(
  projectId: string,
  scopeUid?: string | null
): void {
  const key = getScopedStorageKey(`${CHAT_STORAGE_PREFIX}${projectId}`, scopeUid);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
}

export function loadApiProviderConfig(): ApiProviderConfig {
  try {
    const raw = window.localStorage.getItem(PROVIDER_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ApiProviderConfig>;
      return normalizeApiProviderConfig(parsed);
    }
  } catch {
    // Fallback
  }
  return { ...DEFAULT_API_PROVIDER_CONFIG };
}

export function saveApiProviderConfig(config: ApiProviderConfig): void {
  const normalized = normalizeApiProviderConfig(config);
  try {
    window.localStorage.setItem(
      PROVIDER_CONFIG_KEY,
      JSON.stringify(normalized)
    );
  } catch {
    // Ignore quota errors
  }

  // Persist permanently to desktop config file if in Electron
  const electronWin = window as unknown as {
    electronAPI?: { saveAppConfig?: (cfg: unknown) => Promise<unknown> };
  };
  if (typeof electronWin?.electronAPI?.saveAppConfig === 'function') {
    electronWin.electronAPI.saveAppConfig(normalized).catch(() => {});
  }

  // Also sync to local backend config file
  fetch('/api/config/provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(normalized),
  }).catch(() => {});
}

export async function hydrateApiProviderConfigAsync(): Promise<ApiProviderConfig> {
  const current = loadApiProviderConfig();
  if (current.apiKey && current.apiKey.trim()) {
    return current;
  }
  // If local storage is empty, check desktop Electron config file
  const electronWin = window as unknown as {
    electronAPI?: { loadAppConfig?: () => Promise<Partial<ApiProviderConfig> | null> };
  };
  if (typeof electronWin?.electronAPI?.loadAppConfig === 'function') {
    try {
      const desktopCfg = await electronWin.electronAPI.loadAppConfig();
      if (desktopCfg && desktopCfg.apiKey) {
        const merged = normalizeApiProviderConfig(desktopCfg);
        saveApiProviderConfig(merged);
        return merged;
      }
    } catch {
      // Ignore
    }
  }
  // Or check server-side config file
  try {
    const res = await fetch('/api/config/provider');
    if (res.ok) {
      const serverCfg = await res.json();
      if (serverCfg && serverCfg.apiKey) {
        const merged = normalizeApiProviderConfig(serverCfg);
        saveApiProviderConfig(merged);
        return merged;
      }
    }
  } catch {
    // Ignore
  }
  return current;
}

export function loadSaveDestinationConfig(): SaveDestinationConfig {
  try {
    const raw = window.localStorage.getItem(SAVE_DEST_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SaveDestinationConfig>;
      return {
        ...DEFAULT_SAVE_DESTINATION_CONFIG,
        ...parsed,
      };
    }
  } catch {
    // Fallback
  }
  return { ...DEFAULT_SAVE_DESTINATION_CONFIG };
}

export function saveSaveDestinationConfig(config: SaveDestinationConfig): void {
  try {
    window.localStorage.setItem(SAVE_DEST_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Ignore quota errors
  }
}

export function loadApiUsageStats(): ApiUsageStats {
  try {
    const raw = window.localStorage.getItem(USAGE_STATS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ApiUsageStats>;
      return {
        ...DEFAULT_API_USAGE_STATS,
        ...parsed,
        recentRecords: Array.isArray(parsed.recentRecords) ? parsed.recentRecords : [],
      };
    }
  } catch {
    // Fallback
  }
  return { ...DEFAULT_API_USAGE_STATS };
}

export function saveApiUsageStats(stats: ApiUsageStats): void {
  try {
    window.localStorage.setItem(USAGE_STATS_KEY, JSON.stringify(stats));
  } catch {
    // Ignore quota errors
  }
}

export type UiToneId = 'charcoal' | 'obsidian' | 'midnight' | 'slate';
const THEME_TONE_KEY = 'synapse_ui_tone_v1';

export function loadUiTone(): UiToneId {
  try {
    const val = window.localStorage.getItem(THEME_TONE_KEY);
    if (val === 'obsidian' || val === 'midnight' || val === 'slate' || val === 'charcoal') {
      return val;
    }
  } catch {
    // ignore
  }
  return 'charcoal';
}

export function saveUiTone(tone: UiToneId): void {
  try {
    window.localStorage.setItem(THEME_TONE_KEY, tone);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-tone', tone);
    }
  } catch {
    // ignore
  }
}
