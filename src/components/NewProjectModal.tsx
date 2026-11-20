import React, { useState } from 'react';
import { Smartphone, Monitor, Clock, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { formatFriendlyErrorMessage } from '../utils/workflow';

export type AspectRatioOption = '9:16' | '16:9';
export type DurationOption = '10~20秒' | '1分钟左右' | '2分钟左右' | '3~5分钟';

interface NewProjectModalProps {
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    platform: string;
    topic: string;
    aspectRatio: AspectRatioOption;
    duration: DurationOption;
  }) => Promise<void>;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  isSubmitting,
  onClose,
  onCreate,
}) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('9:16');
  const [duration, setDuration] = useState<DurationOption>('10~20秒');
  const [topic, setTopic] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const durationOptions: Array<{ id: DurationOption; label: string; sub: string }> = [
    { id: '10~20秒', label: t('newProject.dur1020sLabel'), sub: t('newProject.dur1020sSub') },
    { id: '1分钟左右', label: t('newProject.dur1MinLabel'), sub: t('newProject.dur1MinSub') },
    { id: '2分钟左右', label: t('newProject.dur2MinLabel'), sub: t('newProject.dur2MinSub') },
    { id: '3~5分钟', label: t('newProject.dur35MinLabel'), sub: t('newProject.dur35MinSub') },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setValidationError(t('newProject.errName'));
      return;
    }
    if (!topic.trim()) {
      setValidationError(t('newProject.errTopic'));
      return;
    }
    setValidationError(null);
    try {
      const platformLabel = `${aspectRatio} ${aspectRatio === '9:16' ? '竖屏' : '横屏'} · ${duration}`;
      await onCreate({
        name: name.trim(),
        platform: platformLabel,
        topic: topic.trim(),
        aspectRatio,
        duration,
      });
      setName('');
      setTopic('');
    } catch (err) {
      setValidationError(formatFriendlyErrorMessage(err, '创建项目失败，请重试'));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#101113]/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-[#EAE5DE]/[0.1] bg-[#24272B] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#EAE5DE]/[0.08] pb-4">
          <h2 id="new-project-modal-title" className="text-lg font-semibold text-[#E6E1DA]">
            {t('newProject.modalTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="rounded-lg p-1.5 text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.06] hover:text-[#E6E1DA] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* 1. 项目名称 */}
          <div>
            <label htmlFor="project-name-input" className="block text-sm font-medium text-[#E6E1DA] mb-1.5">
              {t('newProject.nameLabel')}
            </label>
            <input
              id="project-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('newProject.namePlaceholder')}
              className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3.5 py-2.5 text-sm text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/70 focus:outline-none"
              autoFocus
            />
          </div>

          {/* 2. 画面比例 (9:16 vs 16:9) */}
          <div>
            <label className="block text-sm font-medium text-[#E6E1DA] mb-1.5">
              {t('newProject.ratioLabel')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAspectRatio('9:16')}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  aspectRatio === '9:16'
                    ? 'border-[#B89882] bg-[#B89882]/15 text-[#E6E1DA]'
                    : 'border-[#EAE5DE]/[0.08] bg-[#191B1E] text-[#B7B1A8] hover:border-[#EAE5DE]/[0.2]'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                    aspectRatio === '9:16' ? 'bg-[#B89882] text-[#1B1715]' : 'bg-[#24272B] text-[#B7B1A8]'
                  }`}
                >
                  <Smartphone className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{t('newProject.ratio916')}</div>
                  <div className="text-xs text-[#8B857C] truncate">{t('newProject.ratio916Desc')}</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAspectRatio('16:9')}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  aspectRatio === '16:9'
                    ? 'border-[#B89882] bg-[#B89882]/15 text-[#E6E1DA]'
                    : 'border-[#EAE5DE]/[0.08] bg-[#191B1E] text-[#B7B1A8] hover:border-[#EAE5DE]/[0.2]'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                    aspectRatio === '16:9' ? 'bg-[#B89882] text-[#1B1715]' : 'bg-[#24272B] text-[#B7B1A8]'
                  }`}
                >
                  <Monitor className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{t('newProject.ratio169')}</div>
                  <div className="text-xs text-[#8B857C] truncate">{t('newProject.ratio169Desc')}</div>
                </div>
              </button>
            </div>
          </div>

          {/* 3. 预估时长 (严格 4 档：10~20秒 / 1分钟左右 / 2分钟左右 / 3~5分钟) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-[#E6E1DA]">
                {t('newProject.durationLabel')}
              </label>
              <span className="text-xs text-[#8B857C] flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {t('newProject.durationHint')}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {durationOptions.map((opt) => {
                const isSelected = duration === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDuration(opt.id)}
                    className={`flex flex-col items-center justify-center rounded-lg border py-2.5 px-2 transition-all ${
                      isSelected
                        ? 'border-[#B89882] bg-[#B89882]/15 text-[#E6E1DA]'
                        : 'border-[#EAE5DE]/[0.08] bg-[#191B1E] text-[#B7B1A8] hover:border-[#EAE5DE]/[0.2]'
                    }`}
                  >
                    <span className="text-xs font-semibold">{opt.label}</span>
                    <span className="text-[10px] text-[#8B857C] mt-0.5">{opt.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. 核心选题 */}
          <div>
            <label htmlFor="project-topic-input" className="block text-sm font-medium text-[#E6E1DA] mb-1.5">
              {t('newProject.topicLabel')}
            </label>
            <textarea
              id="project-topic-input"
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t('newProject.topicPlaceholder')}
              className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] px-3.5 py-2.5 text-sm text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/70 focus:outline-none resize-none"
            />
          </div>

          {validationError && (
            <p className="text-xs text-[#D19A97]" role="alert">
              {validationError}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#EAE5DE]/[0.1] px-4 py-2 text-sm font-medium text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.05] hover:text-[#E6E1DA] transition-colors whitespace-nowrap shrink-0"
            >
              {t('newProject.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-[#B89882] px-4 py-2 text-sm font-semibold text-[#1B1715] hover:bg-[#C5A792] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {isSubmitting ? t('newProject.submitting') : t('newProject.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
