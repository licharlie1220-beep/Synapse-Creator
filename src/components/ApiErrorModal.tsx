import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n';
import type { ApiErrorDetail } from '../types/workspace';

interface ApiErrorModalProps {
  errorDetail: ApiErrorDetail | null;
  onClose: () => void;
  onOpenSettings: () => void;
}

export const ApiErrorModal: React.FC<ApiErrorModalProps> = ({
  errorDetail,
  onClose,
  onOpenSettings,
}) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  if (!errorDetail) return null;

  const handleCopy = async () => {
    const textToCopy = [
      `[${errorDetail.title}]`,
      `HTTP 状态码: ${errorDetail.statusCode}`,
      errorDetail.statusText ? `状态标识: ${errorDetail.statusText}` : '',
      `错误说明: ${errorDetail.message}`,
      errorDetail.rawDetails ? `原始返回: ${errorDetail.rawDetails}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const getCodeBadgeColor = (code: number) => {
    if (code === 401) return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
    if (code === 403) return 'border-rose-500/40 bg-rose-500/15 text-rose-300';
    if (code === 404) return 'border-orange-500/40 bg-orange-500/15 text-orange-300';
    if (code === 429) return 'border-yellow-500/40 bg-yellow-500/15 text-yellow-300';
    if (code === 503) return 'border-purple-500/40 bg-purple-500/15 text-purple-300';
    return 'border-red-500/40 bg-red-500/15 text-red-300';
  };

  const getActionRecommendation = (code: number) => {
    if (code === 401) return t('error.rec401');
    if (code === 403) return t('error.rec403');
    if (code === 404) return t('error.rec404');
    if (code === 429) return t('error.rec429');
    if (code === 503) return t('error.rec503');
    return t('error.recDefault');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg rounded-2xl border border-[#C48B88]/40 bg-[#1A1C1F] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#EAE5DE]/[0.08] px-5 py-4 bg-[#202226]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#C48B88]/15 border border-[#C48B88]/30">
              <AlertCircle className="h-5 w-5 text-[#DFB2AF]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#E6E1DA]">
                {errorDetail.title || t('error.modalTitle')}
              </h3>
              <p className="text-[11px] text-[#A8A196]">
                {t('error.modalSubtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-lg p-1.5 text-[#A8A196] hover:bg-[#2B2E33] hover:text-[#E6E1DA] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Status Code & Reason Badge */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md border px-2.5 py-1 text-xs font-mono font-bold ${getCodeBadgeColor(
                errorDetail.statusCode
              )}`}
            >
              HTTP {errorDetail.statusCode}
            </span>
            {errorDetail.statusText && (
              <span className="rounded-md border border-[#EAE5DE]/10 bg-[#25282D] px-2 py-0.5 text-[11px] font-mono text-[#C7D5CB]">
                {errorDetail.statusText}
              </span>
            )}
          </div>

          {/* Action Recommendation */}
          <div className="rounded-xl border border-[#B89882]/25 bg-[#25282C] p-3.5 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#DFC5B0]">
              <AlertTriangle className="h-4 w-4 text-[#C9A88F] shrink-0" />
              <span>{t('error.recTitle')}</span>
            </div>
            <p className="text-xs text-[#B7B1A8] leading-relaxed">
              {getActionRecommendation(errorDetail.statusCode)}
            </p>
          </div>

          {/* Raw Error Details */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-[#A8A196]">
                {t('error.rawResponse')}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-[11px] text-[#C9A88F] hover:text-[#DFC5B0]"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" />
                    <span>{t('common.copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>{t('error.copyBtn')}</span>
                  </>
                )}
              </button>
            </div>
            <div className="rounded-lg border border-[#EAE5DE]/[0.08] bg-[#121315] p-3 font-mono text-[11px] text-[#DFB2AF] leading-relaxed break-all whitespace-pre-wrap max-h-48 overflow-y-auto select-text">
              {errorDetail.rawDetails || errorDetail.message}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[#EAE5DE]/[0.08] px-5 py-3.5 bg-[#1C1E21]">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-[#B89882]/40 bg-[#B89882]/15 px-3.5 py-1.5 text-xs font-medium text-[#DFC5B0] hover:bg-[#B89882]/25 transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>{t('error.openSettings')}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#2D3035] px-4 py-1.5 text-xs font-medium text-[#E6E1DA] hover:bg-[#383C42] transition-colors"
          >
            {t('error.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
};
