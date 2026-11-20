import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FolderCheck,
  FolderOpen,
  Globe,
  HardDrive,
  Languages,
  Palette,
  RotateCcw,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useI18n, SUPPORTED_LANGUAGES, type AppLanguage } from '../i18n';
import type {
  ApiProviderConfig,
  ApiUsageStats,
  Project,
  SaveDestinationConfig,
} from '../types/workspace';
import {
  BUILTIN_GEMINI_MODELS,
  EXTERNAL_PROVIDER_PRESETS,
  getUsageAlertState,
} from '../utils/workflow';
import {
  listLocalFolderProjects,
  revealLocalFolder,
  type LocalFolderProjectSummary,
} from '../services/localFolderSync';
import {
  loadUiTone,
  saveUiTone,
  type UiToneId,
} from '../services/projectStorage';

export type SettingsTabId = 'provider' | 'usage' | 'theme' | 'storage';

interface WorkbenchSettingsModalProps {
  isOpen: boolean;
  initialTab: SettingsTabId;
  providerConfig: ApiProviderConfig;
  saveConfig: SaveDestinationConfig;
  usageStats: ApiUsageStats;
  hasLocalFolderHandle: boolean;
  activeProject?: Project | null;
  onClose: () => void;
  onSaveProviderConfig: (next: ApiProviderConfig) => void;
  onSaveDestinationConfig: (next: SaveDestinationConfig) => void;
  onPickLocalFolder: () => Promise<void>;
  onManualSaveLocalFolder?: () => Promise<void>;
  onRestoreProject?: (project: Project) => void;
  onResetUsageStats: () => void;
  onUpdateUsageLimits: (warningThresholdTokens: number, budgetLimitTokens: number) => void;
}

