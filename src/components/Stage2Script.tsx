import React, { useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
  Zap,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import { useI18n } from '../i18n';
import type {
  EnhancedHookProposal,
  GeneratedScriptCandidate,
} from '../rules/copywritingRules';
import {
  runEnhanceHook,
  runGenerateScript,
  runInlineEdit,
} from '../services/geminiClient';
import type { Project, ScriptEditRecord } from '../types/workspace';
import { getTextareaSelectionTopCoords } from '../utils/selectionCoords';
import { applyInlineEdit, formatFriendlyErrorMessage } from '../utils/workflow';

interface Stage2ScriptProps {
  project: Project;
  onUpdateProject: (updater: (prev: Project) => Project) => void;
  onProceedToStage3: () => void;
  onGoToStage1: () => void;
  onError: (msg: string) => void;
}

interface SelectionState {
  start: number;
  end: number;
  text: string;
  anchorTop: number;
  anchorLeft: number;
  placeBelow: boolean;
}

export const Stage2Script: React.FC<Stage2ScriptProps> = ({
  project,
  onUpdateProject,
  onProceedToStage3,
  onGoToStage1,
  onError,
}) => {
  const { t } = useI18n();
  const quickInstructions = [
    t('stage2.quickColloquial'),
    t('stage2.quickHook'),
    t('stage2.quickPacing'),
    t('stage2.quickVisual'),
  ];
  const { brief, scriptContent, editHistory, candidateScripts, activeCandidateId } =
    project.stage2;

  const [briefExpanded, setBriefExpanded] = useState(true);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isEnhancingHook, setIsEnhancingHook] = useState(false);
  const [hookProposals, setHookProposals] = useState<EnhancedHookProposal[] | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState<string>('');

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [inlineInstruction, setInlineInstruction] = useState('');
  const [isRewritingSpan, setIsRewritingSpan] = useState(false);
  const [proposedReplacement, setProposedReplacement] = useState<string | null>(null);

  const charCount = scriptContent.replace(/\s+/g, '').length;
  const estSeconds = Math.max(0, Math.round(charCount / 4.2));

  // 1. AI Generate 3 script candidates based on rules
  const handleGenerateFromBrief = async () => {
    if (!brief || isGeneratingScript) return;
    setIsGeneratingScript(true);
    setSelection(null);
    setProposedReplacement(null);

    try {
      const res = await runGenerateScript({
        projectName: project.name,
        platform: project.platform,
        brief,
      });

      const primaryText = res.script || res.candidates[0]?.scriptText || '';
      const firstId = res.candidates[0]?.id || 'v1';

      onUpdateProject((prev) => ({
        ...prev,
        stage2: {
          ...prev.stage2,
          scriptContent: primaryText,
          candidateScripts: res.candidates,
          activeCandidateId: firstId,
        },
      }));
    } catch (err) {
      onError(formatFriendlyErrorMessage(err, '生成脚本失败'));
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // 2. Select a candidate variation into editor
  const handleApplyCandidate = (cand: GeneratedScriptCandidate) => {
    onUpdateProject((prev) => ({
      ...prev,
      stage2: {
        ...prev.stage2,
        scriptContent: cand.scriptText,
        activeCandidateId: cand.id,
      },
    }));
  };

  // 3. Trigger "强化钩子" Engine
  const handleTriggerEnhanceHook = async () => {
    if (!scriptContent.trim()) {
      onError('请先编写或生成一段口播文案，再点击「强化钩子」进行润色改写。');
      return;
    }
    if (isEnhancingHook) return;
    setIsEnhancingHook(true);

    try {
      const proposals = await runEnhanceHook({
        fullScript: scriptContent,
        platform: project.platform,
        brief,
      });

      if (proposals.length > 0) {
        setHookProposals(proposals);
        setSelectedProposalId(proposals[0].id);
      } else {
        onError('未能生成有效的强化钩子方案，请重试。');
      }
    } catch (err) {
      onError(formatFriendlyErrorMessage(err, '强化钩子改写请求失败'));
    } finally {
      setIsEnhancingHook(false);
    }
  };

  // 4. Apply selected enhanced hook proposal
  const handleApplyEnhancedProposal = (proposal: EnhancedHookProposal) => {
    const record: ScriptEditRecord = {
      id: `enhance_${Date.now()}`,
      timestamp: new Date().toISOString().slice(11, 19),
      instruction: `强化钩子与滑梯润色（${proposal.hookStyle}）`,
      original: scriptContent.slice(0, 100) + '...',
      replacement: proposal.openingHookText,
    };

    onUpdateProject((prev) => ({
      ...prev,
      stage2: {
        ...prev.stage2,
        scriptContent: proposal.fullPolishedScript,
        editHistory: [record, ...prev.stage2.editHistory].slice(0, 12),
      },
    }));

    setHookProposals(null);
  };

  const handleCaptureSelection = () => {
    const el = textareaRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (end <= start) {
      return;
    }

    const selectedText = el.value.slice(start, end);
    if (!selectedText.trim()) return;

    const coords = getTextareaSelectionTopCoords(el, start);
    const maxLeft = Math.max(16, container.clientWidth - 436);
    const clampedLeft = Math.max(16, Math.min(coords.left, maxLeft));
    const placeBelow = coords.top < 115;
    const anchorTop = placeBelow ? coords.top + 30 : coords.top - 10;

    setSelection({
      start,
      end,
      text: selectedText,
      anchorTop,
      anchorLeft: clampedLeft,
      placeBelow,
    });
    setProposedReplacement(null);
  };

  const handleRunInlineRewrite = async (customInstruction?: string) => {
    if (!selection) return;
    const instr = (customInstruction ?? inlineInstruction).trim();
    if (!instr || isRewritingSpan) return;

    setInlineInstruction(instr);
    setIsRewritingSpan(true);

    try {
      const replacement = await runInlineEdit({
        fullScript: scriptContent,
        selectedText: selection.text,
        instruction: instr,
        platform: project.platform,
      });

      setProposedReplacement(replacement);
    } catch (err) {
      onError(formatFriendlyErrorMessage(err, '局部微调请求失败'));
    } finally {
      setIsRewritingSpan(false);
    }
  };

  const handleApplyReplacement = () => {
    if (!selection || proposedReplacement === null) return;
    try {
      const { updatedScript } = applyInlineEdit(
        scriptContent,
        selection.start,
        selection.end,
        proposedReplacement
      );

      const record: ScriptEditRecord = {
        id: `edit_${Date.now()}`,
        timestamp: new Date().toISOString().slice(11, 19),
        instruction: inlineInstruction,
        original: selection.text,
        replacement: proposedReplacement,
      };

      onUpdateProject((prev) => ({
        ...prev,
        stage2: {
          ...prev.stage2,
          scriptContent: updatedScript,
          editHistory: [record, ...prev.stage2.editHistory].slice(0, 12),
        },
      }));

      setSelection(null);
      setProposedReplacement(null);
      setInlineInstruction('');
    } catch (err) {
      onError(formatFriendlyErrorMessage(err, '替换失败'));
    }
  };

  const handleUndoLastEdit = () => {
    const latest = editHistory[0];
    if (!latest) return;
    const idx = scriptContent.indexOf(latest.replacement);
    if (idx === -1) {
      onError('未能定位上次替换文本（脚本已被手动大幅修改），无法自动撤销');
      return;
    }
    const restored =
      scriptContent.slice(0, idx) +
      latest.original +
      scriptContent.slice(idx + latest.replacement.length);

    onUpdateProject((prev) => ({
      ...prev,
      stage2: {
        ...prev.stage2,
        scriptContent: restored,
        editHistory: prev.stage2.editHistory.slice(1),
      },
    }));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#1D1F22]">
      {/* Top Brief Inheritance Strip */}
      <div className="border-b border-[#EAE5DE]/[0.08] bg-[#24272B]/90 px-6 py-3">
        <div className="mx-auto max-w-[960px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="h-4 w-4 text-[#D0B49F] shrink-0" aria-hidden="true" />
              <span className="text-sm font-semibold text-[#E6E1DA] whitespace-nowrap">
                {t('stage2.briefTitle')}
              </span>
              {brief ? (
                <span className="text-xs text-[#B7B1A8] truncate max-w-[420px]">
                  {t('stage2.locked')}
                  <span className="text-[#DFC5B0] font-medium">{brief.branchTitle}</span>
                </span>
              ) : (
                <span className="text-xs text-[#DFC5B0]">{t('stage2.notLocked')}</span>
              )}
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {brief ? (
                <>
                  <button
                    type="button"
                    onClick={() => setBriefExpanded((v) => !v)}
                    className="flex items-center gap-1 rounded-lg border border-[#EAE5DE]/[0.09] px-2.5 py-1.5 text-xs text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.05] hover:text-[#E6E1DA] whitespace-nowrap"
                  >
                    <span>
                      {briefExpanded ? t('stage2.collapseBrief') : t('stage2.expandBrief')}
                    </span>
                    {briefExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateFromBrief}
                    disabled={isGeneratingScript}
                    className="flex items-center gap-1.5 rounded-lg bg-[#B89882] px-3.5 py-1.5 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792] disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {isGeneratingScript
                        ? t('stage2.generating')
                        : scriptContent.trim()
                        ? t('stage2.regenerateBtn')
                        : t('stage2.generateBtn')}
                    </span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onGoToStage1}
                  className="rounded-lg border border-[#B89882]/45 bg-[#B89882]/14 px-3 py-1.5 text-xs font-medium text-[#DFC5B0] hover:bg-[#B89882]/24"
                >
                  {t('stage2.goToStage1')}
                </button>
              )}
            </div>
          </div>

          {brief && briefExpanded && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-[#EAE5DE]/[0.07] pt-3 text-xs">
              <div className="md:col-span-2 space-y-1">
                <div className="text-[#B7B1A8]">
                  <span className="text-[#8B857C]">{t('stage2.coreThesis')}</span>
                  <span className="text-[#E6E1DA]">{brief.coreThesis}</span>
                </div>
                <div className="text-[#B7B1A8]">
                  <span className="text-[#8B857C]">{t('stage2.hookStrategy')}</span>
                  <span className="text-[#DFC5B0]">{brief.hookStrategy}</span>
                </div>
              </div>
              <div className="text-[#B7B1A8] border-l border-[#EAE5DE]/[0.07] pl-3">
                <span className="text-[#D19A97] font-medium">{t('stage2.riskNotes')}</span>
                <p className="mt-0.5 text-[#B7B1A8] line-clamp-3">{brief.riskNotes}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Central Rich Script Editor Canvas */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex h-full max-w-[960px] flex-col gap-3">
          {/* 3 Script Candidates Selector Bar (Strictly referencing Rule Handbook) */}
          {candidateScripts && candidateScripts.length > 0 && (
            <div className="rounded-xl border border-[#B89882]/25 bg-[#24272B]/80 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#DFC5B0]">
                  <Layers className="h-3.5 w-3.5 text-[#B89882]" />
                  <span>{t('stage2.candidateTitle')}</span>
                </div>
                <span className="text-[11px] text-[#8B857C]">{t('stage2.clickToLoad')}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {candidateScripts.map((cand) => {
                  const isCurrent = activeCandidateId === cand.id;
                  return (
                    <button
                      key={cand.id}
                      type="button"
                      onClick={() => handleApplyCandidate(cand)}
                      className={`flex flex-col text-left rounded-lg p-2.5 border transition-all ${
                        isCurrent
                          ? 'border-[#B89882] bg-[#B89882]/15 shadow-sm'
                          : 'border-[#EAE5DE]/[0.08] bg-[#1D1F22] hover:border-[#B89882]/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 w-full">
                        <span className="text-xs font-medium text-[#E6E1DA] truncate">
                          {cand.versionName}
                        </span>
                        {isCurrent && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-[#DFC5B0] shrink-0" />
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                        <span className="rounded bg-[#EAE5DE]/[0.08] px-1.5 py-0.5 text-[#DFC5B0]">
                          {cand.hookType}
                        </span>
                        <span className="text-[#8B857C]">{cand.estimatedDuration}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#B7B1A8] line-clamp-1">
                        {cand.highlight}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Editor Meta Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs text-[#B7B1A8] tabular-nums">
              <span className="font-medium text-[#E6E1DA]">{t('stage2.editorTitle')}</span>
              <span aria-hidden="true">·</span>
              <span>{t('stage2.wordCount', { count: charCount })}</span>
              <span aria-hidden="true">·</span>
              <span>{t('stage2.estSeconds', { seconds: estSeconds })}</span>
              <span aria-hidden="true">·</span>
              <span className="text-[#D0B49F]">{t('stage2.selectionTip')}</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* "强化钩子" Button */}
              <button
                type="button"
                onClick={handleTriggerEnhanceHook}
                disabled={isEnhancingHook || !scriptContent.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-[#DFC5B0]/50 bg-[#DFC5B0]/15 px-3 py-1.5 text-xs font-semibold text-[#DFC5B0] hover:bg-[#DFC5B0]/25 disabled:opacity-40 transition-colors whitespace-nowrap shadow-sm"
              >
                <Zap className="h-3.5 w-3.5 shrink-0 text-[#DFC5B0]" aria-hidden="true" />
                <span>
                  {isEnhancingHook ? t('stage2.enhancingHook') : t('stage2.enhanceHookBtn')}
                </span>
              </button>

              {editHistory.length > 0 && (
                <button
                  type="button"
                  onClick={handleUndoLastEdit}
                  className="flex items-center gap-1 rounded-lg border border-[#EAE5DE]/[0.1] px-2.5 py-1.5 text-xs text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.05] hover:text-[#E6E1DA] whitespace-nowrap"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('stage2.undoEdit')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={onProceedToStage3}
                disabled={!scriptContent.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-[#879B8D]/45 bg-[#879B8D]/14 px-3.5 py-1.5 text-xs font-semibold text-[#AFC2B4] hover:bg-[#879B8D]/24 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                <span>{t('stage2.proceedStage3')}</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Relative Container holding Textarea + Floating Inline Edit Popover */}
          <div
            ref={containerRef}
            className="relative flex-1 min-h-[380px] rounded-xl border border-[#EAE5DE]/[0.1] bg-[#24272B] overflow-hidden"
          >
            <textarea
              ref={textareaRef}
              aria-label="口播脚本正文编辑器"
              value={scriptContent}
              onChange={(e) => {
                const nextVal = e.target.value;
                onUpdateProject((prev) => ({
                  ...prev,
                  stage2: {
                    ...prev.stage2,
                    scriptContent: nextVal,
                  },
                }));
              }}
              onMouseUp={handleCaptureSelection}
              onKeyUp={handleCaptureSelection}
              onMouseDown={() => {
                if (selection) {
                  setSelection(null);
                  setProposedReplacement(null);
                }
              }}
              placeholder={t('stage2.placeholder')}
              className="h-full w-full resize-none bg-transparent px-7 pt-7 pb-16 text-[15px] leading-[1.85] text-[#E6E1DA] placeholder:text-[#8B857C] focus:outline-none"
            />

            {/* Floating Inline Edit Command Bar above selection */}
            {selection && (
              <div
                role="dialog"
                aria-label={t('stage2.inlineEditTitle')}
                style={{
                  top: `${selection.anchorTop}px`,
                  left: `${selection.anchorLeft}px`,
                  transform: selection.placeBelow ? 'none' : 'translateY(-100%)',
                }}
                className="absolute z-30 w-[420px] max-w-[calc(100%-32px)] rounded-xl border border-[#B89882]/45 bg-[#2B2E33] p-3 shadow-2xl"
              >
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#EAE5DE]/[0.08]">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#DFC5B0]">
                    <Wand2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{t('stage2.inlineEditTitle')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelection(null);
                      setProposedReplacement(null);
                    }}
                    aria-label={t('common.close')}
                    className="rounded p-1 text-[#B7B1A8] hover:bg-[#EAE5DE]/10 hover:text-[#E6E1DA]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Selected excerpt preview */}
                <div className="mt-2 rounded-md bg-[#191B1E] px-2.5 py-1.5 text-xs text-[#B7B1A8] line-clamp-2 border border-[#EAE5DE]/[0.07]">
                  {t('stage2.selectedText')}{selection.text}
                </div>

                {/* Quick instruction buttons */}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {quickInstructions.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleRunInlineRewrite(chip)}
                      disabled={isRewritingSpan}
                      className="rounded-md border border-[#EAE5DE]/[0.1] bg-[#24272B] px-2 py-1 text-[11px] text-[#E6E1DA] hover:border-[#B89882]/50 hover:text-[#DFC5B0] transition-colors"
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                {/* Instruction Input */}
                <div className="mt-2.5 flex items-center gap-2">
                  <input
                    type="text"
                    value={inlineInstruction}
                    onChange={(e) => setInlineInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleRunInlineRewrite();
                      }
                    }}
                    placeholder={t('stage2.inlinePromptPlaceholder')}
                    className="flex-1 rounded-lg border border-[#EAE5DE]/[0.12] bg-[#191B1E] px-3 py-1.5 text-xs text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => handleRunInlineRewrite()}
                    disabled={isRewritingSpan || !inlineInstruction.trim()}
                    className="rounded-lg bg-[#B89882] px-3 py-1.5 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792] disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    {isRewritingSpan ? t('stage2.rewriting') : t('stage2.generateRewrite')}
                  </button>
                </div>

                {/* Replacement Preview & One-Click Replace */}
                {proposedReplacement !== null && (
                  <div className="mt-3 rounded-lg border border-[#879B8D]/40 bg-[#879B8D]/14 p-2.5 space-y-2">
                    <div className="text-[11px] font-medium text-[#AFC2B4]">
                      {t('stage2.inlineResult')}
                    </div>
                    <p className="text-xs text-[#E6E1DA] leading-relaxed whitespace-pre-wrap">
                      {proposedReplacement}
                    </p>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setProposedReplacement(null)}
                        className="rounded-md px-2.5 py-1 text-xs text-[#B7B1A8] hover:text-[#E6E1DA]"
                      >
                        {t('common.discard')}
                      </button>
                      <button
                        type="button"
                        onClick={handleApplyReplacement}
                        className="flex items-center gap-1 rounded-md bg-[#879B8D] px-3 py-1 text-xs font-semibold text-[#101913] hover:bg-[#97AA9D]"
                      >
                        <Check className="h-3 w-3" />
                        <span>{t('stage2.applyReplace')}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* "强化钩子" Proposals Modal */}
      {hookProposals && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="flex flex-col max-h-[90vh] w-full max-w-[880px] rounded-2xl border border-[#DFC5B0]/40 bg-[#24272B] shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#EAE5DE]/[0.08] bg-[#1D1F22] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#DFC5B0]/20 text-[#DFC5B0]">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#E6E1DA]">
                    {t('stage2.hookEnhanceModalTitle')}
                  </h3>
                  <p className="text-xs text-[#8B857C]">
                    {t('stage2.hookEnhanceModalDesc')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHookProposals(null)}
                className="rounded-lg p-1.5 text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.08] hover:text-[#E6E1DA]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body: 3 Proposal Tabs & Preview */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Proposal Selector Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {hookProposals.map((prop) => {
                  const isSelected = selectedProposalId === prop.id;
                  return (
                    <button
                      key={prop.id}
                      type="button"
                      onClick={() => setSelectedProposalId(prop.id)}
                      className={`text-left rounded-xl p-3 border transition-all ${
                        isSelected
                          ? 'border-[#DFC5B0] bg-[#DFC5B0]/15 shadow-md'
                          : 'border-[#EAE5DE]/[0.08] bg-[#1D1F22] hover:border-[#DFC5B0]/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#E6E1DA]">
                          {prop.hookStyle}
                        </span>
                        {isSelected && <Check className="h-3.5 w-3.5 text-[#DFC5B0]" />}
                      </div>
                      <p className="mt-2 text-xs font-medium text-[#DFC5B0] line-clamp-2 leading-relaxed">
                        “{prop.openingHookText}”
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Selected Proposal Detailed View */}
              {(() => {
                const activeProp =
                  hookProposals.find((p) => p.id === selectedProposalId) || hookProposals[0];
                if (!activeProp) return null;

                return (
                  <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#DFC5B0] uppercase tracking-wide">
                        {activeProp.hookStyle}
                      </span>
                      <span className="text-[11px] text-[#8B857C]">
                        {t('stage2.hookStandard')}
                      </span>
                    </div>

                    <div className="rounded-lg border border-[#DFC5B0]/30 bg-[#DFC5B0]/10 p-3.5">
                      <div className="text-xs text-[#DFC5B0] font-semibold mb-1">
                        {t('stage2.enhancedHook')}
                      </div>
                      <p className="text-sm font-medium text-[#E6E1DA] leading-relaxed">
                        {activeProp.openingHookText}
                      </p>
                      <div className="mt-2 text-xs text-[#B7B1A8] border-t border-[#DFC5B0]/20 pt-2">
                        <span className="text-[#8B857C]">{t('stage2.hookAnalysis')}</span>
                        {activeProp.hookAnalysis}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-medium text-[#B7B1A8] mb-1.5">
                        {t('stage2.scriptPreview')}
                      </div>
                      <div className="rounded-lg border border-[#EAE5DE]/[0.08] bg-[#24272B] p-4 text-xs text-[#E6E1DA] leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto">
                        {activeProp.fullPolishedScript}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setHookProposals(null)}
                        className="rounded-lg px-4 py-2 text-xs text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.06] hover:text-[#E6E1DA]"
                      >
                        {t('common.discard')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyEnhancedProposal(activeProp)}
                        className="flex items-center gap-1.5 rounded-lg bg-[#DFC5B0] px-5 py-2 text-xs font-semibold text-[#1B1715] hover:bg-[#EBD5C2] shadow-md transition-colors"
                      >
                        <Check className="h-4 w-4" />
                        <span>{t('stage2.applyEnhance')}</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
