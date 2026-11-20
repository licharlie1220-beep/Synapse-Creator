import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Menu,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useI18n } from './i18n';
import { ApiErrorModal } from './components/ApiErrorModal';
import { GeminiChatbotDrawer } from './components/GeminiChatbotDrawer';
import { NewProjectModal } from './components/NewProjectModal';
import { ProjectSidebar } from './components/ProjectSidebar';
import { Stage1Brainstorm } from './components/Stage1Brainstorm';
import { Stage2Script } from './components/Stage2Script';
import { Stage3Production } from './components/Stage3Production';
import { TopStageNav } from './components/TopStageNav';
import {
  WorkbenchSettingsModal,
  type SettingsTabId,
} from './components/WorkbenchSettingsModal';
import { SEED_PROJECTS } from './data/seedProjects';
import {
  auth,
  clearDriveAccessToken,
  signInWithGoogleWorkspace,
} from './lib/firebase';
import {
  addChatMessageToFirestore,
  clearChatThreadInFirestore,
  deleteProjectFromFirestore,
  ensureUserProfileDocument,
  saveProjectToFirestore,
  subscribeChatMessages,
  subscribeUserProjects,
} from './services/firestoreSync';
import {
  API_USAGE_EVENT_NAME,
  MODEL_FALLBACK_EVENT_NAME,
  runGenerateScript,
  type ModelFallbackEventDetail,
  type UsageTrackedDetail,
} from './services/geminiClient';
import {
  createLocalProject,
  DEFAULT_API_USAGE_STATS,
  hydrateApiProviderConfigAsync,
  loadActiveProjectId,
  loadApiProviderConfig,
  loadApiUsageStats,
  loadLocalChatMessages,
  loadLocalProjects,
  loadSaveDestinationConfig,
  loadUiTone,
  removeLocalChatMessages,
  saveActiveProjectId,
  saveApiProviderConfig,
  saveApiUsageStats,
  saveLocalChatMessages,
  saveLocalProjects,
  saveSaveDestinationConfig,
  saveUiTone,
} from './services/projectStorage';
import {
  appendChatMessageToSql,
  deleteProjectFromSql,
  syncProjectToSql,
} from './services/sqlClient';
import type {
  ApiErrorDetail,
  ApiProviderConfig,
  ApiUsageStats,
  BranchTab,
  ChatbotMessage,
  Project,
  SaveDestinationConfig,
  StageId,
} from './types/workspace';
import {
  exportProjectPackageZip,
  type DirectoryHandleLike,
} from './utils/exportBundle';
import {
  saveProjectToLocalFolder,
  pickSystemDirectory,
} from './services/localFolderSync';
import {
  getEffectiveDriveToken,
  syncProjectToGoogleDrive,
} from './services/googleDriveSync';
import {
  accumulateApiUsage,
  createProjectBriefFromBranch,
  EXTERNAL_PROVIDER_PRESETS,
  formatFriendlyErrorMessage,
  getUsageAlertState,
  normalizeProjectData,
  parseApiErrorDetail,
} from './utils/workflow';

function resolveInitialProjectState(): {
  projects: Project[];
  activeId: string;
  initialChat: ChatbotMessage[];
} {
  const initialProjects = loadLocalProjects();
  const savedActiveId = loadActiveProjectId();
  const matchedActive =
    initialProjects.find((p) => p.id === savedActiveId)?.id ??
    initialProjects[0]?.id ??
    '';
  const initialChat = matchedActive ? loadLocalChatMessages(matchedActive) : [];
  return {
    projects: initialProjects,
    activeId: matchedActive,
    initialChat,
  };
}

