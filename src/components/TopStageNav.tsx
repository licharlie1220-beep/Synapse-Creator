import React from 'react';
import { ArrowRight, Bot, Download, Lightbulb, PenTool, Film } from 'lucide-react';
import { useI18n } from '../i18n';
import type { Project, StageId } from '../types/workspace';

interface TopStageNavProps {
  project: Project;
  onSelectStage: (stage: StageId) => void;
  onExportPackage: () => void;
  onOpenChatbot: () => void;
  isExporting: boolean;
  lastLocalSaveTime?: string | null;
}

export const TopStageNav: React.FC<TopStageNavProps> = ({
  project,
  onSelectStage,
  onExportPackage,
  onOpenChatbot,
  isExporting,
  lastLocalSaveTime,
}) => {
  const { t } = useI18n();

  const stages: Array<{ id: StageId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 1, label: t('nav.stage1_short'), icon: Lightbulb },
    { id: 2, label: t('nav.stage2_short'), icon: PenTool },
    { id: 3, label: t('nav.stage3_short'), icon: Film },
  ];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[#EAE5DE]/[0.08] bg-[#24272B] px-5">
      {/* Zone 1: Active Project Context */}
      <div className="flex items-center gap-2.5 min-w-0">
        <h1 className="text-[15px] font-semibold text-[#E6E1DA] whitespace-nowrap truncate max-w-[180px]">
          {project.name}
        </h1>
        <span className="text-[#8B857C] hidden xl:inline" aria-hidden="true">
          ·
        </span>
        <span className="text-xs text-[#B7B1A8] whitespace-nowrap truncate max-w-[200px] hidden xl:inline">
          {project.platform}
        </span>
        {lastLocalSaveTime && (
          <span className="hidden md:inline-flex items-center gap-1 rounded bg-[#8BA396]/15 px-2 py-0.5 text-[11px] text-[#A3BFB0] border border-[#8BA396]/20">
            <span>💾 {t('nav.savedLocal')}</span>
            <span className="font-mono">{lastLocalSaveTime}</span>
          </span>
        )}
      </div>

      {/* Zone 2: Three-Stage Sequential Flow Navigation */}
      <nav aria-label="Workflow Navigation" className="flex items-center gap-1.5">
        {stages.map((stage, idx) => {
          const Icon = stage.icon;
          const isActive = project.currentStage === stage.id;
          return (
            <React.Fragment key={stage.id}>
              <button
                type="button"
                onClick={() => onSelectStage(stage.id)}
                aria-current={isActive ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-[#B89882]/16 text-[#DFC5B0] border border-[#B89882]/45'
                    : 'text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.05] hover:text-[#E6E1DA] border border-transparent'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{stage.label}</span>
              </button>
              {idx < stages.length - 1 && (
                <ArrowRight
                  className="h-3.5 w-3.5 text-[#8B857C] shrink-0 mx-0.5"
                  aria-hidden="true"
                />
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Zone 3: AI Chatbot + Primary Export Action */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenChatbot}
          className="flex items-center gap-1.5 rounded-lg border border-[#EAE5DE]/[0.12] bg-[#2B2E33] px-3 py-1.5 text-xs font-medium text-[#E6E1DA] hover:border-[#B89882]/50 hover:text-[#DFC5B0] transition-colors whitespace-nowrap shrink-0"
        >
          <Bot className="h-3.5 w-3.5 text-[#D0B49F] shrink-0" aria-hidden="true" />
          <span>{t('nav.coach')}</span>
        </button>

        <button
          type="button"
          onClick={onExportPackage}
          disabled={isExporting}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
            project.currentStage === 3
              ? 'bg-[#B89882] text-[#1B1715] hover:bg-[#C5A792]'
              : 'border border-[#EAE5DE]/[0.12] bg-[#2B2E33] text-[#E6E1DA] hover:border-[#B89882]/50 hover:text-[#DFC5B0]'
          }`}
        >
          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{isExporting ? t('nav.exporting') : t('nav.export')}</span>
        </button>
      </div>
    </header>
  );
};
