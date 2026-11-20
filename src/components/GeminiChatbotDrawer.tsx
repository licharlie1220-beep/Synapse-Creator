import React, { useEffect, useRef, useState } from 'react';
import { Bot, Eraser, Send, Sparkles, User as UserIcon, X } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  CHATBOT_MODEL_MODES,
  CHATBOT_PERSONAS,
  runChatbotTurn,
} from '../services/geminiClient';
import type {
  ChatbotMessage,
  ChatbotModelMode,
  ChatbotPersonaId,
  Project,
} from '../types/workspace';
import { formatFriendlyErrorMessage } from '../utils/workflow';

interface GeminiChatbotDrawerProps {
  isOpen: boolean;
  project: Project;
  messages: ChatbotMessage[];
  onClose: () => void;
  onAppendMessages: (userMsg: ChatbotMessage, modelMsg: ChatbotMessage) => Promise<void> | void;
  onClearThread: () => Promise<void> | void;
  onError: (msg: string) => void;
}

function buildProjectContextSummary(project: Project): string {
  const lockedBrief = project.stage2.brief;
  return [
    `项目名称：${project.name}`,
    `发布平台：${project.platform}`,
    `核心选题：${project.topic}`,
    `当前所在阶段：阶段 ${project.currentStage}`,
    lockedBrief
      ? `已锁定《立项简报》：方向「${lockedBrief.branchTitle}」；核心论点「${lockedBrief.coreThesis}」；前3秒钩子「${lockedBrief.hookStrategy}」`
      : '《立项简报》尚未锁定。',
    project.stage2.scriptContent
      ? `当前口播脚本节选（前800字）：\n${project.stage2.scriptContent.slice(0, 800)}`
      : '口播脚本暂为空。',
    project.stage3.shots.length > 0
      ? `已生成分镜数：${project.stage3.shots.length} 镜；第一镜画面：${project.stage3.shots[0]?.visualDescription || ''}`
      : '暂未拆解分镜。',
  ].join('\n');
}