export default function App() {
  const { t } = useI18n();
  const initialRef = useRef<ReturnType<typeof resolveInitialProjectState> | null>(null);
  if (!initialRef.current) {
    initialRef.current = resolveInitialProjectState();
  }

  const [projects, setProjects] = useState<Project[]>(initialRef.current.projects);
  const [activeProjectId, setActiveProjectId] = useState<string>(initialRef.current.activeId);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0];

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);

  const [isChatbotOpen, setIsChatbotOpen] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatbotMessage[]>(
    initialRef.current.initialChat
  );

  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [isCreatingProject, setIsCreatingProject] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);

  // User-configurable AI provider, Save Path destination, and API usage tracking
  const [providerConfig, setProviderConfig] = useState<ApiProviderConfig>(() =>
    loadApiProviderConfig()
  );
  const [saveConfig, setSaveConfig] = useState<SaveDestinationConfig>(() =>
    loadSaveDestinationConfig()
  );
  const [usageStats, setUsageStats] = useState<ApiUsageStats>(() => loadApiUsageStats());
  const [usageBannerDismissedLevel, setUsageBannerDismissedLevel] = useState<
    'warning' | 'exceeded' | null
  >(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('provider');
  const [hasLocalFolderHandle, setHasLocalFolderHandle] = useState<boolean>(false);
  const localDirHandleRef = useRef<DirectoryHandleLike | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [apiErrorDetail, setApiErrorDetail] = useState<ApiErrorDetail | null>(null);
  const [fallbackBannerNotice, setFallbackBannerNotice] = useState<string | null>(null);

  const syncTimersRef = useRef<Record<string, number>>({});
  const toastTimerRef = useRef<number | null>(null);
  const hasBootstrappedUserRef = useRef<string | null>(null);
  const scopeUid = currentUser?.emailVerified ? currentUser.uid : null;
  const scopeUidRef = useRef<string | null>(scopeUid);
  scopeUidRef.current = scopeUid;

  const [lastLocalSaveTime, setLastLocalSaveTime] = useState<string | null>(null);
  const [lastDriveSyncTime, setLastDriveSyncTime] = useState<string | null>(null);
  const localSaveDebounceTimerRef = useRef<number | null>(null);
  const driveSyncDebounceTimerRef = useRef<number | null>(null);

  const clearAllSyncTimers = useCallback(() => {
    for (const timerId of Object.values(syncTimersRef.current)) {
      window.clearTimeout(timerId);
    }
    syncTimersRef.current = {};
  }, []);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
      toastTimerRef.current = null;
    }, 3600);
  }, []);

  const handleReportError = useCallback((errOrMsg: unknown) => {
    const detail = parseApiErrorDetail(errOrMsg);
    if (detail) {
      setApiErrorDetail(detail);
      setErrorMessage(detail.message);
    } else {
      setErrorMessage(formatFriendlyErrorMessage(errOrMsg));
    }
  }, []);

  // Initialize UI tone on app mount
  useEffect(() => {
    saveUiTone(loadUiTone());
  }, []);

  // Hydrate API provider configuration on app launch & check if API key needs initial input
  useEffect(() => {
    hydrateApiProviderConfigAsync().then((loaded) => {
      setProviderConfig(loaded);
      if (!loaded.apiKey || !loaded.apiKey.trim()) {
        const hasPrompted = sessionStorage.getItem('synapse_key_prompted');
        if (!hasPrompted) {
          sessionStorage.setItem('synapse_key_prompted', 'true');
          setSettingsTab('provider');
          setIsSettingsOpen(true);
        }
      }
    });
  }, []);

  // Listen to automatic 503 fallback events
  useEffect(() => {
    const fallbackHandler = (e: Event) => {
      const detail = (e as CustomEvent<ModelFallbackEventDetail>).detail;
      if (detail?.notice) {
        setFallbackBannerNotice(detail.notice);
        showToast('已自动切换至备用模型继续生成');
      }
    };
    window.addEventListener(MODEL_FALLBACK_EVENT_NAME, fallbackHandler);
    return () => window.removeEventListener(MODEL_FALLBACK_EVENT_NAME, fallbackHandler);
  }, [showToast]);

  // Clean up all timers on unmount to avoid leaks
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      clearAllSyncTimers();
    };
  }, [clearAllSyncTimers]);

  // Listen to real API usage events from all AI actions
  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<UsageTrackedDetail>;
      if (!customEvent.detail?.usage) return;

      setUsageStats((prev) => {
        const prevAlert = getUsageAlertState(prev);
        const next = accumulateApiUsage(
          prev,
          customEvent.detail.action,
          customEvent.detail.usage
        );
        saveApiUsageStats(next);
        const nextAlert = getUsageAlertState(next);
        if (nextAlert.level !== prevAlert.level && nextAlert.level !== 'normal') {
          setUsageBannerDismissedLevel(null);
        }
        return next;
      });
    };

    window.addEventListener(API_USAGE_EVENT_NAME, handler);
    return () => window.removeEventListener(API_USAGE_EVENT_NAME, handler);
  }, []);

  // Always auto-save projects to UID-scoped (or guest) localStorage on every modification
  useEffect(() => {
    if (projects.length === 0) return;
    const saved = saveLocalProjects(projects, scopeUid);
    if (!saved) {
      setErrorMessage('浏览器本地存储空间不足，建议导出完整项目包后清理部分历史项目。');
    }
  }, [projects, scopeUid]);

  // Persist active project ID to localStorage so refresh restores the exact workspace
  useEffect(() => {
    if (!activeProjectId) return;
    saveActiveProjectId(activeProjectId, scopeUid);
  }, [activeProjectId, scopeUid]);

  // Real-time Auto-Save to Local Folder (debounced 1.5s)
  useEffect(() => {
    if (!activeProject) return;
    const isLocalMode =
      saveConfig.mode === 'local-folder' || saveConfig.autoSaveLocalFolder !== false;
    const targetFolder = saveConfig.localFolderPath || saveConfig.folderLabel;
    if (!isLocalMode || !targetFolder) return;

    if (localSaveDebounceTimerRef.current !== null) {
      window.clearTimeout(localSaveDebounceTimerRef.current);
    }

    localSaveDebounceTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await saveProjectToLocalFolder(targetFolder, activeProject);
        if (res.ok) {
          setLastLocalSaveTime(res.timestamp);
        }
      } catch (err) {
        console.warn('Auto save to local folder error:', err);
      }
    }, 1500);

    return () => {
      if (localSaveDebounceTimerRef.current !== null) {
        window.clearTimeout(localSaveDebounceTimerRef.current);
      }
    };
  }, [
    activeProject,
    saveConfig.mode,
    saveConfig.autoSaveLocalFolder,
    saveConfig.localFolderPath,
    saveConfig.folderLabel,
  ]);

  // Real-time Auto-Sync to Google Drive (debounced 2.5s)
  useEffect(() => {
    if (!activeProject) return;
    const isDriveMode =
      saveConfig.mode === 'google-drive' || Boolean(saveConfig.googleDriveAutoSync);
    const driveToken = getEffectiveDriveToken(saveConfig.googleDriveCustomToken);
    if (!isDriveMode || !driveToken) return;

    if (driveSyncDebounceTimerRef.current !== null) {
      window.clearTimeout(driveSyncDebounceTimerRef.current);
    }

    driveSyncDebounceTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await syncProjectToGoogleDrive(
          activeProject,
          driveToken,
          saveConfig.googleDriveFolder || 'Synapse_Projects'
        );
        if (res.ok) {
          setLastDriveSyncTime(res.timestamp);
        }
      } catch (err) {
        console.warn('Auto sync to Google Drive error:', err);
      }
    }, 2500);

    return () => {
      if (driveSyncDebounceTimerRef.current !== null) {
        window.clearTimeout(driveSyncDebounceTimerRef.current);
      }
    };
  }, [
    activeProject,
    saveConfig.mode,
    saveConfig.googleDriveAutoSync,
    saveConfig.googleDriveFolder,
    saveConfig.googleDriveCustomToken,
  ]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
      if (!user) {
        hasBootstrappedUserRef.current = null;
        clearDriveAccessToken();
        clearAllSyncTimers();
      }
    });
    return () => unsubscribe();
  }, [clearAllSyncTimers]);

  // Subscribe to Firestore user profile + projects when signed in, keeping UID-scoped local cache synced
  useEffect(() => {
    if (!isAuthReady || !currentUser || !currentUser.emailVerified) {
      return;
    }

    const uid = currentUser.uid;
    const cachedUserProjects = loadLocalProjects(uid);
    if (cachedUserProjects.length > 0) {
      const savedActiveId = loadActiveProjectId(uid);
      setProjects(cachedUserProjects);
      setActiveProjectId(
        cachedUserProjects.some((p) => p.id === savedActiveId)
          ? savedActiveId
          : cachedUserProjects[0].id
      );
    }

    let unsubscribeProjects: (() => void) | undefined;
    let cancelled = false;

    const initCloudSync = async () => {
      try {
        await ensureUserProfileDocument(currentUser);
        if (cancelled) return;

        unsubscribeProjects = subscribeUserProjects(
          uid,
          async (cloudProjects) => {
            if (cancelled) return;
            try {
              if (cloudProjects.length === 0 && hasBootstrappedUserRef.current !== uid) {
                hasBootstrappedUserRef.current = uid;
                const localSeed = loadLocalProjects();
                const initialSet =
                  localSeed.length > 0
                    ? localSeed
                    : structuredClone(SEED_PROJECTS).map((p) => normalizeProjectData(p));
                setProjects(initialSet);
                setActiveProjectId((prevId) =>
                  initialSet.some((p) => p.id === prevId) ? prevId : initialSet[0]?.id ?? ''
                );
                saveLocalProjects(initialSet, uid);
                for (const proj of initialSet) {
                  await saveProjectToFirestore(uid, proj);
                  void syncProjectToSql(proj);
                }
                return;
              }

              if (cloudProjects.length > 0) {
                const normalized = cloudProjects.map((p) => normalizeProjectData(p));
                setProjects(normalized);
                saveLocalProjects(normalized, uid);
                const preferredId = loadActiveProjectId(uid);
                setActiveProjectId((prevId) => {
                  if (normalized.some((p) => p.id === prevId)) return prevId;
                  if (preferredId && normalized.some((p) => p.id === preferredId)) {
                    return preferredId;
                  }
                  return normalized[0].id;
                });
              }
            } catch (err) {
              if (!cancelled) {
                setErrorMessage(
                  formatFriendlyErrorMessage(err, '云端项目同步失败，当前改动已保存在本地。')
                );
              }
            }
          },
          (err) => {
            if (!cancelled) {
              setErrorMessage(
                formatFriendlyErrorMessage(err, '云端项目订阅中断，正在使用本地缓存数据。')
              );
            }
          }
        );
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            formatFriendlyErrorMessage(err, '账号数据同步初始化失败，已保留本地数据。')
          );
        }
      }
    };

    void initCloudSync();

    return () => {
      cancelled = true;
      if (unsubscribeProjects) unsubscribeProjects();
    };
  }, [isAuthReady, currentUser]);

  const usageAlert = getUsageAlertState(usageStats);
  const showUsageAlertBanner =
    usageAlert.level !== 'normal' &&
    usageBannerDismissedLevel !== usageAlert.level &&
    Boolean(usageAlert.message);

  // Subscribe to multi-turn chatbot messages for active project
  useEffect(() => {
    if (!activeProject?.id) {
      setChatMessages([]);
      return;
    }

    const activeId = activeProject.id;
    const localCached = loadLocalChatMessages(activeId, scopeUid);
    setChatMessages(localCached);

    if (isAuthReady && currentUser && currentUser.emailVerified) {
      const uid = currentUser.uid;
      const unsubscribeChat = subscribeChatMessages(
        uid,
        activeId,
        (messages) => {
          setChatMessages(messages);
          saveLocalChatMessages(activeId, messages, uid);
        },
        (err) => {
          setErrorMessage(
            formatFriendlyErrorMessage(err, 'AI 顾问对话云端同步失败，已保留本地记录。')
          );
        }
      );
      return () => unsubscribeChat();
    }
  }, [activeProject?.id, isAuthReady, currentUser, scopeUid]);

  const scheduleCloudProjectSave = useCallback(
    (projectToSave: Project) => {
      if (!currentUser || !currentUser.emailVerified) return;
      const uid = currentUser.uid;
      const existingTimer = syncTimersRef.current[projectToSave.id];
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }
      syncTimersRef.current[projectToSave.id] = window.setTimeout(async () => {
        delete syncTimersRef.current[projectToSave.id];
        try {
          await saveProjectToFirestore(uid, projectToSave);
          void syncProjectToSql(projectToSave);
        } catch (err) {
          setErrorMessage(
            formatFriendlyErrorMessage(
              err,
              '云端同步暂时受阻，当前修改已自动保存在本地浏览器缓存中。'
            )
          );
        }
      }, 350);
    },
    [currentUser]
  );

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    try {
      await signInWithGoogleWorkspace();
      showToast('已登录你的个人云端账号并开启隔离授权同步');
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      if (!raw.includes('popup-closed-by-user') && !raw.includes('cancelled-popup-request')) {
        setErrorMessage(formatFriendlyErrorMessage(err, '个人云端登录失败，请稍后重试。'));
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      clearAllSyncTimers();
      clearDriveAccessToken();
      await signOut(auth);
      const guestProjects = loadLocalProjects(null);
      const guestActiveId = loadActiveProjectId(null);
      const resolvedId =
        guestProjects.find((p) => p.id === guestActiveId)?.id ?? guestProjects[0]?.id ?? '';
      setProjects(guestProjects);
      setActiveProjectId(resolvedId);
      setChatMessages(resolvedId ? loadLocalChatMessages(resolvedId, null) : []);
      showToast('已退出个人账号并清空云端授权令牌，已切回本地游客草稿');
    } catch (err) {
      setErrorMessage(formatFriendlyErrorMessage(err, '退出登录失败，请重试。'));
    }
  };

  const handleOpenSettings = (tab: SettingsTabId = 'provider') => {
    setSettingsTab(tab);
    setIsSettingsOpen(true);
    setMobileSidebarOpen(false);
  };

  const handleSaveProviderConfig = (next: ApiProviderConfig) => {
    setProviderConfig(next);
    saveApiProviderConfig(next);
    const preset = EXTERNAL_PROVIDER_PRESETS.find((p) => p.id === next.providerType);
    const label =
      next.providerType === 'builtin-gemini'
        ? '内置 Gemini'
        : preset
        ? `${preset.shortLabel} (${next.model || preset.defaultModel})`
        : `自定义接口 (${next.model || 'OpenAI 兼容'})`;
    showToast(`已切换模型接口：${label}（密钥仅存当前浏览器本地）`);
  };

  const handleSaveDestinationConfig = (next: SaveDestinationConfig) => {
    setSaveConfig(next);
    saveSaveDestinationConfig(next);
    showToast('保存路径配置已更新');
  };

  const handlePickLocalFolder = async () => {
    // 1. Prioritize native system folder picker (Electron IPC or local backend)
    try {
      const selected = await pickSystemDirectory(
        saveConfig.localFolderPath || saveConfig.folderLabel
      );
      if (selected) {
        const folderName = selected.split(/[\\/]/).pop() || selected;
        const next: SaveDestinationConfig = {
          ...saveConfig,
          mode: 'local-folder',
          localFolderPath: selected,
          folderLabel: folderName,
          autoSaveLocalFolder: true,
        };
        setSaveConfig(next);
        saveSaveDestinationConfig(next);
        setHasLocalFolderHandle(true);
        showToast(`已绑定本地文件夹「${folderName}」并开启自动保存`);
        if (activeProject) {
          void saveProjectToLocalFolder(selected, activeProject).then((res) => {
            if (res.ok) setLastLocalSaveTime(res.timestamp);
          });
        }
        return;
      }
    } catch {
      // Continue to browser fallback
    }

    // 2. Browser showDirectoryPicker
    const picker = (window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: 'readwrite' | 'read' }) => Promise<DirectoryHandleLike>;
    }).showDirectoryPicker;

    if (picker) {
      try {
        const dirHandle = await picker({ mode: 'readwrite' });
        localDirHandleRef.current = dirHandle;
        setHasLocalFolderHandle(true);
        const next: SaveDestinationConfig = {
          ...saveConfig,
          mode: 'local-folder',
          folderLabel: dirHandle.name,
          localFolderPath: dirHandle.name,
          autoSaveLocalFolder: true,
        };
        setSaveConfig(next);
        saveSaveDestinationConfig(next);
        showToast(`已绑定电脑本地文件夹「${dirHandle.name}」`);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('AbortError')) return;
      }
    }

    // 3. Fallback prompt
    const manualPath = window.prompt(
      '请输入本地保存目录的绝对路径（如 D:\\Synapse_Workspace）：',
      saveConfig.localFolderPath || 'D:\\Synapse_Workspace'
    );
    if (manualPath && manualPath.trim()) {
      const p = manualPath.trim();
      const folderName = p.split(/[\\/]/).pop() || p;
      const next: SaveDestinationConfig = {
        ...saveConfig,
        mode: 'local-folder',
        localFolderPath: p,
        folderLabel: folderName,
        autoSaveLocalFolder: true,
      };
      setSaveConfig(next);
      saveSaveDestinationConfig(next);
      setHasLocalFolderHandle(true);
      showToast(`已设置本地保存目录「${folderName}」`);
      if (activeProject) {
        void saveProjectToLocalFolder(p, activeProject).then((res) => {
          if (res.ok) setLastLocalSaveTime(res.timestamp);
        });
      }
    }
  };

  const handleManualSaveLocalFolder = async () => {
    if (!activeProject) return;
    const targetFolder =
      saveConfig.localFolderPath || saveConfig.folderLabel || 'D:\\Synapse_Workspace';
    const res = await saveProjectToLocalFolder(targetFolder, activeProject);
    if (res.ok) {
      setLastLocalSaveTime(res.timestamp);
      showToast(`已成功保存「${activeProject.name}」至本地文件夹！`);
    } else {
      setErrorMessage(res.message);
    }
  };

  const handleManualSyncDrive = async () => {
    if (!activeProject) return;
    const driveToken = getEffectiveDriveToken(saveConfig.googleDriveCustomToken);
    if (!driveToken) {
      setErrorMessage('请先点击「授权并连接 Google Drive」或填写自定义 OAuth Token。');
      return;
    }
    try {
      const res = await syncProjectToGoogleDrive(
        activeProject,
        driveToken,
        saveConfig.googleDriveFolder || 'Synapse_Projects'
      );
      if (res.ok) {
        setLastDriveSyncTime(res.timestamp);
        showToast(`已成功同步「${activeProject.name}」至 Google Drive！`);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Google Drive 同步失败');
    }
  };

  const handleResetUsageStats = () => {
    const reset: ApiUsageStats = {
      ...DEFAULT_API_USAGE_STATS,
      warningThresholdTokens: usageStats.warningThresholdTokens,
      budgetLimitTokens: usageStats.budgetLimitTokens,
    };
    setUsageStats(reset);
    saveApiUsageStats(reset);
    setUsageBannerDismissedLevel(null);
  };

  const handleUpdateUsageLimits = (warningThresholdTokens: number, budgetLimitTokens: number) => {
    setUsageStats((prev) => {
      const next: ApiUsageStats = {
        ...prev,
        warningThresholdTokens,
        budgetLimitTokens,
      };
      saveApiUsageStats(next);
      return next;
    });
    setUsageBannerDismissedLevel(null);
  };

  const handleUpdateActiveProject = useCallback(
    (updater: (prev: Project) => Project) => {
      setProjects((prevList) => {
        const nextList = prevList.map((p) => {
          if (p.id !== activeProjectId) return p;
          const next = {
            ...updater(p),
            updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
          };
          scheduleCloudProjectSave(next);
          return next;
        });
        saveLocalProjects(nextList, scopeUidRef.current);
        return nextList;
      });
    },
    [activeProjectId, scheduleCloudProjectSave]
  );

  const handleCreateProject = async (payload: {
    name: string;
    platform: string;
    topic: string;
    aspectRatio?: '9:16' | '16:9';
    duration?: '10~20秒' | '1分钟左右' | '2分钟左右' | '3~5分钟';
  }) => {
    setIsCreatingProject(true);
    try {
      const created = createLocalProject(payload);
      if (payload.aspectRatio === '16:9') {
        created.stage3.activeVisualLockId = 'ratio-16-9';
      } else {
        created.stage3.activeVisualLockId = 'ratio-9-16';
      }
      setProjects((prev) => {
        const nextList = [created, ...prev];
        saveLocalProjects(nextList, scopeUidRef.current);
        return nextList;
      });
      setActiveProjectId(created.id);
      saveActiveProjectId(created.id, scopeUidRef.current);
      setIsNewModalOpen(false);
      setMobileSidebarOpen(false);
      showToast(`已创建新项目「${created.name}」`);
    } catch (err) {
      setErrorMessage(
        formatFriendlyErrorMessage(err, '创建项目失败，请重试。')
      );
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (projects.length <= 1) return;
    const pendingTimer = syncTimersRef.current[projectId];
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
      delete syncTimersRef.current[projectId];
    }

    const target = projects.find((p) => p.id === projectId);
    const remaining = projects.filter((p) => p.id !== projectId);
    setProjects(remaining);
    saveLocalProjects(remaining, scopeUidRef.current);
    removeLocalChatMessages(projectId, scopeUidRef.current);

    if (activeProjectId === projectId && remaining[0]) {
      setActiveProjectId(remaining[0].id);
      saveActiveProjectId(remaining[0].id, scopeUidRef.current);
    }

    try {
      if (currentUser && currentUser.emailVerified) {
        await deleteProjectFromFirestore(currentUser.uid, projectId);
        void deleteProjectFromSql(projectId);
      }
      if (target) {
        showToast(`已移除项目「${target.name}」`);
      }
    } catch (err) {
      setErrorMessage(
        formatFriendlyErrorMessage(err, '已在本地移除项目，但云端同步删除时出现异常。')
      );
    }
  };

  const handleSelectStage = (stage: StageId) => {
    handleUpdateActiveProject((prev) => ({
      ...prev,
      currentStage: stage,
    }));
  };

  const handleHandoffToStage2 = async (branch: BranchTab) => {
    const current = activeProject;
    if (!current) return;

    const brief = createProjectBriefFromBranch(
      current.topic,
      branch,
      current.stage1.riskAudit
    );

    const shouldAutoGenerate = !current.stage2.scriptContent.trim();

    handleUpdateActiveProject((prev) => ({
      ...prev,
      currentStage: 2,
      stage1: {
        ...prev.stage1,
        branches: prev.stage1.branches.map((b) => ({
          ...b,
          isLocked: b.id === branch.id,
        })),
      },
      stage2: {
        ...prev.stage2,
        brief,
      },
    }));

    showToast(`已锁定「${branch.title}」并同步《立项简报》至阶段二`);

    if (shouldAutoGenerate) {
      try {
        const res = await runGenerateScript({
          projectName: current.name,
          platform: current.platform,
          brief,
        });
        if (res && res.script) {
          handleUpdateActiveProject((prev) => ({
            ...prev,
            stage2: {
              ...prev.stage2,
              scriptContent: res.script,
              candidateScripts: res.candidates,
              activeCandidateId: res.candidates[0]?.id || 'v1',
            },
          }));
        }
      } catch (err) {
        setErrorMessage(
          formatFriendlyErrorMessage(err, '自动生成初稿脚本失败，你可在阶段二手动点击重新生成。')
        );
      }
    }
  };

  const handleAppendChatMessages = async (
    userMsg: ChatbotMessage,
    modelMsg: ChatbotMessage
  ) => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    const currentScope = scopeUidRef.current;

    setChatMessages((prev) => {
      const next = [...prev, userMsg, modelMsg];
      saveLocalChatMessages(projectId, next, currentScope);
      return next;
    });

    if (currentUser && currentUser.emailVerified) {
      try {
        await addChatMessageToFirestore(currentUser.uid, userMsg);
        await addChatMessageToFirestore(currentUser.uid, modelMsg);
        void appendChatMessageToSql(userMsg);
        void appendChatMessageToSql(modelMsg);
      } catch (err) {
        setErrorMessage(
          formatFriendlyErrorMessage(err, 'AI 顾问对话已保存在本地，但云端同步失败。')
        );
      }
    }
  };

  const handleClearChatThread = async () => {
    if (!activeProject) return;
    const projectId = activeProject.id;
    const currentIds = chatMessages.map((m) => m.id);
    setChatMessages([]);
    saveLocalChatMessages(projectId, [], scopeUidRef.current);

    try {
      if (currentUser && currentUser.emailVerified) {
        await clearChatThreadInFirestore(currentUser.uid, projectId, currentIds);
      }
      showToast('已清空当前项目的 AI 顾问对话记录');
    } catch (err) {
      setErrorMessage(
        formatFriendlyErrorMessage(err, '已清空本地对话记录，但云端清理失败。')
      );
    }
  };

  const handleExportPackage = async () => {
    if (!activeProject || isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportProjectPackageZip(activeProject, {
        destination: saveConfig,
        directoryHandle: localDirHandleRef.current,
      });
      showToast(
        `已保存 ${result.filename} 至「${result.destinationSummary}」（含 .md / .txt / .csv / .xlsx）`
      );
    } catch (err) {
      setErrorMessage(formatFriendlyErrorMessage(err, '导出项目包失败，请重试。'));
    } finally {
      setIsExporting(false);
    }
  };

  const sidebarUser = currentUser
    ? {
        uid: currentUser.uid,
        displayName: currentUser.displayName,
        email: currentUser.email,
        photoURL: currentUser.photoURL,
      }
    : null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#1D1F22] text-[#E6E1DA]">
      {/* Desktop Left Sidebar */}
      <div className="hidden md:flex h-full shrink-0">
        <ProjectSidebar
          projects={projects}
          activeProjectId={activeProject ? activeProject.id : ''}
          providerConfig={providerConfig}
          onSelectProject={(id) => setActiveProjectId(id)}
          onOpenNewProject={() => setIsNewModalOpen(true)}
          onDeleteProject={(id) => void handleDeleteProject(id)}
          onOpenSettings={handleOpenSettings}
        />
      </div>

      {/* Mobile Sidebar Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-[#101113]/75"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative z-10 flex h-full">
            <ProjectSidebar
              projects={projects}
              activeProjectId={activeProject ? activeProject.id : ''}
              providerConfig={providerConfig}
              onSelectProject={(id) => {
                setActiveProjectId(id);
                setMobileSidebarOpen(false);
              }}
              onOpenNewProject={() => {
                setIsNewModalOpen(true);
                setMobileSidebarOpen(false);
              }}
              onDeleteProject={(id) => void handleDeleteProject(id)}
              onOpenSettings={handleOpenSettings}
            />
          </div>
        </div>
      )}

      {/* Right Main Area: Top 3-Stage Nav + Active Stage Viewport OR Empty State */}
      <div className="flex flex-1 flex-col min-w-0 h-full overflow-hidden">
        {activeProject ? (
          <>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="打开项目列表侧边栏"
                className="flex h-14 w-12 items-center justify-center border-b border-r border-[#EAE5DE]/[0.08] bg-[#24272B] text-[#E6E1DA] md:hidden shrink-0"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex-1 min-w-0">
                <TopStageNav
                  project={activeProject}
                  onSelectStage={handleSelectStage}
                  onExportPackage={() => void handleExportPackage()}
                  onOpenChatbot={() => setIsChatbotOpen(true)}
                  isExporting={isExporting}
                  lastLocalSaveTime={lastLocalSaveTime}
                />
              </div>
            </div>

            {/* Model Fallback Top Notification Banner */}
            {fallbackBannerNotice && (
              <div
                role="status"
                className="flex items-center justify-between gap-3 border-b border-[#DFC5B0]/30 bg-[#B89882]/15 px-5 py-2 text-xs text-[#DFC5B0]"
              >
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 text-[#DFC5B0] animate-spin shrink-0" />
                  <span>{fallbackBannerNotice}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setFallbackBannerNotice(null)}
                  aria-label="关闭提示"
                  className="rounded p-1 hover:bg-[#B89882]/20"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Error Alert Banner */}
            {errorMessage && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 border-b border-[#C48B88]/35 bg-[#C48B88]/12 px-5 py-2.5 text-xs text-[#DFB2AF]"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-[#D19A97] shrink-0" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setErrorMessage(null)}
                  aria-label="关闭错误提示"
                  className="rounded p-1 hover:bg-[#C48B88]/20"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Active Stage Main Workspace */}
            <main className="flex-1 min-h-0 overflow-hidden">
              {activeProject.currentStage === 1 && (
                <Stage1Brainstorm
                  project={activeProject}
                  onUpdateProject={(updater) => handleUpdateActiveProject(updater)}
                  onHandoffToStage2={handleHandoffToStage2}
                  onError={handleReportError}
                />
              )}

              {activeProject.currentStage === 2 && (
                <Stage2Script
                  project={activeProject}
                  onUpdateProject={(updater) => handleUpdateActiveProject(updater)}
                  onProceedToStage3={() => handleSelectStage(3)}
                  onGoToStage1={() => handleSelectStage(1)}
                  onError={handleReportError}
                />
              )}

              {activeProject.currentStage === 3 && (
                <Stage3Production
                  project={activeProject}
                  onUpdateProject={(updater) => handleUpdateActiveProject(updater)}
                  onGoToStage2={() => handleSelectStage(2)}
                  onError={handleReportError}
                />
              )}
            </main>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center bg-[#1D1F22]">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#B89882]/15 text-[#DFC5B0] mb-4 border border-[#B89882]/25 shadow-lg">
              <Clapperboard className="h-8 w-8 text-[#DFC5B0]" />
            </div>
            <h2 className="text-lg font-semibold text-[#E6E1DA] mb-2">
              {t('empty.title')}
            </h2>
            <p className="max-w-md text-sm text-[#8B857C] mb-6 leading-relaxed">
              {t('empty.subtitle')}
            </p>
            <button
              type="button"
              onClick={() => setIsNewModalOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-[#B89882] px-6 py-2.5 text-sm font-semibold text-[#1B1715] hover:bg-[#C5A792] shadow-lg transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>{t('empty.button')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Multi-turn Gemini Chatbot Drawer */}
      {activeProject && (
        <GeminiChatbotDrawer
          isOpen={isChatbotOpen}
          project={activeProject}
          messages={chatMessages}
          onClose={() => setIsChatbotOpen(false)}
          onAppendMessages={handleAppendChatMessages}
          onClearThread={handleClearChatThread}
          onError={handleReportError}
        />
      )}

      {/* New Project Modal */}
      <NewProjectModal
        isOpen={isNewModalOpen}
        isSubmitting={isCreatingProject}
        onClose={() => setIsNewModalOpen(false)}
        onCreate={handleCreateProject}
      />

      {/* Workbench Settings: Custom AI Provider, Save Path & API Usage */}
      <WorkbenchSettingsModal
        isOpen={isSettingsOpen}
        initialTab={settingsTab}
        providerConfig={providerConfig}
        saveConfig={saveConfig}
        usageStats={usageStats}
        hasLocalFolderHandle={hasLocalFolderHandle}
        activeProject={activeProject}
        onClose={() => setIsSettingsOpen(false)}
        onSaveProviderConfig={handleSaveProviderConfig}
        onSaveDestinationConfig={handleSaveDestinationConfig}
        onPickLocalFolder={handlePickLocalFolder}
        onManualSaveLocalFolder={handleManualSaveLocalFolder}
        onResetUsageStats={handleResetUsageStats}
        onUpdateUsageLimits={handleUpdateUsageLimits}
      />

      {/* Dedicated Google API Error Modal Dialog */}
      <ApiErrorModal
        errorDetail={apiErrorDetail}
        onClose={() => setApiErrorDetail(null)}
        onOpenSettings={() => handleOpenSettings('provider')}
      />

      {/* Non-blocking Confirmation Toast */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border border-[#879B8D]/45 bg-[#24272B] px-4 py-2.5 text-xs font-medium text-[#C7D5CB] shadow-xl"
        >
          <CheckCircle2 className="h-4 w-4 text-[#A3B8A9] shrink-0" aria-hidden="true" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
