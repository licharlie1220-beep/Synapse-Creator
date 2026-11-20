import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  ExternalLink,
  FileText,
  Film,
  GitBranch,
  Globe,
  Image as ImageIcon,
  Lock,
  Paperclip,
  Plus,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import { runBrainstorm, runBranchChat, runRiskAudit } from '../services/geminiClient';
import { useI18n } from '../i18n';
import type {
  AttachmentKind,
  BrainstormAttachmentMeta,
  BrainstormAttachmentPayload,
  BrainstormDirection,
  BranchTab,
  MainChatMessage,
  Project,
  SaveDestinationConfig,
} from '../types/workspace';
import { formatFileSize, formatFriendlyErrorMessage } from '../utils/workflow';

interface Stage1BrainstormProps {
  project: Project;
  onUpdateProject: (updater: (prev: Project) => Project) => void;
  onHandoffToStage2: (branch: BranchTab) => void;
  onError: (msg: string) => void;
}

export const Stage1Brainstorm: React.FC<Stage1BrainstormProps> = ({
  project,
  onUpdateProject,
  onHandoffToStage2,
  onError,
}) => {
  const { t } = useI18n();
  const [mainInput, setMainInput] = useState('');
  const [isBrainstorming, setIsBrainstorming] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<BrainstormAttachmentPayload[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [branchInput, setBranchInput] = useState('');
  const [isBranchReplying, setIsBranchReplying] = useState(false);

  const [isAuditing, setIsAuditing] = useState(false);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);

  const { searchGroundingEnabled, messages, branches, activeBranchId, riskAudit } = project.stage1;
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;

  const toggleSearchGrounding = () => {
    onUpdateProject((prev) => ({
      ...prev,
      stage1: {
        ...prev.stage1,
        searchGroundingEnabled: !prev.stage1.searchGroundingEnabled,
      },
    }));
  };

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        reader.onload = null;
        reader.onerror = null;
        const result = String(reader.result || '');
        const commaIdx = result.indexOf(',');
        resolve(commaIdx !== -1 ? result.slice(commaIdx + 1) : result);
      };
      reader.onerror = () => {
        reader.onload = null;
        reader.onerror = null;
        reject(new Error(`读取文件「${file.name}」失败`));
      };
      reader.readAsDataURL(file);
    });

  const handleSelectFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (fileList.length === 0) return;

    const MAX_FILE_BYTES = 20 * 1024 * 1024;
    const loaded: BrainstormAttachmentPayload[] = [];

    for (const file of fileList.slice(0, 3 - pendingFiles.length)) {
      if (file.size > MAX_FILE_BYTES) {
        onError(`文件「${file.name}」超过 20MB 限制，请裁剪或压缩后再投喂。`);
        continue;
      }

      const lowerName = file.name.toLowerCase();
      const isText =
        file.type.startsWith('text/') ||
        /\.(txt|md|markdown|csv|json|srt|vtt|log)$/i.test(lowerName);
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');

      if (!isText && !isImage && !isVideo) {
        onError(`暂不支持文件「${file.name}」格式，请上传文本(.txt/.md/.csv/.json)、图片或视频文件。`);
        continue;
      }

      const kind: AttachmentKind = isText ? 'text' : isImage ? 'image' : 'video';
      try {
        if (kind === 'text') {
          const textContent = await file.text();
          loaded.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            mimeType: file.type || 'text/plain',
            kind,
            sizeBytes: file.size,
            textContent: textContent.slice(0, 30000),
          });
        } else {
          const base64Data = await readFileAsBase64(file);
          loaded.push({
            id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            mimeType: file.type || (kind === 'image' ? 'image/png' : 'video/mp4'),
            kind,
            sizeBytes: file.size,
            base64Data,
          });
        }
      } catch (err) {
        onError(formatFriendlyErrorMessage(err, `读取文件「${file.name}」失败`));
      }
    }

    if (loaded.length > 0) {
      setPendingFiles((prev) => [...prev, ...loaded].slice(0, 3));
    }
  };

  const handleMainSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasFiles = pendingFiles.length > 0;
    const rawText = mainInput.trim();
    if ((!rawText && !hasFiles) || isBrainstorming) return;

    const effectivePrompt =
      rawText ||
      `请分析我传入的参考文件（${pendingFiles.map((f) => f.name).join('、')}），拆解其选题结构与爆点，并生成 3-4 个相似或微调后的创作方向。`;

    const attachmentMeta: BrainstormAttachmentMeta[] = pendingFiles.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      kind: f.kind,
      sizeBytes: f.sizeBytes,
    }));

    const filesToSend = [...pendingFiles];
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const userMsg: MainChatMessage = {
      id: `mmsg_${Date.now()}`,
      role: 'user',
      content: effectivePrompt,
      attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,
      timestamp: nowStr,
    };

    onUpdateProject((prev) => ({
      ...prev,
      stage1: {
        ...prev.stage1,
        messages: [...prev.stage1.messages, userMsg],
      },
    }));
    setMainInput('');
    setPendingFiles([]);
    setIsBrainstorming(true);

    try {
      const data = await runBrainstorm({
        projectName: project.name,
        platform: project.platform,
        topic: project.topic,
        userMessage: effectivePrompt,
        history: messages.map((m) => ({ role: m.role, content: m.content })),
        searchGrounding: searchGroundingEnabled,
        attachments: filesToSend.length > 0 ? filesToSend : undefined,
      });

      const assistantMsg: MainChatMessage = {
        id: `mmsg_${Date.now() + 1}`,
        role: 'assistant',
        content: data.reply,
        directions: data.directions,
        groundingSources: data.groundingSources,
        timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
      };

      onUpdateProject((prev) => ({
        ...prev,
        stage1: {
          ...prev.stage1,
          messages: [...prev.stage1.messages, assistantMsg],
        },
      }));
    } catch (err) {
      onError(formatFriendlyErrorMessage(err, '策划脑暴请求失败'));
    } finally {
      setIsBrainstorming(false);
    }
  };

  const handleExpandBranch = (direction: BrainstormDirection) => {
    onUpdateProject((prev) => {
      const existing = prev.stage1.branches.find((b) => b.directionId === direction.id);
      if (existing) {
        return {
          ...prev,
          stage1: {
            ...prev.stage1,
            activeBranchId: existing.id,
          },
        };
      }

      const newBranch: BranchTab = {
        id: `branch_${direction.id}_${Date.now()}`,
        directionId: direction.id,
        title: direction.title,
        initialAngle: direction.angle,
        initialHook: direction.hook,
        coreConclusion: `${direction.title}：${direction.angle}\n前3秒钩子：${direction.hook}`,
        messages: [
          {
            id: `bmsg_${Date.now()}`,
            role: 'assistant',
            timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
            content: [
              `已开启隔离分支：**${direction.title}**`,
              ``,
              `• 切入角度：${direction.angle}`,
              `• 前3秒钩子：${direction.hook}`,
              `• 目标受众：${direction.audience}`,
              direction.verifiedFacts ? `• 检索事实：${direction.verifiedFacts}` : '',
              ``,
              `请在此继续追问细节、补充论据或打磨开场前三秒，不会干扰主对话与其他分支。`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };

      return {
        ...prev,
        stage1: {
          ...prev.stage1,
          branches: [...prev.stage1.branches, newBranch],
          activeBranchId: newBranch.id,
        },
      };
    });
    setShowAuditDrawer(false);
  };

  const handleCloseBranch = (branchId: string) => {
    onUpdateProject((prev) => {
      const remaining = prev.stage1.branches.filter((b) => b.id !== branchId);
      const nextActive =
        prev.stage1.activeBranchId === branchId
          ? remaining[remaining.length - 1]?.id ?? null
          : prev.stage1.activeBranchId;
      return {
        ...prev,
        stage1: {
          ...prev.stage1,
          branches: remaining,
          activeBranchId: nextActive,
        },
      };
    });
  };

  const handleBranchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBranch) return;
    const trimmed = branchInput.trim();
    if (!trimmed || isBranchReplying) return;

    const userMsg = {
      id: `bmsg_${Date.now()}`,
      role: 'user' as const,
      content: trimmed,
      timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };

    const targetBranchId = activeBranch.id;

    onUpdateProject((prev) => ({
      ...prev,
      stage1: {
        ...prev.stage1,
        branches: prev.stage1.branches.map((b) =>
          b.id === targetBranchId ? { ...b, messages: [...b.messages, userMsg] } : b
        ),
      },
    }));

    setBranchInput('');
    setIsBranchReplying(true);

    try {
      const data = await runBranchChat({
        projectName: project.name,
        platform: project.platform,
        topic: project.topic,
        branchTitle: activeBranch.title,
        initialAngle: activeBranch.initialAngle,
        initialHook: activeBranch.initialHook,
        messages: activeBranch.messages.map((m) => ({ role: m.role, content: m.content })),
        userMessage: trimmed,
        searchGrounding: searchGroundingEnabled,
      });

      const assistantMsg = {
        id: `bmsg_${Date.now() + 1}`,
        role: 'assistant' as const,
        content: data.reply,
        groundingSources: data.groundingSources,
        timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
      };

      onUpdateProject((prev) => ({
        ...prev,
        stage1: {
          ...prev.stage1,
          branches: prev.stage1.branches.map((b) =>
            b.id === targetBranchId
              ? {
                  ...b,
                  messages: [...b.messages, assistantMsg],
                  coreConclusion: data.suggestedConclusion || b.coreConclusion,
                }
              : b
          ),
        },
      }));
    } catch (err) {
      onError(formatFriendlyErrorMessage(err, '分支深挖请求失败'));
    } finally {
      setIsBranchReplying(false);
    }
  };

  const handleRunRiskAudit = async () => {
    setShowAuditDrawer(true);
    if (isAuditing) return;
    setIsAuditing(true);

    try {
      const allDirections = messages.flatMap((m) => m.directions ?? []);
      const audit = await runRiskAudit({
        projectName: project.name,
        platform: project.platform,
        topic: project.topic,
        activeBranch: activeBranch
          ? {
              title: activeBranch.title,
              coreConclusion: activeBranch.coreConclusion,
              initialHook: activeBranch.initialHook,
            }
          : null,
        directions: allDirections,
        searchGrounding: searchGroundingEnabled,
      });

      onUpdateProject((prev) => ({
        ...prev,
        stage1: {
          ...prev.stage1,
          riskAudit: audit,
        },
      }));
    } catch (err) {
      onError(formatFriendlyErrorMessage(err, '风险体检失败'));
    } finally {
      setIsAuditing(false);
    }
  };

  const hasRightPane = branches.length > 0 || showAuditDrawer;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#1D1F22]">
      {/* Stage 1 Sub-Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#EAE5DE]/[0.08] bg-[#24272B]/90 px-5 py-2.5">
        <div className="flex items-center gap-4 min-w-0">
          <div className="text-xs text-[#B7B1A8] truncate max-w-[460px]">
            <span className="text-[#8B857C]">{t('stage1.currentTopic')}</span>
            <span className="text-[#E6E1DA] font-medium">{project.topic}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Search Grounding Toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={searchGroundingEnabled}
            onClick={toggleSearchGrounding}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              searchGroundingEnabled
                ? 'border-[#879B8D]/45 bg-[#879B8D]/14 text-[#AFC2B4]'
                : 'border-[#EAE5DE]/[0.1] bg-[#2B2E33] text-[#B7B1A8] hover:text-[#E6E1DA]'
            }`}
          >
            <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t('stage1.searchGrounding')}</span>
            <span className="font-mono text-[11px]">
              {searchGroundingEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Persistent Risk & Logic Audit Button */}
          <button
            type="button"
            onClick={handleRunRiskAudit}
            disabled={isAuditing}
            className="flex items-center gap-1.5 rounded-lg border border-[#C48B88]/45 bg-[#C48B88]/12 px-3.5 py-1.5 text-xs font-semibold text-[#DFB2AF] hover:bg-[#C48B88]/22 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{isAuditing ? t('stage1.auditing') : t('stage1.riskAuditBtn')}</span>
          </button>
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Main Brainstorm Dialogue + Direction Cards */}
        <section
          aria-label={t('nav.stage1_short')}
          className={`flex flex-col min-w-0 transition-all ${
            hasRightPane ? 'w-1/2 border-r border-[#EAE5DE]/[0.08]' : 'w-full max-w-4xl mx-auto'
          }`}
        >
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center px-6 py-12">
                <GitBranch className="h-9 w-9 text-[#D0B49F]/80 mb-3" aria-hidden="true" />
                <h2 className="text-base font-semibold text-[#E6E1DA]">
                  {t('stage1.introTitle')}
                </h2>
                <p className="mt-2 max-w-md text-sm text-[#B7B1A8] leading-relaxed">
                  {t('stage1.introDesc')}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      setMainInput(
                        `围绕选题「${project.topic}」，帮我拆解 3-4 个最具网感和传播潜力的短视频切入方向。`
                      )
                    }
                    className="rounded-lg border border-[#B89882]/45 bg-[#B89882]/14 px-4 py-2 text-xs font-medium text-[#DFC5B0] hover:bg-[#B89882]/24 transition-colors"
                  >
                    {t('stage1.quickStart')}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border border-[#EAE5DE]/[0.14] bg-[#2B2E33] px-4 py-2 text-xs font-medium text-[#E6E1DA] hover:border-[#B89882]/50 hover:text-[#DFC5B0] transition-colors"
                  >
                    <Paperclip className="h-3.5 w-3.5 text-[#D0B49F]" aria-hidden="true" />
                    <span>{t('stage1.feedLocalFile')}</span>
                  </button>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-[#8B857C] tabular-nums">
                    <span>{msg.role === 'user' ? t('common.creator') : t('stage1.director')}</span>
                    <span aria-hidden="true">·</span>
                    <span>{msg.timestamp}</span>
                  </div>

                  <div
                    className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'max-w-[85%] bg-[#2B2E33] text-[#E6E1DA] border border-[#EAE5DE]/[0.09]'
                        : 'w-full bg-[#24272B] text-[#E6E1DA] border border-[#EAE5DE]/[0.08]'
                    }`}
                  >
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mb-2.5 flex flex-wrap gap-2 border-b border-[#EAE5DE]/[0.08] pb-2">
                        {msg.attachments.map((att) => (
                          <div
                            key={att.id}
                            className="flex items-center gap-1.5 rounded-md border border-[#EAE5DE]/[0.1] bg-[#1D1F22] px-2.5 py-1 text-xs text-[#E6E1DA]"
                          >
                            {att.kind === 'image' ? (
                              <ImageIcon className="h-3.5 w-3.5 text-[#D0B49F] shrink-0" />
                            ) : att.kind === 'video' ? (
                              <Film className="h-3.5 w-3.5 text-[#A3B8A9] shrink-0" />
                            ) : (
                              <FileText className="h-3.5 w-3.5 text-[#9EB2C0] shrink-0" />
                            )}
                            <span className="truncate max-w-[180px]">{att.name}</span>
                            <span className="text-[11px] text-[#8B857C] tabular-nums">
                              · {formatFileSize(att.sizeBytes)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap">{msg.content}</p>

                    {/* Grounding Sources */}
                    {msg.groundingSources && msg.groundingSources.length > 0 && (
                      <div className="mt-3 border-t border-[#EAE5DE]/[0.07] pt-2.5">
                        <div className="text-[11px] font-medium text-[#A3B8A9] mb-1.5">
                          {t('stage1.groundingSources')}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {msg.groundingSources.map((src) => (
                            <a
                              key={src.uri}
                              href={src.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-[#B7B1A8] hover:text-[#DFC5B0] underline decoration-[#EAE5DE]/20 underline-offset-2"
                            >
                              <span className="truncate max-w-[260px]">{src.title}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 3-4 Direction Cards */}
                    {msg.directions && msg.directions.length > 0 && (
                      <div className="mt-4 grid grid-cols-1 gap-3">
                        {msg.directions.map((dir) => {
                          const isOpened = branches.some((b) => b.directionId === dir.id);
                          return (
                            <div
                              key={dir.id}
                              className="flex flex-col justify-between rounded-lg border border-[#EAE5DE]/[0.09] bg-[#1D1F22] p-4 hover:border-[#EAE5DE]/[0.18] transition-colors"
                            >
                              <div>
                                <div className="flex items-start justify-between gap-3">
                                  <h3 className="text-sm font-semibold text-[#DFC5B0]">
                                    {dir.title}
                                  </h3>
                                  <span className="text-[11px] text-[#8B857C] whitespace-nowrap shrink-0">
                                    {dir.audience}
                                  </span>
                                </div>
                                <p className="mt-2 text-xs text-[#E6E1DA]/90 leading-relaxed">
                                  {dir.angle}
                                </p>
                                <p className="mt-2 text-xs text-[#B7B1A8]">
                                  <span className="text-[#8B857C]">{t('stage1.hook')}</span>
                                  {dir.hook}
                                </p>
                                {dir.verifiedFacts && (
                                  <p className="mt-2 text-xs text-[#AFC2B4]">
                                    <span className="text-[#879B8D]">{t('stage1.verifiedFacts')}</span>
                                    {dir.verifiedFacts}
                                  </p>
                                )}
                              </div>

                              <div className="mt-3 flex justify-end pt-2 border-t border-[#EAE5DE]/[0.06]">
                                <button
                                  type="button"
                                  onClick={() => handleExpandBranch(dir)}
                                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                                    isOpened
                                      ? 'bg-[#B89882]/16 text-[#DFC5B0] border border-[#B89882]/40'
                                      : 'bg-[#2B2E33] text-[#E6E1DA] hover:bg-[#B89882] hover:text-[#1B1715]'
                                  }`}
                                >
                                  <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>{isOpened ? t('stage1.switchToBranch') : t('stage1.expandBranch')}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {isBrainstorming && (
              <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#24272B] p-4 text-xs text-[#B7B1A8]">
                {t('stage1.brainstorming')}
              </div>
            )}
          </div>

          {/* Main Brainstorm Composer */}
          <form
            onSubmit={handleMainSubmit}
            className="border-t border-[#EAE5DE]/[0.08] bg-[#24272B] p-3.5 space-y-2.5"
          >
            {/* Pending Uploaded or Cloud Reference Files */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {pendingFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 rounded-lg border border-[#B89882]/35 bg-[#2B2E33] px-2.5 py-1.5 text-xs text-[#E6E1DA]"
                  >
                    {file.kind === 'image' ? (
                      <ImageIcon className="h-3.5 w-3.5 text-[#D0B49F] shrink-0" />
                    ) : file.kind === 'video' ? (
                      <Film className="h-3.5 w-3.5 text-[#A3B8A9] shrink-0" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 text-[#9EB2C0] shrink-0" />
                    )}
                    <span className="truncate max-w-[180px]">{file.name}</span>
                    <span className="text-[11px] text-[#8B857C] tabular-nums">
                      {formatFileSize(file.sizeBytes)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingFiles((prev) => prev.filter((item) => item.id !== file.id))
                      }
                      aria-label={`移除参考文件 ${file.name}`}
                      className="rounded p-0.5 text-[#8B857C] hover:bg-[#EAE5DE]/10 hover:text-[#DFB2AF]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setMainInput(
                      t('stage1.feedPromptHelper')
                    )
                  }
                  className="rounded-md border border-[#EAE5DE]/[0.1] bg-[#2B2E33] px-2.5 py-1 text-[11px] text-[#DFC5B0] hover:border-[#B89882]/45"
                >
                  {t('stage1.feedHelperBtn')}
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              aria-label="Upload reference files"
              accept=".txt,.md,.markdown,.csv,.json,.srt,.vtt,text/*,image/*,video/*"
              onChange={(e) => void handleSelectFiles(e)}
              className="hidden"
            />

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBrainstorming || pendingFiles.length >= 3}
                aria-label={t('stage1.feedBtn')}
                className="flex h-10 items-center gap-1.5 rounded-lg border border-[#EAE5DE]/[0.12] bg-[#2B2E33] px-3 text-xs font-medium text-[#E6E1DA] hover:border-[#B89882]/50 hover:text-[#DFC5B0] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Paperclip className="h-3.5 w-3.5 text-[#D0B49F] shrink-0" aria-hidden="true" />
                <span>{t('stage1.feedBtn')}</span>
              </button>

              <textarea
                rows={2}
                value={mainInput}
                onChange={(e) => setMainInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleMainSubmit(e);
                  }
                }}
                placeholder={t('stage1.placeholder')}
                className="flex-1 rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3.5 py-2.5 text-sm text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none resize-none"
              />
              <button
                type="submit"
                disabled={isBrainstorming || (!mainInput.trim() && pendingFiles.length === 0)}
                aria-label={t('stage1.sendBtn')}
                className="flex h-10 items-center gap-1.5 rounded-lg bg-[#B89882] px-4 text-sm font-semibold text-[#1B1715] hover:bg-[#C5A792] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t('stage1.sendBtn')}</span>
              </button>
            </div>
          </form>
        </section>

        {/* Right: Isolated Branch Sub-Tabs OR Risk & Logic Audit Panel */}
        {hasRightPane && (
          <section
            aria-label="分支深挖与风险体检工作区"
            className="flex w-1/2 min-w-0 flex-col bg-[#212428]"
          >
            {/* Right Pane Tab Bar (Isolated Branches + Risk Audit View Switch) */}
            <div className="flex items-center justify-between border-b border-[#EAE5DE]/[0.08] bg-[#24272B] px-3 py-2 gap-2">
              <div
                role="tablist"
                aria-label="独立策划分支标签页"
                className="flex items-center gap-1.5 overflow-x-auto min-w-0"
              >
                {branches.map((branch) => {
                  const isSelected = !showAuditDrawer && branch.id === activeBranchId;
                  return (
                    <div
                      key={branch.id}
                      className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors shrink-0 ${
                        isSelected
                          ? 'border-[#B89882]/50 bg-[#B89882]/15 text-[#DFC5B0]'
                          : 'border-[#EAE5DE]/[0.08] bg-[#2B2E33] text-[#B7B1A8] hover:text-[#E6E1DA]'
                      }`}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        onClick={() => {
                          setShowAuditDrawer(false);
                          onUpdateProject((prev) => ({
                            ...prev,
                            stage1: { ...prev.stage1, activeBranchId: branch.id },
                          }));
                        }}
                        className="flex items-center gap-1.5 max-w-[160px] truncate whitespace-nowrap"
                      >
                        {branch.isLocked && (
                          <Lock className="h-3 w-3 text-[#A3B8A9] shrink-0" aria-hidden="true" />
                        )}
                        <span className="truncate">{branch.title}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCloseBranch(branch.id)}
                        aria-label={`关闭分支 ${branch.title}`}
                        className="ml-1 rounded p-0.5 text-[#8B857C] hover:bg-[#EAE5DE]/10 hover:text-[#E6E1DA]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {(riskAudit || showAuditDrawer) && (
                <button
                  type="button"
                  onClick={() => setShowAuditDrawer((v) => !v)}
                  className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                    showAuditDrawer
                      ? 'border-[#C48B88]/50 bg-[#C48B88]/18 text-[#DFB2AF]'
                      : 'border-[#EAE5DE]/[0.08] bg-[#2B2E33] text-[#B7B1A8] hover:text-[#DFB2AF]'
                  }`}
                >
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{showAuditDrawer ? t('stage1.returnToBranch') : t('stage1.viewAudit')}</span>
                </button>
              )}
            </div>

            {/* Panel Body: either Risk Audit Report OR Active Isolated Branch */}
            {showAuditDrawer ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                <div className="flex items-center justify-between border-b border-[#EAE5DE]/[0.08] pb-3">
                  <div>
                    <h2 className="text-base font-semibold text-[#E6E1DA] flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-[#D19A97]" aria-hidden="true" />
                      <span>{t('stage1.auditTitle')}</span>
                    </h2>
                    {riskAudit && (
                      <p className="mt-1 text-xs text-[#8B857C] tabular-nums">
                        {riskAudit.generatedAt}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleRunRiskAudit}
                    disabled={isAuditing}
                    className="rounded-lg border border-[#C48B88]/45 bg-[#C48B88]/12 px-3 py-1.5 text-xs font-medium text-[#DFB2AF] hover:bg-[#C48B88]/22 disabled:opacity-50"
                  >
                    {isAuditing ? t('stage1.auditing') : t('stage1.reAudit')}
                  </button>
                </div>

                {isAuditing && !riskAudit ? (
                  <div className="rounded-lg border border-[#EAE5DE]/[0.08] bg-[#24272B] p-4 text-sm text-[#B7B1A8]">
                    {t('stage1.auditing')}
                  </div>
                ) : riskAudit ? (
                  <div className="space-y-5">
                    <div className="rounded-lg border border-[#EAE5DE]/[0.08] bg-[#24272B] p-4">
                      <div className="text-xs font-medium text-[#8B857C] mb-1">{t('stage1.overallReview')}</div>
                      <p className="text-sm text-[#E6E1DA] leading-relaxed">{riskAudit.summary}</p>
                    </div>

                    {/* 1. 数据存疑点 */}
                    <div>
                      <h3 className="text-xs font-semibold text-[#D0B49F] mb-2.5">
                        {t('stage1.dataSkepticism')} ({riskAudit.dataSkepticism.length})
                      </h3>
                      <div className="space-y-2.5">
                        {riskAudit.dataSkepticism.length === 0 ? (
                          <p className="text-xs text-[#8B857C]">{t('stage1.noDataIssues')}</p>
                        ) : (
                          riskAudit.dataSkepticism.map((item, i) => (
                            <div
                              key={i}
                              className="rounded-lg border border-[#EAE5DE]/[0.08] bg-[#24272B] p-3.5 text-xs space-y-1.5"
                            >
                              <div className="font-semibold text-[#E6E1DA]">{item.claim}</div>
                              <p className="text-[#B7B1A8]">{item.issue}</p>
                              <p className="text-[#AFC2B4]">{item.suggestion}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* 2. 平台合规风险 */}
                    <div>
                      <h3 className="text-xs font-semibold text-[#DFB2AF] mb-2.5">
                        {t('stage1.complianceRisks')} ({riskAudit.complianceRisks.length})
                      </h3>
                      <div className="space-y-2.5">
                        {riskAudit.complianceRisks.map((item, i) => {
                          const sevLabel =
                            item.severity === 'high'
                              ? t('stage1.severityHigh')
                              : item.severity === 'medium'
                              ? t('stage1.severityMed')
                              : t('stage1.severityLow');
                          const sevColor =
                            item.severity === 'high'
                              ? 'text-[#D19A97]'
                              : item.severity === 'medium'
                              ? 'text-[#DFCEA4]'
                              : 'text-[#8B857C]';
                          return (
                            <div
                              key={i}
                              className="rounded-lg border border-[#EAE5DE]/[0.08] bg-[#24272B] p-3.5 text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-[#E6E1DA]">{item.point}</span>
                                <span className={`font-medium shrink-0 ${sevColor}`}>
                                  {sevLabel}
                                </span>
                              </div>
                              <p className="text-[#AFC2B4]">{t('stage1.safeFix')}{item.fix}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* 3. 前3秒钩子漏洞 */}
                    <div>
                      <h3 className="text-xs font-semibold text-[#E6E1DA] mb-2.5">
                        {t('stage1.hookVulnerabilities')} ({riskAudit.hookVulnerabilities.length})
                      </h3>
                      <div className="space-y-2.5">
                        {riskAudit.hookVulnerabilities.map((item, i) => (
                          <div
                            key={i}
                            className="rounded-lg border border-[#EAE5DE]/[0.08] bg-[#24272B] p-3.5 text-xs space-y-1.5"
                          >
                            <div className="text-[#B7B1A8]">{item.flaw}</div>
                            <p className="text-[#DFC5B0]">{t('stage1.rewriteSuggest')}{item.rewriteSuggestion}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {riskAudit.groundingSources && riskAudit.groundingSources.length > 0 && (
                      <div className="border-t border-[#EAE5DE]/[0.08] pt-3">
                        <div className="text-[11px] font-medium text-[#A3B8A9] mb-1.5">
                          {t('stage1.auditSources')}
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {riskAudit.groundingSources.map((s) => (
                            <a
                              key={s.uri}
                              href={s.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-[#B7B1A8] hover:text-[#DFC5B0] underline"
                            >
                              <span>{s.title}</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[#B7B1A8]">{t('stage1.startAuditPrompt')}</p>
                )}
              </div>
            ) : activeBranch ? (
              <div className="flex flex-1 flex-col min-h-0">
                {/* Active Branch Header & Core Conclusion Editor + Stage Handoff CTA */}
                <div className="border-b border-[#EAE5DE]/[0.08] bg-[#24272B]/80 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-[#8B857C]">{t('stage1.branchWorkspace')}</div>
                      <h3 className="text-sm font-semibold text-[#E6E1DA] truncate">
                        {activeBranch.title}
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={() => onHandoffToStage2(activeBranch)}
                      className="flex items-center gap-1.5 rounded-lg bg-[#879B8D] px-3.5 py-2 text-xs font-semibold text-[#151B17] hover:bg-[#97AB9D] transition-colors whitespace-nowrap shrink-0"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{t('stage1.lockBranchBtn')}</span>
                    </button>
                  </div>

                  <div>
                    <label
                      htmlFor={`branch-conclusion-${activeBranch.id}`}
                      className="block text-[11px] font-medium text-[#B7B1A8] mb-1"
                    >
                      {t('stage1.conclusionLabel')}
                    </label>
                    <textarea
                      id={`branch-conclusion-${activeBranch.id}`}
                      rows={2}
                      value={activeBranch.coreConclusion}
                      placeholder={t('stage1.conclusionPlaceholder')}
                      onChange={(e) => {
                        const val = e.target.value;
                        onUpdateProject((prev) => ({
                          ...prev,
                          stage1: {
                            ...prev.stage1,
                            branches: prev.stage1.branches.map((b) =>
                              b.id === activeBranch.id ? { ...b, coreConclusion: val } : b
                            ),
                          },
                        }));
                      }}
                      className="w-full rounded-lg border border-[#EAE5DE]/[0.09] bg-[#191B1E] px-3 py-2 text-xs text-[#E6E1DA] leading-relaxed focus:border-[#B89882]/60 focus:outline-none resize-none"
                    />
                  </div>
                </div>

                {/* Isolated Branch Conversation */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {activeBranch.messages.map((bmsg) => (
                    <div
                      key={bmsg.id}
                      className={`flex flex-col ${
                        bmsg.role === 'user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div className="mb-1 text-[11px] text-[#8B857C] tabular-nums">
                        {bmsg.role === 'user' ? t('common.creator') : t('stage1.director')} · {bmsg.timestamp}
                      </div>
                      <div
                        className={`rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                          bmsg.role === 'user'
                            ? 'max-w-[85%] bg-[#2B2E33] text-[#E6E1DA] border border-[#EAE5DE]/[0.09]'
                            : 'w-full bg-[#24272B] text-[#E6E1DA] border border-[#EAE5DE]/[0.08]'
                        }`}
                      >
                        {bmsg.content}
                        {bmsg.groundingSources && bmsg.groundingSources.length > 0 && (
                          <div className="mt-2.5 border-t border-[#EAE5DE]/[0.07] pt-2 flex flex-wrap gap-3">
                            {bmsg.groundingSources.map((s) => (
                              <a
                                key={s.uri}
                                href={s.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-[#AFC2B4] hover:underline"
                              >
                                <span>{s.title}</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {isBranchReplying && (
                    <div className="rounded-lg border border-[#EAE5DE]/[0.08] bg-[#24272B] p-3 text-xs text-[#B7B1A8]">
                      {t('stage1.branchReplying')}
                    </div>
                  )}
                </div>

                {/* Isolated Branch Composer */}
                <form
                  onSubmit={handleBranchSubmit}
                  className="border-t border-[#EAE5DE]/[0.08] bg-[#24272B] p-3.5"
                >
                  <div className="flex items-end gap-2">
                    <textarea
                      rows={2}
                      aria-label={t('stage1.branchChatPlaceholder')}
                      value={branchInput}
                      onChange={(e) => setBranchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleBranchSubmit(e);
                        }
                      }}
                      placeholder={t('stage1.branchChatPlaceholder')}
                      className="flex-1 rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3 py-2 text-sm text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none resize-none"
                    />
                    <button
                      type="submit"
                      disabled={isBranchReplying || !branchInput.trim()}
                      className="flex h-10 items-center gap-1.5 rounded-lg bg-[#B89882] px-3.5 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{t('stage1.sendBtn')}</span>
                    </button>
                  </div>
                </form>
              </div>
            ) : null}
          </section>
        )}
      </div>

    </div>
  );
};
