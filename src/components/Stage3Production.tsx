import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FileInput,
  Film,
  Lock,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { runAddShot, runEditShot, runStoryboard } from '../services/geminiClient';
import type { Project, ShotDialogueMessage, StoryboardShot } from '../types/workspace';
import {
  appendShotToStoryboard,
  applyVisualLockToPrompt,
  formatFriendlyErrorMessage,
  getActiveAspectRatio,
  getEffectiveVisualLockSuffix,
  normalizeVisualLockId,
  stripMidjourneyVersionFlags,
  VISUAL_LOCK_PRESETS,
} from '../utils/workflow';

interface Stage3ProductionProps {
  project: Project;
  onUpdateProject: (updater: (prev: Project) => Project) => void;
  onGoToStage2: () => void;
  onError: (msg: string) => void;
}

export const Stage3Production: React.FC<Stage3ProductionProps> = ({
  project,
  onUpdateProject,
  onGoToStage2,
  onError,
}) => {
  const { t } = useI18n();
  const singleShotStyleSuggestions = [
    t('stage3.stylePreset1'),
    t('stage3.stylePreset2'),
    t('stage3.stylePreset3'),
    t('stage3.stylePreset4'),
  ];
  const { activeVisualLockId, customVisualLockSuffix, shots } = project.stage3;
  const normalizedLockId = normalizeVisualLockId(activeVisualLockId);
  const activeRatio = getActiveAspectRatio(normalizedLockId);
  const hasScript = project.stage2.scriptContent.trim().length > 0;

  const [isGeneratingBoard, setIsGeneratingBoard] = useState(false);

  // External completed script input panel
  const [showExternalScriptPanel, setShowExternalScriptPanel] = useState(false);
  const [externalScriptDraft, setExternalScriptDraft] = useState('');
  const [syncExternalToStage2, setSyncExternalToStage2] = useState(true);

  // Add new shot panel
  const [showAddShotPanel, setShowAddShotPanel] = useState(false);
  const [newShotInstruction, setNewShotInstruction] = useState('');
  const [isAddingShot, setIsAddingShot] = useState(false);

  // Per-shot dialogue state
  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [shotInstruction, setShotInstruction] = useState('');
  const [isUpdatingShotId, setIsUpdatingShotId] = useState<string | null>(null);
  const [copiedShotId, setCopiedShotId] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  const lockSuffix = getEffectiveVisualLockSuffix(normalizedLockId, customVisualLockSuffix);
  const totalDuration = shots.reduce((sum, s) => sum + (s.durationSec || 0), 0);

  const handleGenerateStoryboard = async (overrideScript?: string) => {
    const sourceScript = (overrideScript ?? project.stage2.scriptContent).trim();
    if (!sourceScript || isGeneratingBoard) return;
    setIsGeneratingBoard(true);

    try {
      const nextShots = await runStoryboard({
        projectName: project.name,
        platform: project.platform,
        scriptContent: sourceScript,
        aspectRatio: activeRatio,
      });

      onUpdateProject((prev) => ({
        ...prev,
        stage2:
          overrideScript && syncExternalToStage2
            ? {
                ...prev.stage2,
                scriptContent: sourceScript,
              }
            : prev.stage2,
        stage3: {
          ...prev.stage3,
          activeVisualLockId: normalizedLockId,
          shots: nextShots,
        },
      }));

      if (overrideScript) {
        setShowExternalScriptPanel(false);
      }
    } catch (err) {
      onError(formatFriendlyErrorMessage(err, '生成分镜失败'));
    } finally {
      setIsGeneratingBoard(false);
    }
  };

  const handleSelectAspectRatio = (presetId: 'ratio-9-16' | 'ratio-16-9') => {
    onUpdateProject((prev) => ({
      ...prev,
      stage3: {
        ...prev.stage3,
        activeVisualLockId: presetId,
      },
    }));
  };

  const handleAddNewShot = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newShotInstruction.trim();
    if (!trimmed || isAddingShot) return;
    setIsAddingShot(true);

    try {
      const createdShot = await runAddShot({
        projectName: project.name,
        platform: project.platform,
        scriptContent: externalScriptDraft.trim() || project.stage2.scriptContent,
        existingShots: shots,
        instruction: trimmed,
        aspectRatio: activeRatio,
      });

      onUpdateProject((prev) => ({
        ...prev,
        stage3: {
          ...prev.stage3,
          shots: appendShotToStoryboard(prev.stage3.shots, createdShot),
        },
      }));

      setNewShotInstruction('');
      setShowAddShotPanel(false);
    } catch (err) {
      onError(formatFriendlyErrorMessage(err, '新增镜头失败'));
    } finally {
      setIsAddingShot(false);
    }
  };

  const handleShotDialogueSubmit = async (
    shot: StoryboardShot,
    overridePrompt?: string
  ) => {
    const trimmed = (overridePrompt ?? shotInstruction).trim();
    if (!trimmed || isUpdatingShotId) return;
    setIsUpdatingShotId(shot.id);
    if (!overridePrompt) setShotInstruction('');

    const nowTime = new Date().toISOString().slice(11, 16);
    const existingHistory = shot.dialogueHistory ?? [];

    try {
      const updated = await runEditShot({
        projectName: project.name,
        platform: project.platform,
        shot,
        instruction: trimmed,
        aspectRatio: activeRatio,
        shotHistory: existingHistory.map((m) => ({ role: m.role, content: m.content })),
      });

      const userTurn: ShotDialogueMessage = {
        id: `sdlg_${Date.now()}_u`,
        role: 'user',
        content: trimmed,
        timestamp: nowTime,
      };
      const assistantTurn: ShotDialogueMessage = {
        id: `sdlg_${Date.now() + 1}_a`,
        role: 'assistant',
        content:
          updated.assistantReply ||
          '已根据你的单镜对话设定刷新本镜画面描述与 Midjourney 提示词。',
        timestamp: new Date().toISOString().slice(11, 16),
      };

      onUpdateProject((prev) => ({
        ...prev,
        stage3: {
          ...prev.stage3,
          shots: prev.stage3.shots.map((s) =>
            s.id === shot.id
              ? {
                  ...s,
                  shotSize: updated.shotSize ?? s.shotSize,
                  durationSec: updated.durationSec ?? s.durationSec,
                  visualDescription: updated.visualDescription ?? s.visualDescription,
                  dialogue: updated.dialogue ?? s.dialogue,
                  baseMjPrompt: stripMidjourneyVersionFlags(
                    updated.baseMjPrompt ?? s.baseMjPrompt
                  ),
                  cameraMovement: updated.cameraMovement ?? s.cameraMovement,
                  styleNote: updated.styleNote ?? s.styleNote,
                  dialogueHistory: [...(s.dialogueHistory ?? []), userTurn, assistantTurn].slice(-12),
                }
              : s
          ),
        },
      }));
    } catch (err) {
      if (!overridePrompt) setShotInstruction(trimmed);
      onError(formatFriendlyErrorMessage(err, '单镜对话更新失败'));
    } finally {
      setIsUpdatingShotId(null);
    }
  };

  const handleCopyPrompt = async (shot: StoryboardShot) => {
    const fullPrompt = applyVisualLockToPrompt(shot.baseMjPrompt, lockSuffix);
    try {
      await navigator.clipboard.writeText(fullPrompt);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      setCopiedShotId(shot.id);
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopiedShotId((prev) => (prev === shot.id ? null : prev));
      }, 1800);
    } catch (err) {
      onError(formatFriendlyErrorMessage(err, '无法访问剪贴板，请手动复制提示词'));
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#1D1F22]">
      {/* Top Visual Asset Lock & Director Action Bar */}
      <div className="border-b border-[#EAE5DE]/[0.08] bg-[#24272B]/90 px-6 py-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#B7B1A8]">
            <span className="font-semibold text-[#E6E1DA] text-sm">{t('stage3.headerTitle')}</span>
            <span aria-hidden="true">·</span>
            <span>{activeRatio} {t('stage3.cinemaComposition')}</span>
            <span aria-hidden="true">·</span>
            <span>{t('stage3.customStyle')}</span>
            <span aria-hidden="true">·</span>
            <span>{t('stage3.noMjFlags')}</span>
            {shots.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[#DFC5B0] tabular-nums">
                  {t('common.shots', { count: shots.length })} / {totalDuration}s
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setShowExternalScriptPanel((v) => !v);
                setShowAddShotPanel(false);
              }}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                showExternalScriptPanel
                  ? 'border-[#B89882]/60 bg-[#B89882]/16 text-[#DFC5B0]'
                  : 'border-[#EAE5DE]/[0.12] bg-[#2B2E33] text-[#E6E1DA] hover:border-[#B89882]/45 hover:text-[#DFC5B0]'
              }`}
            >
              <FileInput className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{t('stage3.importExternal')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowAddShotPanel((v) => !v);
                setShowExternalScriptPanel(false);
              }}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                showAddShotPanel
                  ? 'border-[#879B8D]/60 bg-[#879B8D]/16 text-[#AFC2B4]'
                  : 'border-[#EAE5DE]/[0.12] bg-[#2B2E33] text-[#E6E1DA] hover:border-[#879B8D]/45 hover:text-[#AFC2B4]'
              }`}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{t('stage3.addShot')}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleGenerateStoryboard()}
              disabled={!hasScript || isGeneratingBoard}
              className="flex items-center gap-1.5 rounded-lg border border-[#B89882]/45 bg-[#B89882]/16 px-3.5 py-2 text-xs font-semibold text-[#DFC5B0] hover:bg-[#B89882]/26 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {isGeneratingBoard
                  ? t('stage3.generatingBoard')
                  : shots.length > 0
                  ? t('stage3.regenerateBoard')
                  : t('stage3.generateBoard')}
              </span>
            </button>
          </div>
        </div>

        {/* Visual Asset Lock Bar: Aspect Ratio Only (9:16 / 16:9) + Mandatory Cinema Film Texture */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[#EAE5DE]/[0.06]">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#E6E1DA] shrink-0">
            <Lock className="h-3.5 w-3.5 text-[#D0B49F]" aria-hidden="true" />
            <span>{t('stage3.visualLockLabel')}</span>
          </div>

          <div
            className="flex items-center gap-1.5"
            role="radiogroup"
            aria-label="画面比例锁定选项"
          >
            {VISUAL_LOCK_PRESETS.map((preset) => {
              const isSelected = normalizedLockId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  title={preset.description}
                  onClick={() =>
                    handleSelectAspectRatio(preset.id as 'ratio-9-16' | 'ratio-16-9')
                  }
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'border-[#B89882]/60 bg-[#B89882]/16 text-[#DFC5B0]'
                      : 'border-[#EAE5DE]/[0.09] bg-[#2B2E33] text-[#B7B1A8] hover:text-[#E6E1DA] hover:border-[#EAE5DE]/[0.18]'
                  }`}
                >
                  <span
                    className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                      isSelected
                        ? 'border-[#D0B49F] bg-[#B89882] text-[#1B1715]'
                        : 'border-[#8B857C]'
                    }`}
                  >
                    {isSelected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                  <span>{preset.shortLabel}</span>
                  <span className="font-mono text-[11px] text-[#B7B1A8]">
                    --ar {preset.aspectRatio}
                  </span>
                </button>
              );
            })}
          </div>

          <span className="text-xs text-[#B7B1A8] whitespace-nowrap">
            {t('stage3.filmTextureNote')}
          </span>

          <input
            type="text"
            aria-label="附加自定义视觉参数"
            value={customVisualLockSuffix}
            onChange={(e) => {
              const val = stripMidjourneyVersionFlags(e.target.value);
              onUpdateProject((prev) => ({
                ...prev,
                stage3: {
                  ...prev.stage3,
                  customVisualLockSuffix: val,
                },
              }));
            }}
            placeholder={t('stage3.customParamPlaceholder')}
            className="ml-auto w-56 xl:w-64 rounded-lg border border-[#EAE5DE]/[0.09] bg-[#191B1E] px-3 py-1.5 text-xs font-mono text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none"
          />
        </div>

        {/* Collapsible Panel: Import External Completed Script */}
        {showExternalScriptPanel && (
          <div className="rounded-xl border border-[#B89882]/40 bg-[#2B2E33] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-[#DFC5B0]">
                  {t('stage3.importExternalTitle')}
                </h3>
                <p className="mt-0.5 text-[11px] text-[#B7B1A8]">
                  {t('stage3.externalScriptSub', { ratio: activeRatio })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowExternalScriptPanel(false)}
                aria-label={t('common.close')}
                className="rounded p-1 text-[#B7B1A8] hover:bg-[#EAE5DE]/10 hover:text-[#E6E1DA]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              rows={4}
              aria-label="粘贴外部已完成文案"
              value={externalScriptDraft}
              onChange={(e) => setExternalScriptDraft(e.target.value)}
              placeholder={t('stage3.externalScriptPlaceholder')}
              className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3.5 py-2.5 text-xs text-[#E6E1DA] leading-relaxed placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none resize-y"
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-[#E6E1DA] cursor-pointer">
                <input
                  type="checkbox"
                  checked={syncExternalToStage2}
                  onChange={(e) => setSyncExternalToStage2(e.target.checked)}
                  className="rounded border-[#8B857C] bg-[#191B1E] text-[#B89882] focus:ring-[#B89882]"
                />
                <span>{t('stage3.syncExternalCheckbox')}</span>
              </label>

              <button
                type="button"
                disabled={!externalScriptDraft.trim() || isGeneratingBoard}
                onClick={() => void handleGenerateStoryboard(externalScriptDraft)}
                className="flex items-center gap-1.5 rounded-lg bg-[#B89882] px-4 py-2 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792] disabled:opacity-40 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isGeneratingBoard ? t('stage3.generatingBoard') : t('stage3.generateFromExternal')}</span>
              </button>
            </div>
          </div>
        )}

        {/* Collapsible Panel: Add New Shot */}
        {showAddShotPanel && (
          <form
            onSubmit={handleAddNewShot}
            className="rounded-xl border border-[#879B8D]/40 bg-[#2B2E33] p-4 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="add-new-shot-input"
                className="text-xs font-semibold text-[#AFC2B4]"
              >
                {t('stage3.addShotHeader', { index: shots.length + 1, ratio: activeRatio })}
              </label>
              <button
                type="button"
                onClick={() => setShowAddShotPanel(false)}
                aria-label={t('common.close')}
                className="rounded p-1 text-[#B7B1A8] hover:bg-[#EAE5DE]/10 hover:text-[#E6E1DA]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                id="add-new-shot-input"
                type="text"
                value={newShotInstruction}
                onChange={(e) => setNewShotInstruction(e.target.value)}
                placeholder={t('stage3.addShotPlaceholder')}
                className="flex-1 min-w-[260px] rounded-lg border border-[#EAE5DE]/[0.12] bg-[#191B1E] px-3.5 py-2 text-xs text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#879B8D]/60 focus:outline-none"
                autoFocus
              />
              <button
                type="submit"
                disabled={isAddingShot || !newShotInstruction.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-[#879B8D] px-4 py-2 text-xs font-semibold text-[#151B17] hover:bg-[#97AB9D] disabled:opacity-40 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isAddingShot ? t('stage3.addingShot') : t('stage3.confirmAddThisShot')}</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Storyboard Cards Canvas */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {!hasScript && shots.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center px-6 py-12">
            <Film className="h-9 w-9 text-[#D0B49F]/80 mb-3" aria-hidden="true" />
            <h2 className="text-base font-semibold text-[#E6E1DA]">
              {t('stage3.noScriptTitle')}
            </h2>
            <p className="mt-2 max-w-md text-sm text-[#B7B1A8]">
              {t('stage3.noScriptDesc')}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowExternalScriptPanel(true)}
                className="flex items-center gap-1.5 rounded-lg bg-[#B89882] px-4 py-2 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792]"
              >
                <FileInput className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('stage3.btnImportExternal')}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddShotPanel(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[#879B8D]/45 bg-[#879B8D]/14 px-4 py-2 text-xs font-semibold text-[#AFC2B4] hover:bg-[#879B8D]/24"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('stage3.btnAddFirstShot')}</span>
              </button>
              <button
                type="button"
                onClick={onGoToStage2}
                className="rounded-lg border border-[#EAE5DE]/[0.12] bg-[#2B2E33] px-4 py-2 text-xs font-medium text-[#E6E1DA] hover:border-[#B89882]/45"
              >
                {t('stage3.btnBackToStage2')}
              </button>
            </div>
          </div>
        ) : shots.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center px-6 py-12">
            <Film className="h-9 w-9 text-[#D0B49F]/80 mb-3" aria-hidden="true" />
            <h2 className="text-base font-semibold text-[#E6E1DA]">
              {t('stage3.readyTitle')}
            </h2>
            <p className="mt-2 max-w-md text-sm text-[#B7B1A8]">
              {t('stage3.readyDesc', { ratio: activeRatio })}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void handleGenerateStoryboard()}
                disabled={isGeneratingBoard}
                className="flex items-center gap-2 rounded-lg bg-[#B89882] px-5 py-2.5 text-sm font-semibold text-[#1B1715] hover:bg-[#C5A792] disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                <span>{isGeneratingBoard ? t('stage3.generatingBoard') : t('stage3.generateBoard')}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddShotPanel(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[#EAE5DE]/[0.12] bg-[#2B2E33] px-4 py-2.5 text-xs font-medium text-[#E6E1DA] hover:border-[#879B8D]/45"
              >
                <Plus className="h-3.5 w-3.5 text-[#A3B8A9]" aria-hidden="true" />
                <span>{t('stage3.btnAddSingleShot')}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-[1160px] space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {shots.map((shot) => {
                const isEditingThis = editingShotId === shot.id;
                const isUpdatingThis = isUpdatingShotId === shot.id;
                const combinedPrompt = applyVisualLockToPrompt(shot.baseMjPrompt, lockSuffix);
                const shotHistory = shot.dialogueHistory ?? [];

                return (
                  <article
                    key={shot.id}
                    data-testid={`shot-card-${shot.shotNumber}`}
                    className="flex flex-col justify-between rounded-xl border border-[#EAE5DE]/[0.09] bg-[#24272B] p-5 transition-colors hover:border-[#EAE5DE]/[0.18]"
                  >
                    <div>
                      {/* Shot Header */}
                      <div className="flex items-center justify-between gap-3 border-b border-[#EAE5DE]/[0.07] pb-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                          <span className="font-mono text-sm font-semibold text-[#DFC5B0]">
                            SHOT {String(shot.shotNumber).padStart(2, '0')}
                          </span>
                          <span className="text-[#8B857C]" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-[#E6E1DA] font-medium">{shot.shotSize}</span>
                          <span className="text-[#8B857C]" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono text-[#B7B1A8]">{shot.durationSec}s</span>
                          {shot.shotNumber === 1 && (
                            <>
                              <span className="text-[#8B857C]" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-[#A3B8A9] font-medium">{t('stage3.firstFrame')}</span>
                            </>
                          )}
                          {shot.styleNote && (
                            <>
                              <span className="text-[#8B857C]" aria-hidden="true">
                                ·
                              </span>
                              <span className="text-[#D0B49F] font-medium">{shot.styleNote}</span>
                            </>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (isEditingThis) {
                              setEditingShotId(null);
                              setShotInstruction('');
                            } else {
                              setEditingShotId(shot.id);
                              setShotInstruction('');
                            }
                          }}
                          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                            isEditingThis
                              ? 'border-[#B89882]/50 bg-[#B89882]/16 text-[#DFC5B0]'
                              : 'border-[#EAE5DE]/[0.1] bg-[#2B2E33] text-[#E6E1DA] hover:border-[#B89882]/50 hover:text-[#DFC5B0]'
                          }`}
                        >
                          {isEditingThis ? (
                            <>
                              <X className="h-3 w-3" aria-hidden="true" />
                              <span>{t('stage3.collapseDialogue')}</span>
                            </>
                          ) : (
                            <>
                              <MessageSquare className="h-3 w-3" aria-hidden="true" />
                              <span>{t('stage3.shotDialogueBtn')}</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Single-Shot Conversational Style & Framing Dialogue */}
                      {isEditingThis && (
                        <div className="mt-3 rounded-lg border border-[#B89882]/40 bg-[#1D1F22] p-3 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-[#DFC5B0]">
                              {t('stage3.shotDialogueScope', { num: shot.shotNumber })}
                            </span>
                          </div>

                          {shotHistory.length > 0 && (
                            <div className="max-h-36 overflow-y-auto space-y-2 rounded-md border border-[#EAE5DE]/[0.07] bg-[#191B1E] p-2.5">
                              {shotHistory.map((turn) => (
                                <div key={turn.id} className="text-xs leading-relaxed">
                                  <span
                                    className={`font-medium mr-1.5 ${
                                      turn.role === 'user' ? 'text-[#DFC5B0]' : 'text-[#AFC2B4]'
                                    }`}
                                  >
                                    {turn.role === 'user' ? t('stage3.dialogueUser') : t('stage3.dialogueAssistant')}
                                  </span>
                                  <span className="text-[#E6E1DA]">{turn.content}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex flex-wrap gap-1.5">
                            {singleShotStyleSuggestions.map((chip) => (
                              <button
                                key={chip}
                                type="button"
                                disabled={isUpdatingThis}
                                onClick={() => void handleShotDialogueSubmit(shot, chip)}
                                className="rounded border border-[#EAE5DE]/[0.1] bg-[#2B2E33] px-2 py-1 text-[11px] text-[#E6E1DA] hover:border-[#B89882]/50 hover:text-[#DFC5B0] transition-colors"
                              >
                                {chip}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              id={`edit-shot-input-${shot.id}`}
                              type="text"
                              aria-label={`第 ${shot.shotNumber} 镜风格与画面对话输入`}
                              value={shotInstruction}
                              onChange={(e) => setShotInstruction(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void handleShotDialogueSubmit(shot);
                                }
                              }}
                              placeholder={t('stage3.shotDialoguePlaceholder')}
                              className="flex-1 rounded-md border border-[#EAE5DE]/[0.12] bg-[#191B1E] px-3 py-1.5 text-xs text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => void handleShotDialogueSubmit(shot)}
                              disabled={isUpdatingThis || !shotInstruction.trim()}
                              className="flex items-center gap-1 rounded-md bg-[#B89882] px-3 py-1.5 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792] disabled:opacity-40 whitespace-nowrap shrink-0"
                            >
                              <Send className="h-3 w-3" aria-hidden="true" />
                              <span>{isUpdatingThis ? t('stage3.dialogueSending') : t('stage3.dialogueSend')}</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Shot Details */}
                      <div className="mt-3.5 space-y-3 text-xs">
                        <div>
                          <div className="text-[#8B857C] mb-1">
                            {t('stage3.visualDescHeader', { ratio: activeRatio })}
                          </div>
                          <p className="text-[#E6E1DA] leading-relaxed text-[13px]">
                            {shot.visualDescription}
                          </p>
                        </div>

                        <div>
                          <div className="text-[#8B857C] mb-1">{t('stage3.dialogueLabel')}</div>
                          <p className="text-[#B7B1A8] leading-relaxed bg-[#1D1F22] rounded-lg px-3 py-2 border border-[#EAE5DE]/[0.06]">
                            {shot.dialogue}
                          </p>
                        </div>

                        <div>
                          <div className="text-[#8B857C] mb-1">{t('stage3.cameraMovementLabel')}</div>
                          <p className="text-[#E6E1DA]/90">{shot.cameraMovement}</p>
                        </div>
                      </div>
                    </div>

                    {/* Midjourney Prompt Box with Aspect Ratio & Cinema Film Texture Lock (Zero --v flags) */}
                    <div className="mt-4 rounded-lg border border-[#EAE5DE]/[0.09] bg-[#191B1E] p-3">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[11px] font-medium text-[#B7B1A8]">
                          {t('stage3.promptLabel')}
                          <span className="ml-2 text-[#D0B49F]">
                            {t('stage3.filmTexturePlus')}{activeRatio}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyPrompt(shot)}
                          aria-label={`复制第 ${shot.shotNumber} 镜 Midjourney 提示词`}
                          className="flex items-center gap-1 text-[11px] text-[#B7B1A8] hover:text-[#DFC5B0] transition-colors"
                        >
                          {copiedShotId === shot.id ? (
                            <>
                              <Check className="h-3 w-3 text-[#A3B8A9]" />
                              <span className="text-[#A3B8A9]">{t('common.copied')}</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>{t('stage3.copyFullPrompt')}</span>
                            </>
                          )}
                        </button>
                      </div>
                      <p
                        data-testid={`mj-prompt-${shot.shotNumber}`}
                        className="font-mono text-[11.5px] leading-relaxed text-[#E6E1DA]/90 break-words"
                      >
                        {combinedPrompt}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Bottom Add New Shot Trigger */}
            <div className="flex justify-center pt-1 pb-4">
              <button
                type="button"
                onClick={() => {
                  setShowAddShotPanel(true);
                  setShowExternalScriptPanel(false);
                }}
                className="flex items-center gap-2 rounded-lg border border-dashed border-[#879B8D]/45 bg-[#879B8D]/8 px-5 py-2.5 text-xs font-medium text-[#AFC2B4] hover:bg-[#879B8D]/16 transition-colors"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>{t('stage3.addNextShotBtn', { num: shots.length + 1 })}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