export const GeminiChatbotDrawer: React.FC<GeminiChatbotDrawerProps> = ({
  isOpen,
  project,
  messages,
  onClose,
  onAppendMessages,
  onClearThread,
  onError,
}) => {
  const { t } = useI18n();
  const [personaId, setPersonaId] = useState<ChatbotPersonaId>('script-coach');
  const [modeId, setModeId] = useState<ChatbotModelMode>('flash');
  const [inputValue, setInputValue] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  const getPersonaLabel = (id?: string) => {
    if (id === 'script-coach') return t('coach.personaScript');
    if (id === 'visual-director') return t('coach.personaVisual');
    if (id === 'algorithm-auditor') return t('coach.personaAudit');
    return t('nav.coach');
  };

  const quickPrompts: Record<ChatbotPersonaId, string[]> = {
    'script-coach': [
      t('coach.quickScript1'),
      t('coach.quickScript2'),
    ],
    'visual-director': [
      t('coach.quickVisual1'),
      t('coach.quickVisual2'),
    ],
    'algorithm-auditor': [
      t('coach.quickAudit1'),
      t('coach.quickAudit2'),
    ],
  };

  useEffect(() => {
    if (isOpen) {
      scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen, messages.length, isSending]);

  if (!isOpen) return null;

  const activePersona =
    CHATBOT_PERSONAS.find((p) => p.id === personaId) ?? CHATBOT_PERSONAS[0];
  const activeMode =
    CHATBOT_MODEL_MODES.find((m) => m.id === modeId) ?? CHATBOT_MODEL_MODES[0];

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? inputValue).trim();
    if (!text || isSending) return;

    setIsSending(true);
    if (!overrideText) setInputValue('');

    const nowLabel = new Date().toISOString().slice(11, 16);
    const userMsg: ChatbotMessage = {
      id: `chat_${Date.now()}_u`,
      projectId: project.id,
      role: 'user',
      personaId,
      modelName: activeMode.model,
      content: text,
      createdAt: nowLabel,
    };

    try {
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const result = await runChatbotTurn({
        personaId,
        modeId,
        projectContextSummary: buildProjectContextSummary(project),
        history,
        userMessage: text,
      });

      const modelMsg: ChatbotMessage = {
        id: `chat_${Date.now() + 1}_m`,
        projectId: project.id,
        role: 'model',
        personaId,
        modelName: result.modelUsed,
        content: result.reply,
        createdAt: new Date().toISOString().slice(11, 16),
      };

      await onAppendMessages(userMsg, modelMsg);
    } catch (err) {
      if (!overrideText) setInputValue(text);
      onError(formatFriendlyErrorMessage(err, 'AI 对话助手响应失败'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#101113]/65"
      role="dialog"
      aria-modal="true"
      aria-label={t('coach.title')}
    >
      <div className="flex-1" onClick={onClose} aria-hidden="true" />
      <aside className="flex h-full w-full max-w-[440px] flex-col border-l border-[#EAE5DE]/[0.1] bg-[#24272B] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#EAE5DE]/[0.08] px-4 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#B89882]/35 bg-[#B89882]/14 text-[#D0B49F]">
              <Bot className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[#E6E1DA] truncate">
                {t('coach.title')}
              </h2>
              <p className="text-[11px] text-[#B7B1A8] truncate">
                {project.name} · {getPersonaLabel(activePersona.id)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => void onClearThread()}
                disabled={isSending}
                title={t('coach.clear')}
                aria-label={t('coach.clear')}
                className="rounded-lg p-1.5 text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.06] hover:text-[#D19A97] transition-colors disabled:opacity-40"
              >
                <Eraser className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('coach.close')}
              className="rounded-lg p-1.5 text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.06] hover:text-[#E6E1DA] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Persona & Model Mode Controls */}
        <div className="border-b border-[#EAE5DE]/[0.07] bg-[#1D1F22] px-4 py-3 space-y-2.5">
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-[#B7B1A8]">
              {t('coach.personaTitle')}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {CHATBOT_PERSONAS.map((persona) => {
                const selected = persona.id === personaId;
                return (
                  <button
                    key={persona.id}
                    type="button"
                    onClick={() => setPersonaId(persona.id)}
                    className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors border text-center truncate ${
                      selected
                        ? 'border-[#B89882]/50 bg-[#B89882]/16 text-[#DFC5B0]'
                        : 'border-[#EAE5DE]/[0.08] bg-[#2B2E33] text-[#B7B1A8] hover:text-[#E6E1DA]'
                    }`}
                  >
                    {getPersonaLabel(persona.id)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="chatbot-model-select"
              className="text-[11px] font-medium text-[#B7B1A8] shrink-0"
            >
              {t('coach.modeTitle')}
            </label>
            <select
              id="chatbot-model-select"
              value={modeId}
              onChange={(e) => setModeId(e.target.value as ChatbotModelMode)}
              className="flex-1 rounded-md border border-[#EAE5DE]/[0.1] bg-[#2B2E33] px-2.5 py-1.5 text-xs text-[#E6E1DA] focus:border-[#B89882]/60 focus:outline-none"
            >
              {CHATBOT_MODEL_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Scrollable Multi-turn Message Thread */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#DFC5B0]">
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{t('coach.contextLoaded', { name: project.name })}</span>
              </div>
              <p className="text-xs leading-relaxed text-[#B7B1A8]">
                {t('coach.contextDesc', { role: getPersonaLabel(activePersona.id) })}
              </p>
              <div className="space-y-1.5 pt-1">
                {quickPrompts[personaId].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void handleSend(prompt)}
                    className="w-full rounded-lg border border-[#EAE5DE]/[0.08] bg-[#2B2E33] px-3 py-2 text-left text-xs text-[#E6E1DA] hover:border-[#B89882]/45 hover:text-[#DFC5B0] transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const personaLabel = getPersonaLabel(msg.personaId);
              return (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#B89882]/35 bg-[#B89882]/14 text-[#D0B49F]">
                      <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      isUser
                        ? 'bg-[#B89882]/16 border border-[#B89882]/35 text-[#E6E1DA]'
                        : 'bg-[#1D1F22] border border-[#EAE5DE]/[0.08] text-[#E6E1DA]'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3 text-[10px] text-[#8B857C]">
                      <span>{isUser ? t('common.creator') : personaLabel}</span>
                      <span className="tabular-nums">{msg.createdAt}</span>
                    </div>
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  </div>
                  {isUser && (
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#EAE5DE]/[0.1] bg-[#2B2E33] text-[#E6E1DA]">
                      <UserIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {isSending && (
            <div className="flex items-center gap-2.5 text-xs text-[#B7B1A8]">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#B89882]/35 bg-[#B89882]/14 text-[#D0B49F]">
                <Bot className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
              <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] px-3.5 py-2.5">
                {t('coach.thinking', { role: getPersonaLabel(activePersona.id) })}
              </div>
            </div>
          )}
          <div ref={scrollEndRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="border-t border-[#EAE5DE]/[0.08] bg-[#1D1F22] p-3.5"
        >
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={t('coach.placeholder', { role: getPersonaLabel(activePersona.id) })}
              className="flex-1 resize-none rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3 py-2 text-xs text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSending || !inputValue.trim()}
              aria-label="发送聊天消息"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#B89882] text-[#1B1715] hover:bg-[#C5A792] transition-colors disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
};