export const WorkbenchSettingsModal: React.FC<WorkbenchSettingsModalProps> = ({
  isOpen,
  initialTab,
  providerConfig,
  saveConfig,
  usageStats,
  hasLocalFolderHandle,
  activeProject,
  onClose,
  onSaveProviderConfig,
  onSaveDestinationConfig,
  onPickLocalFolder,
  onManualSaveLocalFolder,
  onRestoreProject,
  onResetUsageStats,
  onUpdateUsageLimits,
}) => {
  const { language, setLanguage, t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [draftProvider, setDraftProvider] = useState<ApiProviderConfig>(providerConfig);
  const [draftSave, setDraftSave] = useState<SaveDestinationConfig>(saveConfig);
  const [currentTone, setCurrentTone] = useState<UiToneId>(() => loadUiTone());
  const [warnTokensInput, setWarnTokensInput] = useState<string>(
    String(usageStats.warningThresholdTokens)
  );
  const [budgetTokensInput, setBudgetTokensInput] = useState<string>(
    String(usageStats.budgetLimitTokens)
  );
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const [isSavingLocal, setIsSavingLocal] = useState(false);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setDraftProvider(providerConfig);
      setDraftSave(saveConfig);
      setCurrentTone(loadUiTone());
      setWarnTokensInput(String(usageStats.warningThresholdTokens));
      setBudgetTokensInput(String(usageStats.budgetLimitTokens));
      setSavedFeedback(null);
    }
  }, [
    isOpen,
    initialTab,
    providerConfig,
    saveConfig,
    usageStats.warningThresholdTokens,
    usageStats.budgetLimitTokens,
  ]);

  if (!isOpen) return null;

  const usageAlert = getUsageAlertState(usageStats);
  const activeExternalPreset = EXTERNAL_PROVIDER_PRESETS.find(
    (p) => p.id === draftProvider.providerType
  );
  const isExternalSelected = draftProvider.providerType !== 'builtin-gemini';

  const showSavedNotice = (msg: string) => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    setSavedFeedback(msg);
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      setSavedFeedback((prev) => (prev === msg ? null : prev));
    }, 2400);
  };

  const handleSelectExternalPreset = (presetId: 'deepseek' | 'openai' | 'claude') => {
    const preset = EXTERNAL_PROVIDER_PRESETS.find((p) => p.id === presetId)!;
    setDraftProvider((prev) => ({
      ...prev,
      providerType: preset.id,
      presetId: preset.id,
      baseUrl: preset.defaultBaseUrl,
      model: preset.defaultModel,
    }));
  };

  const handleSaveProvider = () => {
    const toSave = { ...draftProvider };
    const key = (toSave.apiKey || '').trim();
    if (toSave.providerType !== 'builtin-gemini' && (key.startsWith('AQ.') || key.startsWith('AIzaSy'))) {
      toSave.providerType = 'builtin-gemini';
      toSave.presetId = 'gemini';
      setDraftProvider(toSave);
      onSaveProviderConfig(toSave);
      showSavedNotice('检测到 Google Gemini Key，已自动切回「内置 Gemini」并保存生效');
      return;
    }
    onSaveProviderConfig(toSave);
    showSavedNotice('模型接口配置已保存（仅存放在你的本地设备）');
  };

  const handleSaveDestination = () => {
    onSaveDestinationConfig(draftSave);
    showSavedNotice('保存路径配置已更新');
  };

  const handleSaveQuota = () => {
    const budget = Math.max(5000, parseInt(budgetTokensInput, 10) || 200000);
    const warn = Math.max(
      1000,
      Math.min(budget, parseInt(warnTokensInput, 10) || Math.round(budget * 0.8))
    );
    onUpdateUsageLimits(warn, budget);
    setWarnTokensInput(String(warn));
    setBudgetTokensInput(String(budget));
    showSavedNotice('用量预算与提醒阈值已更新');
  };

  const THEME_TONE_PRESETS: Array<{
    id: UiToneId;
    title: string;
    subtitle: string;
    desc: string;
    previewColors: {
      bg: string;
      surface: string;
      elevated: string;
      accent: string;
    };
  }> = [
    {
      id: 'charcoal',
      title: t('settings.themeWarmCharcoal'),
      subtitle: 'Warm Charcoal',
      desc: t('settings.themeWarmCharcoalDesc'),
      previewColors: {
        bg: '#1D1F22',
        surface: '#24272B',
        elevated: '#2B2E33',
        accent: '#B89882',
      },
    },
    {
      id: 'obsidian',
      title: t('settings.themePureBlack'),
      subtitle: 'Obsidian Black',
      desc: t('settings.themePureBlackDesc'),
      previewColors: {
        bg: '#0E0F12',
        surface: '#16181C',
        elevated: '#202329',
        accent: '#DFC5B0',
      },
    },
    {
      id: 'midnight',
      title: t('settings.themeMidnight'),
      subtitle: 'Midnight Navy',
      desc: t('settings.themeMidnightDesc'),
      previewColors: {
        bg: '#121824',
        surface: '#182030',
        elevated: '#222C42',
        accent: '#8AA6C1',
      },
    },
    {
      id: 'slate',
      title: t('settings.themeTitanium'),
      subtitle: 'Titanium Slate',
      desc: t('settings.themeTitaniumDesc'),
      previewColors: {
        bg: '#161A1D',
        surface: '#1E2327',
        elevated: '#282F34',
        accent: '#A3BFB0',
      },
    },
  ];

  const saveModes: Array<{
    mode: 'local-folder' | 'local-browser';
    title: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      mode: 'local-folder',
      title: '本地文件夹自动保存（桌面独立持久化）',
      desc: '指定电脑上的本地文件夹，编辑项目时自动以 .synapse.json、.md、.txt 与 .xlsx 实时写入，不惧缓存丢失。',
      icon: FolderOpen,
    },
    {
      mode: 'local-browser',
      title: '电脑默认下载 + 浏览器本地持久化',
      desc: '所有项目草稿与密钥配置保存在本地存储中，导出时自动下载完整 ZIP 包。',
      icon: HardDrive,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#101113]/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="模型接口、保存路径与用量设置"
    >
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-[#EAE5DE]/[0.12] bg-[#24272B] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#EAE5DE]/[0.08] px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold text-[#E6E1DA]">
              {t('settings.headerTitle')}
            </h2>
            <p className="mt-0.5 text-xs text-[#8B857C]">
              {t('settings.headerDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-lg p-1.5 text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.06] hover:text-[#E6E1DA]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="配置分类标签"
          className="flex items-center gap-2 border-b border-[#EAE5DE]/[0.08] bg-[#1D1F22] px-5 py-2.5 overflow-x-auto"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'provider'}
            onClick={() => setActiveTab('provider')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'provider'
                ? 'border-[#B89882]/45 bg-[#B89882]/14 text-[#DFC5B0]'
                : 'border-transparent text-[#B7B1A8] hover:text-[#E6E1DA]'
            }`}
          >
            <Cpu className="h-3.5 w-3.5 shrink-0" />
            <span>{t('settings.tabProvider')}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'usage'}
            onClick={() => setActiveTab('usage')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'usage'
                ? 'border-[#B89882]/45 bg-[#B89882]/14 text-[#DFC5B0]'
                : 'border-transparent text-[#B7B1A8] hover:text-[#E6E1DA]'
            }`}
          >
            <Activity className="h-3.5 w-3.5 shrink-0" />
            <span>{t('settings.tabUsage')}</span>
            {usageAlert.level !== 'normal' && (
              <span
                className={`ml-1 font-mono text-[11px] ${
                  usageAlert.level === 'exceeded' ? 'text-[#D19A97]' : 'text-[#DFCEA4]'
                }`}
              >
                {usageAlert.percentage}%
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'theme'}
            onClick={() => setActiveTab('theme')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'theme'
                ? 'border-[#B89882]/45 bg-[#B89882]/14 text-[#DFC5B0]'
                : 'border-transparent text-[#B7B1A8] hover:text-[#E6E1DA]'
            }`}
          >
            <Palette className="h-3.5 w-3.5 shrink-0" />
            <span>{t('settings.tabTheme')}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'storage'}
            onClick={() => setActiveTab('storage')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'storage'
                ? 'border-[#B89882]/45 bg-[#B89882]/14 text-[#DFC5B0]'
                : 'border-transparent text-[#B7B1A8] hover:text-[#E6E1DA]'
            }`}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span>{t('settings.tabStorage')}</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {savedFeedback && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-[#879B8D]/40 bg-[#879B8D]/14 px-3.5 py-2 text-xs text-[#C7D5CB]"
            >
              <Check className="h-4 w-4 text-[#A3B8A9] shrink-0" />
              <span>{savedFeedback}</span>
            </div>
          )}

          {activeTab === 'provider' && (
            <div className="space-y-4">
              {/* 4 Provider Selection Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setDraftProvider((prev) => ({
                      ...prev,
                      providerType: 'builtin-gemini',
                      presetId: 'gemini',
                    }))
                  }
                  className={`rounded-xl border p-3.5 text-left transition-colors ${
                    draftProvider.providerType === 'builtin-gemini'
                      ? 'border-[#B89882]/60 bg-[#B89882]/12'
                      : 'border-[#EAE5DE]/[0.08] bg-[#1D1F22] hover:border-[#EAE5DE]/[0.18]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#E6E1DA] whitespace-nowrap">
                      {t('settings.geminiBuiltin')}
                    </span>
                    <span className="text-[11px] font-medium text-[#A3B8A9] whitespace-nowrap shrink-0">
                      {t('settings.geminiMultimodal')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#B7B1A8] leading-relaxed">
                    {t('settings.geminiDesc')}
                  </p>
                </button>

                {EXTERNAL_PROVIDER_PRESETS.map((preset) => {
                  const selected = draftProvider.providerType === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectExternalPreset(preset.id)}
                      className={`rounded-xl border p-3.5 text-left transition-colors ${
                        selected
                          ? 'border-[#B89882]/60 bg-[#B89882]/12'
                          : 'border-[#EAE5DE]/[0.08] bg-[#1D1F22] hover:border-[#EAE5DE]/[0.18]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-sm font-semibold text-[#E6E1DA] whitespace-nowrap shrink-0">
                          {preset.label}
                        </span>
                        <span className="font-mono text-[11px] text-[#8B857C] truncate">
                          {preset.defaultModel}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#B7B1A8] leading-relaxed">
                        {preset.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Privacy & Local Storage Assurance Box */}
              <div className="rounded-xl border border-[#879B8D]/35 bg-[#879B8D]/10 p-3.5 space-y-1.5 text-xs">
                <div className="flex items-center gap-2 font-semibold text-[#C7D5CB]">
                  <ShieldCheck className="h-4 w-4 text-[#A3B8A9] shrink-0" aria-hidden="true" />
                  <span>{t('settings.apiKeyPrivacyTitle')}</span>
                </div>
                <p className="text-[#B7B1A8] leading-relaxed">
                  {t('settings.apiKeyPrivacyDesc')}
                </p>
              </div>

              {/* Built-in Gemini Model & API Key Configuration */}
              {!isExternalSelected && (
                <div className="rounded-xl border border-[#879B8D]/25 bg-[#1D1F22] p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#E6E1DA]">
                      {t('settings.geminiConfigTitle')}
                    </span>
                    <span className="text-[11px] font-mono text-[#879B8D]">
                      {t('settings.geminiFormatTip')}
                    </span>
                  </div>

                  {/* Model Selection Dropdown */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="builtin-gemini-model"
                        className="block text-xs font-medium text-[#B7B1A8]"
                      >
                        {t('settings.geminiModelLabel')}
                      </label>
                      <span className="text-[11px] text-[#A89882]">
                        {t('settings.geminiModel503Note')}
                      </span>
                    </div>
                    <select
                      id="builtin-gemini-model"
                      value={draftProvider.model || 'gemini-3.8-flash'}
                      onChange={(e) =>
                        setDraftProvider((prev) => ({ ...prev, model: e.target.value }))
                      }
                      className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3 py-2 text-xs font-mono text-[#E6E1DA] focus:border-[#B89882]/60 focus:outline-none"
                    >
                      {BUILTIN_GEMINI_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>

                    {/* Quick selection pill buttons */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {BUILTIN_GEMINI_MODELS.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setDraftProvider((prev) => ({ ...prev, model: m.id }))
                          }
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-mono transition-colors ${
                            (draftProvider.model || 'gemini-3.8-flash') === m.id
                              ? 'border-[#B89882]/50 bg-[#B89882]/16 text-[#DFC5B0]'
                              : 'border-[#EAE5DE]/[0.1] bg-[#2B2E33] text-[#B7B1A8] hover:text-[#E6E1DA]'
                          }`}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* API Key Input */}
                  <div>
                    <label
                      htmlFor="builtin-gemini-key"
                      className="block text-xs font-medium text-[#B7B1A8] mb-1"
                    >
                      {t('settings.geminiKeyLabel')}
                    </label>
                    <input
                      id="builtin-gemini-key"
                      type="password"
                      value={draftProvider.apiKey}
                      onChange={(e) =>
                        setDraftProvider((prev) => ({ ...prev, apiKey: e.target.value }))
                      }
                      placeholder={t('settings.apiKeyPlaceholder')}
                      className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3 py-2 text-xs font-mono text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none"
                    />
                  </div>

                  {!draftProvider.apiKey?.trim() && (
                    <div className="flex items-center gap-2 rounded-lg border border-[#C48B88]/30 bg-[#C48B88]/10 px-3 py-2 text-xs text-[#DFB2AF]">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-[#D19A97]" />
                      <span>{t('settings.geminiKeyMissing')}</span>
                    </div>
                  )}

                  <p className="text-[11px] text-[#8B857C] leading-relaxed">
                    {t('settings.geminiSecurityNote')}
                  </p>
                </div>
              )}

              {/* External API Form (DeepSeek / OpenAI / Claude) */}
              {isExternalSelected && (
                <div className="rounded-xl border border-[#EAE5DE]/[0.09] bg-[#1D1F22] p-4 space-y-3.5">
                  {activeExternalPreset && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#B7B1A8]">
                        {activeExternalPreset.label} 常用模型预设：
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {activeExternalPreset.models.map((mName) => (
                          <button
                            key={mName}
                            type="button"
                            onClick={() =>
                              setDraftProvider((prev) => ({
                                ...prev,
                                model: mName,
                              }))
                            }
                            className={`rounded-md border px-2.5 py-1 text-xs font-mono transition-colors ${
                              draftProvider.model === mName
                                ? 'border-[#B89882]/50 bg-[#B89882]/16 text-[#DFC5B0]'
                                : 'border-[#EAE5DE]/[0.1] bg-[#2B2E33] text-[#B7B1A8] hover:text-[#E6E1DA]'
                            }`}
                          >
                            {mName}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="custom-api-base-url"
                      className="block text-xs font-medium text-[#B7B1A8] mb-1"
                    >
                      接口 Base URL（支持官方地址或你的自建代理地址）
                    </label>
                    <input
                      id="custom-api-base-url"
                      type="url"
                      value={draftProvider.baseUrl}
                      onChange={(e) =>
                        setDraftProvider((prev) => ({ ...prev, baseUrl: e.target.value }))
                      }
                      placeholder={activeExternalPreset?.defaultBaseUrl || 'https://api.deepseek.com/v1'}
                      className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3 py-2 text-xs font-mono text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="custom-api-model"
                        className="block text-xs font-medium text-[#B7B1A8] mb-1"
                      >
                        模型名称 (Model ID)
                      </label>
                      <input
                        id="custom-api-model"
                        type="text"
                        value={draftProvider.model}
                        onChange={(e) =>
                          setDraftProvider((prev) => ({ ...prev, model: e.target.value }))
                        }
                        placeholder={activeExternalPreset?.defaultModel || 'deepseek-flash'}
                        className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3 py-2 text-xs font-mono text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="custom-api-key"
                        className="block text-xs font-medium text-[#B7B1A8] mb-1"
                      >
                        你的 API Key（仅存当前浏览器）
                      </label>
                      <input
                        id="custom-api-key"
                        type="password"
                        value={draftProvider.apiKey}
                        onChange={(e) =>
                          setDraftProvider((prev) => ({ ...prev, apiKey: e.target.value }))
                        }
                        placeholder={activeExternalPreset?.keyHint || 'sk-...'}
                        className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3 py-2 text-xs font-mono text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-[#8B857C] leading-relaxed">
                    提示：DeepSeek V4（deepseek-flash / deepseek-v4-pro）、OpenAI GPT-6（Responses API）与 Anthropic Claude 5.5 均支持阶段一文本与图片参考直读；您的 API Key 仅存储在本地浏览器 localStorage 并由浏览器直连对应服务商，绝不上传至本应用服务端或任何第三方中转。若需直读视频文件，请切换为「内置 Gemini（默认）」。
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-1">
                {draftProvider.apiKey.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      const cleared = { ...draftProvider, apiKey: '' };
                      setDraftProvider(cleared);
                      onSaveProviderConfig(cleared);
                      showSavedNotice('已清空本地保存的 API Key');
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-[#EAE5DE]/[0.12] px-3.5 py-2 text-xs text-[#B7B1A8] hover:border-[#C48B88]/50 hover:text-[#DFB2AF] transition-colors"
                  >
                    <span>清除本地密钥</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveProvider}
                  className="flex items-center gap-1.5 rounded-lg bg-[#B89882] px-4 py-2 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792] transition-colors"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>保存模型配置</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2.5">
                {saveModes.map((item) => {
                  const Icon = item.icon;
                  const isSelected = draftSave.mode === item.mode;
                  return (
                    <button
                      key={item.mode}
                      type="button"
                      onClick={() => setDraftSave((prev) => ({ ...prev, mode: item.mode }))}
                      className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                        isSelected
                          ? 'border-[#B89882]/60 bg-[#B89882]/12'
                          : 'border-[#EAE5DE]/[0.08] bg-[#1D1F22] hover:border-[#EAE5DE]/[0.18]'
                      }`}
                    >
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          isSelected ? 'text-[#D0B49F]' : 'text-[#8B857C]'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[#E6E1DA]">{item.title}</div>
                        <p className="mt-1 text-xs text-[#B7B1A8] leading-relaxed">{item.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {draftSave.mode === 'local-folder' && (
                <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] p-4 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[#E6E1DA] flex items-center gap-2">
                        <span>{t('settings.storagePathLabel')}</span>
                        {(draftSave.localFolderPath || draftSave.folderLabel) && (
                          <span className="inline-flex items-center gap-1 rounded bg-[#8BA396]/20 px-2 py-0.5 text-[10px] text-[#A3BFB0]">
                            <FolderCheck className="h-3 w-3" />
                            {t('settings.storageReady')}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={draftSave.localFolderPath || draftSave.folderLabel || ''}
                          onChange={(e) =>
                            setDraftSave((prev) => ({
                              ...prev,
                              localFolderPath: e.target.value,
                              folderLabel: e.target.value.split(/[\\/]/).pop() || e.target.value,
                            }))
                          }
                          placeholder={t('settings.storagePlaceholder')}
                          className="flex-1 rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3 py-1.5 text-xs font-mono text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 pt-4 sm:pt-0">
                      <button
                        type="button"
                        onClick={() => void onPickLocalFolder()}
                        className="flex items-center gap-1.5 rounded-lg border border-[#B89882]/45 bg-[#B89882]/14 px-3 py-1.5 text-xs font-medium text-[#DFC5B0] hover:bg-[#B89882]/24"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>{t('settings.storageBrowse')}</span>
                      </button>
                      {(draftSave.localFolderPath || draftSave.folderLabel) && (
                        <button
                          type="button"
                          onClick={() => {
                            const p = draftSave.localFolderPath || draftSave.folderLabel;
                            if (p) void revealLocalFolder(p);
                          }}
                          className="flex items-center gap-1 rounded-lg border border-[#EAE5DE]/[0.1] px-2.5 py-1.5 text-xs text-[#B7B1A8] hover:text-[#E6E1DA] hover:bg-[#EAE5DE]/[0.06]"
                          title="在文件资源管理器中打开"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>{t('settings.storageReveal')}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#EAE5DE]/[0.06]">
                    <label className="flex items-center gap-2 text-xs text-[#B7B1A8] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draftSave.autoSaveLocalFolder !== false}
                        onChange={(e) =>
                          setDraftSave((prev) => ({
                            ...prev,
                            autoSaveLocalFolder: e.target.checked,
                          }))
                        }
                        className="rounded border-[#EAE5DE]/20 bg-[#191B1E] text-[#B89882] focus:ring-0"
                      />
                      <span>{t('settings.storageAutoSave')}</span>
                    </label>

                    {onManualSaveLocalFolder && (
                      <button
                        type="button"
                        onClick={async () => {
                          setIsSavingLocal(true);
                          try {
                            await onManualSaveLocalFolder();
                            showSavedNotice('已将当前项目写入本地文件夹！');
                          } finally {
                            setIsSavingLocal(false);
                          }
                        }}
                        disabled={isSavingLocal}
                        className="flex items-center gap-1.5 rounded-lg border border-[#8BA396]/40 bg-[#8BA396]/15 px-3 py-1.5 text-xs font-medium text-[#A3BFB0] hover:bg-[#8BA396]/25"
                      >
                        <Save className="h-3.5 w-3.5" />
                        <span>{isSavingLocal ? t('settings.storageSaving') : t('settings.storageSaveNow')}</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleSaveDestination}
                  className="flex items-center gap-1.5 rounded-lg bg-[#B89882] px-4 py-2 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792] transition-colors"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{t('settings.storageApply')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Theme & Language Tab */}
          {activeTab === 'theme' && (
            <div className="space-y-6">
              {/* Interface Language Selection */}
              <div className="pb-5 border-b border-[#EAE5DE]/[0.08]">
                <div className="flex items-center gap-2 mb-1">
                  <Languages className="h-4 w-4 text-[#DFC5B0]" />
                  <h3 className="text-sm font-semibold text-[#E6E1DA]">
                    {t('settings.languageSection')}
                  </h3>
                </div>
                <p className="text-xs text-[#8B857C] mb-3">
                  {t('settings.languageHint')}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const isSelected = language === lang.id;
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        onClick={() => {
                          setLanguage(lang.id);
                          showSavedNotice(`语言已切换为 ${lang.name}`);
                        }}
                        className={`flex items-center gap-2 rounded-xl border p-3 text-left transition-all ${
                          isSelected
                            ? 'border-[#B89882] bg-[#B89882]/15 shadow-sm'
                            : 'border-[#EAE5DE]/[0.09] bg-[#1D1F22] hover:border-[#EAE5DE]/[0.2]'
                        }`}
                      >
                        <span className="text-lg">{lang.flag}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-[#E6E1DA] truncate">
                            {lang.nativeName}
                          </div>
                          <div className="text-[10px] text-[#8B857C] truncate">
                            {lang.name}
                          </div>
                        </div>
                        {isSelected && (
                          <CheckCircle2 className="h-4 w-4 text-[#DFC5B0] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Theme Tone Customization */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Palette className="h-4 w-4 text-[#DFC5B0]" />
                  <h3 className="text-sm font-semibold text-[#E6E1DA]">
                    {t('settings.themeSection')}
                  </h3>
                </div>
                <p className="text-xs text-[#8B857C] mb-3">
                  {t('settings.themeHint')}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {THEME_TONE_PRESETS.map((tone) => {
                  const isCurrent = currentTone === tone.id;
                  return (
                    <button
                      key={tone.id}
                      type="button"
                      onClick={() => {
                        setCurrentTone(tone.id);
                        saveUiTone(tone.id);
                        showSavedNotice(`已切换界面色调为「${tone.title}」`);
                      }}
                      className={`flex flex-col text-left rounded-xl border p-4 transition-all relative ${
                        isCurrent
                          ? 'border-[#B89882] bg-[#B89882]/12 shadow-lg'
                          : 'border-[#EAE5DE]/[0.09] bg-[#1D1F22] hover:border-[#EAE5DE]/[0.2]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm text-[#E6E1DA]">{tone.title}</span>
                        {isCurrent && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-[#DFC5B0] bg-[#B89882]/20 px-2 py-0.5 rounded-full border border-[#B89882]/40">
                            <Check className="h-3 w-3" />
                            {t('settings.themeActive')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#8B857C] mb-3 flex-1">{tone.desc}</p>

                      {/* Color Palette Chips */}
                      <div className="flex items-center gap-2 pt-2 border-t border-[#EAE5DE]/[0.06]">
                        <span className="text-[10px] text-[#8B857C]">{t('settings.themePaletteSample')}</span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-4 w-4 rounded-full border border-[#EAE5DE]/20"
                            style={{ backgroundColor: tone.previewColors.bg }}
                            title="主背景"
                          />
                          <span
                            className="h-4 w-4 rounded-full border border-[#EAE5DE]/20"
                            style={{ backgroundColor: tone.previewColors.surface }}
                            title="工作面板"
                          />
                          <span
                            className="h-4 w-4 rounded-full border border-[#EAE5DE]/20"
                            style={{ backgroundColor: tone.previewColors.elevated }}
                            title="激活卡片"
                          />
                          <span
                            className="h-4 w-4 rounded-full border border-[#EAE5DE]/20"
                            style={{ backgroundColor: tone.previewColors.accent }}
                            title="高亮强调色"
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'usage' && (
            <div className="space-y-4">
              {usageAlert.message && (
                <div
                  role="alert"
                  className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-xs ${
                    usageAlert.level === 'exceeded'
                      ? 'border-[#C48B88]/45 bg-[#C48B88]/12 text-[#DFB2AF]'
                      : 'border-[#C9B382]/45 bg-[#C9B382]/12 text-[#DFCEA4]'
                  }`}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{usageAlert.message}</span>
                </div>
              )}

              {/* Numeric KPI Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] p-3">
                  <div className="text-[11px] text-[#8B857C]">累计请求次数</div>
                  <div className="mt-1 font-mono text-lg font-semibold text-[#E6E1DA] tabular-nums">
                    {usageStats.totalRequests.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] p-3">
                  <div className="text-[11px] text-[#8B857C]">输入 Tokens</div>
                  <div className="mt-1 font-mono text-lg font-semibold text-[#E6E1DA] tabular-nums">
                    {usageStats.promptTokens.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] p-3">
                  <div className="text-[11px] text-[#8B857C]">输出 Tokens</div>
                  <div className="mt-1 font-mono text-lg font-semibold text-[#E6E1DA] tabular-nums">
                    {usageStats.candidatesTokens.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] p-3">
                  <div className="text-[11px] text-[#8B857C]">累计总 Tokens</div>
                  <div className="mt-1 font-mono text-lg font-semibold text-[#D0B49F] tabular-nums">
                    {usageStats.totalTokens.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Budget Threshold & Alerts Config */}
              <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#E6E1DA]">Token 配额预算与预警阈值设置</span>
                  <span className="font-mono text-[#B7B1A8] tabular-nums">
                    已用 {usageAlert.percentage}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded bg-[#EAE5DE]/[0.07]">
                  <div
                    className={`h-full transition-all ${
                      usageAlert.level === 'exceeded'
                        ? 'bg-[#C48B88]'
                        : usageAlert.level === 'warning'
                        ? 'bg-[#C9B382]'
                        : 'bg-[#879B8D]'
                    }`}
                    style={{ width: `${Math.min(100, usageAlert.percentage)}%` }}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label
                      htmlFor="usage-warn-threshold"
                      className="block text-[11px] text-[#8B857C] mb-1"
                    >
                      黄色预警阈值（Tokens）
                    </label>
                    <input
                      id="usage-warn-threshold"
                      type="number"
                      min={1000}
                      step={5000}
                      value={warnTokensInput}
                      onChange={(e) => setWarnTokensInput(e.target.value)}
                      className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3 py-1.5 text-xs font-mono text-[#E6E1DA] tabular-nums focus:border-[#B89882]/60 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="usage-budget-limit"
                      className="block text-[11px] text-[#8B857C] mb-1"
                    >
                      红色上限提醒（Tokens）
                    </label>
                    <input
                      id="usage-budget-limit"
                      type="number"
                      min={5000}
                      step={10000}
                      value={budgetTokensInput}
                      onChange={(e) => setBudgetTokensInput(e.target.value)}
                      className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3 py-1.5 text-xs font-mono text-[#E6E1DA] tabular-nums focus:border-[#B89882]/60 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onResetUsageStats();
                      showSavedNotice('已清零本地 API 用量统计');
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-[#EAE5DE]/[0.1] px-3 py-1.5 text-xs text-[#B7B1A8] hover:border-[#C48B88]/50 hover:text-[#DFB2AF]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>清零统计</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveQuota}
                    className="flex items-center gap-1.5 rounded-lg bg-[#B89882] px-3.5 py-1.5 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792]"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>{t('settings.usageSaveThreshold')}</span>
                  </button>
                </div>
              </div>

              {/* Recent Records */}
              <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] overflow-hidden">
                <div className="border-b border-[#EAE5DE]/[0.06] px-4 py-2.5 text-xs font-medium text-[#E6E1DA]">
                  {t('settings.usageRecentTitle', { count: usageStats.recentRecords.length })}
                </div>
                {usageStats.recentRecords.length === 0 ? (
                  <p className="px-4 py-5 text-center text-xs text-[#8B857C]">
                    {t('settings.usageNoRecords')}
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto divide-y divide-[#EAE5DE]/[0.05]">
                    {usageStats.recentRecords.map((rec) => (
                      <div
                        key={rec.id}
                        className="flex items-center justify-between gap-3 px-4 py-2 text-xs tabular-nums"
                      >
                        <div className="min-w-0">
                          <span className="text-[#E6E1DA] font-medium">{rec.action}</span>
                          <span className="mx-1.5 text-[#8B857C]">·</span>
                          <span className="font-mono text-[11px] text-[#B7B1A8]">{rec.model}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] text-[#8B857C]">
                          <span>in {rec.promptTokens}</span>
                          <span>out {rec.candidatesTokens}</span>
                          <span className="text-[#D0B49F] font-semibold">
                            {rec.totalTokens} tok
                          </span>
                          <span>{rec.timestamp}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
