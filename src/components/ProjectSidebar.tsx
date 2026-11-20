import React from 'react';
import {
  Clapperboard,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { useI18n } from '../i18n';
import type {
  ApiProviderConfig,
  Project,
} from '../types/workspace';
import type { SettingsTabId } from './WorkbenchSettingsModal';

interface ProjectSidebarProps {
  projects: Project[];
  activeProjectId: string;
  providerConfig: ApiProviderConfig;
  onSelectProject: (projectId: string) => void;
  onOpenNewProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onOpenSettings: (tab?: SettingsTabId) => void;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  projects,
  activeProjectId,
  providerConfig,
  onSelectProject,
  onOpenNewProject,
  onDeleteProject,
  onOpenSettings,
}) => {
  const { t } = useI18n();

  const getStageLabel = (stageId: number) => {
    if (stageId === 1) return t('nav.stage1_short');
    if (stageId === 2) return t('nav.stage2_short');
    return t('nav.stage3_short');
  };

  return (
    <aside
      aria-label="Project Sidebar"
      className="flex h-full w-[264px] shrink-0 flex-col border-r border-[#EAE5DE]/[0.08] bg-[#24272B]"
    >
      {/* Brand Mark */}
      <div className="flex h-14 items-center gap-2.5 border-b border-[#EAE5DE]/[0.08] px-4">
        <Clapperboard className="h-4 w-4 text-[#D0B49F] shrink-0" aria-hidden="true" />
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-semibold tracking-tight text-[#E6E1DA] text-[15px] whitespace-nowrap">
            Synapse
          </span>
          <span className="text-[11px] text-[#8B857C] whitespace-nowrap truncate">
            {t('nav.projects')}
          </span>
        </div>
      </div>

      {/* Primary Sidebar Action */}
      <div className="p-3.5 border-b border-[#EAE5DE]/[0.06]">
        <button
          type="button"
          onClick={onOpenNewProject}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#B89882] px-3.5 py-2.5 text-sm font-semibold text-[#1B1715] hover:bg-[#C5A792] transition-colors whitespace-nowrap"
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('nav.newProject')}</span>
        </button>
      </div>

      {/* Project List */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1">
        <div className="px-2 pb-2 text-xs font-medium text-[#8B857C]">
          {t('nav.projects')} ({projects.length})
        </div>

        {projects.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-[#8B857C]">
            {t('empty.title')}
          </div>
        )}

        {projects.map((project) => {
          const isActive = project.id === activeProjectId;
          return (
            <div
              key={project.id}
              className={`group relative flex items-start justify-between rounded-lg px-3 py-2.5 transition-colors ${
                isActive
                  ? 'bg-[#2B2E33] text-[#E6E1DA] border border-[#EAE5DE]/[0.12]'
                  : 'text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.04] hover:text-[#E6E1DA] border border-transparent'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectProject(project.id)}
                className="flex-1 min-w-0 text-left focus:outline-none"
                aria-label={project.name}
                aria-current={isActive ? 'page' : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`truncate text-sm font-medium ${
                      isActive ? 'text-[#DFC5B0]' : 'text-[#E6E1DA]'
                    }`}
                  >
                    {project.name}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-[#8B857C]">{project.topic}</p>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#8B857C] tabular-nums">
                  <span className={isActive ? 'text-[#B7B1A8]' : ''}>
                    {getStageLabel(project.currentStage)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{t('common.shots', { count: project.stage3.shots.length })}</span>
                </div>
              </button>

              {projects.length >= 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('nav.deleteProjectConfirm'))) {
                      onDeleteProject(project.id);
                    }
                  }}
                  aria-label={t('nav.deleteProjectConfirm')}
                  title={t('nav.deleteProjectConfirm')}
                  className="ml-1.5 mt-0.5 rounded p-1 text-[#8B857C] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-[#C48B88]/15 hover:text-[#D19A97] transition-all shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Clean Settings Entry at Bottom */}
      <div className="border-t border-[#EAE5DE]/[0.08] p-3">
        <button
          type="button"
          onClick={() => onOpenSettings('provider')}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-[#EAE5DE]/[0.09] bg-[#1D1F22] px-3 py-2 text-xs font-medium text-[#B7B1A8] hover:border-[#B89882]/45 hover:text-[#E6E1DA] transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Settings className="h-4 w-4 text-[#D0B49F] shrink-0" />
            <span className="font-medium">{t('nav.settings')}</span>
          </div>
          <span className="text-[10px] text-[#8B857C] truncate max-w-[100px] font-mono">
            {providerConfig.model}
          </span>
        </button>
      </div>
    </aside>
  );
};
