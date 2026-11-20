import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cloud,
  FileText,
  Film,
  FolderCog,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react';
import { getDriveAccessToken, signInWithGoogleWorkspace } from '../lib/firebase';
import {
  fetchGoogleDriveFileAsAttachment,
  fetchWebdavFileAsAttachment,
  listGoogleDriveCloudFiles,
  listWebdavCloudFiles,
} from '../services/cloudFiles';
import type {
  BrainstormAttachmentPayload,
  CloudFileItem,
  CloudFileSource,
  SaveDestinationConfig,
} from '../types/workspace';
import { formatFileSize, formatFriendlyErrorMessage } from '../utils/workflow';

interface CloudFilePickerModalProps {
  isOpen: boolean;
  isSignedIn: boolean;
  saveConfig: SaveDestinationConfig;
  remainingSlots: number;
  onClose: () => void;
  onImportAttachment: (attachment: BrainstormAttachmentPayload) => void;
  onOpenStorageSettings: () => void;
}

export const CloudFilePickerModal: React.FC<CloudFilePickerModalProps> = ({
  isOpen,
  isSignedIn,
  saveConfig,
  remainingSlots,
  onClose,
  onImportAttachment,
  onOpenStorageSettings,
}) => {
  const [activeSource, setActiveSource] = useState<CloudFileSource>('google-drive');
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<CloudFileItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [importingFileId, setImportingFileId] = useState<string | null>(null);
  const [isAuthorizingDrive, setIsAuthorizingDrive] = useState(false);
  const [hasDriveToken, setHasDriveToken] = useState<boolean>(() => Boolean(getDriveAccessToken()));
  const [localError, setLocalError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  const loadFilesForSource = useCallback(
    async (source: CloudFileSource, query: string) => {
      const requestId = ++requestSeqRef.current;
      setLocalError(null);
      if (source === 'google-drive') {
        const token = getDriveAccessToken();
        setHasDriveToken(Boolean(token));
        if (!token) {
          setFiles([]);
          setIsLoadingList(false);
          return;
        }
        setIsLoadingList(true);
        try {
          const list = await listGoogleDriveCloudFiles(query);
          if (requestSeqRef.current === requestId) {
            setFiles(list);
          }
        } catch (err) {
          if (requestSeqRef.current === requestId) {
            setLocalError(formatFriendlyErrorMessage(err, '读取 Google Drive 文件失败'));
          }
        } finally {
          if (requestSeqRef.current === requestId) {
            setIsLoadingList(false);
          }
        }
      } else {
        if (!saveConfig.webdavUrl.trim()) {
          setFiles([]);
          setIsLoadingList(false);
          return;
        }
        setIsLoadingList(true);
        try {
          const list = await listWebdavCloudFiles(saveConfig);
          const trimmed = query.trim().toLowerCase();
          if (requestSeqRef.current === requestId) {
            setFiles(
              trimmed ? list.filter((item) => item.name.toLowerCase().includes(trimmed)) : list
            );
          }
        } catch (err) {
          if (requestSeqRef.current === requestId) {
            setLocalError(formatFriendlyErrorMessage(err, '读取 WebDAV 网盘文件失败'));
          }
        } finally {
          if (requestSeqRef.current === requestId) {
            setIsLoadingList(false);
          }
        }
      }
    },
    [saveConfig]
  );

  useEffect(() => {
    if (!isOpen) return;
    setHasDriveToken(Boolean(getDriveAccessToken()));
    setLocalError(null);
    const delayMs = searchQuery.trim() ? 300 : 0;
    const timer = window.setTimeout(() => {
      void loadFilesForSource(activeSource, searchQuery);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, activeSource, isSignedIn, loadFilesForSource, searchQuery]);

  if (!isOpen) return null;

  const handleAuthorizeGoogleDrive = async () => {
    if (isAuthorizingDrive) return;
    setIsAuthorizingDrive(true);
    setLocalError(null);
    try {
      const { accessToken } = await signInWithGoogleWorkspace();
      if (!accessToken) {
        setLocalError('未能获取到 Google Drive 只读访问令牌，请在授权弹窗中勾选查看云端硬盘文件权限。');
        setHasDriveToken(false);
        return;
      }
      setHasDriveToken(true);
      await loadFilesForSource('google-drive', searchQuery);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('popup-closed-by-user')) {
        setLocalError(formatFriendlyErrorMessage(err, 'Google Drive 授权失败'));
      }
    } finally {
      setIsAuthorizingDrive(false);
    }
  };

  const handleImportFile = async (item: CloudFileItem) => {
    if (remainingSlots <= 0) {
      setLocalError('单轮最多附加 3 个参考文件，请先移除已有附件后再导入。');
      return;
    }
    setImportingFileId(item.id);
    setLocalError(null);
    try {
      const attachment =
        item.source === 'google-drive'
          ? await fetchGoogleDriveFileAsAttachment(item)
          : await fetchWebdavFileAsAttachment(saveConfig, item);
      onImportAttachment(attachment);
      onClose();
    } catch (err) {
      setLocalError(formatFriendlyErrorMessage(err, `导入文件「${item.name}」失败`));
    } finally {
      setImportingFileId(null);
    }
  };

  const renderKindIcon = (kind: CloudFileItem['kind']) => {
    if (kind === 'image') return <ImageIcon className="h-4 w-4 text-[#D0B49F] shrink-0" />;
    if (kind === 'video') return <Film className="h-4 w-4 text-[#A3B8A9] shrink-0" />;
    return <FileText className="h-4 w-4 text-[#9EB2C0] shrink-0" />;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#101113]/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="从个人云端读取参考文件"
    >
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col rounded-xl border border-[#EAE5DE]/[0.12] bg-[#24272B] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#EAE5DE]/[0.08] px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Cloud className="h-4 w-4 text-[#D0B49F] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#E6E1DA]">
                云端文件读取端口
              </h2>
              <p className="mt-0.5 text-xs text-[#8B857C]">
                仅在你主动登录后访问你自己的云端文件（支持文档、文本、图片、视频 ≤20MB）
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭云端文件选择器"
            className="rounded-lg p-1.5 text-[#B7B1A8] hover:bg-[#EAE5DE]/[0.06] hover:text-[#E6E1DA] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Source Tabs */}
        <div
          role="tablist"
          aria-label="云端文件来源"
          className="flex items-center gap-2 border-b border-[#EAE5DE]/[0.08] bg-[#1D1F22] px-5 py-2.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeSource === 'google-drive'}
            onClick={() => setActiveSource('google-drive')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeSource === 'google-drive'
                ? 'border-[#B89882]/45 bg-[#B89882]/14 text-[#DFC5B0]'
                : 'border-transparent text-[#B7B1A8] hover:text-[#E6E1DA]'
            }`}
          >
            <Cloud className="h-3.5 w-3.5 shrink-0" />
            <span>Google Drive 云盘（个人授权）</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSource === 'webdav'}
            onClick={() => setActiveSource('webdav')}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeSource === 'webdav'
                ? 'border-[#B89882]/45 bg-[#B89882]/14 text-[#DFC5B0]'
                : 'border-transparent text-[#B7B1A8] hover:text-[#E6E1DA]'
            }`}
          >
            <Server className="h-3.5 w-3.5 shrink-0" />
            <span>个人 WebDAV 网盘</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Privacy & Isolation Guarantee */}
          <div className="flex items-start gap-2.5 rounded-lg border border-[#879B8D]/35 bg-[#879B8D]/10 px-3.5 py-2.5 text-xs text-[#C7D5CB]">
            <ShieldCheck className="h-4 w-4 text-[#A3B8A9] shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              数据严格按个人登录账号隔离：授权令牌仅暂存于当前会话内存中，退出登录或关闭页面即清除，不留存任何他人或作者账号信息。
            </span>
          </div>

          {localError && (
            <div
              role="alert"
              className="rounded-lg border border-[#C48B88]/45 bg-[#C48B88]/12 px-3.5 py-2.5 text-xs text-[#DFB2AF]"
            >
              {localError}
            </div>
          )}

          {activeSource === 'google-drive' && !hasDriveToken ? (
            <div className="rounded-xl border border-[#EAE5DE]/[0.09] bg-[#1D1F22] p-6 text-center space-y-4">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-[#B89882]/35 bg-[#B89882]/12 text-[#D0B49F]">
                <Cloud className="h-5 w-5" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-[#E6E1DA]">
                  登录并授权读取你的 Google Drive 文件
                </h3>
                <p className="mx-auto max-w-md text-xs text-[#B7B1A8] leading-relaxed">
                  程序本身未内置任何个人云盘链接。点击下方按钮登录你自己的 Google 账号并授予只读权限（drive.readonly），即可直接选取你的文档、表格、图片或视频投喂分析。
                </p>
              </div>
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => void handleAuthorizeGoogleDrive()}
                  disabled={isAuthorizingDrive}
                  className="inline-flex items-center gap-2.5 rounded-lg border border-[#EAE5DE]/20 bg-[#E6E1DA] px-4 py-2 text-xs font-semibold text-[#1D1F22] hover:bg-[#F1ECE6] disabled:opacity-50 transition-colors"
                >
                  <svg className="h-4 w-4 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                  </svg>
                  <span>
                    {isAuthorizingDrive
                      ? '正在连接 Google Drive...'
                      : 'Sign in & 授权读取 Google Drive'}
                  </span>
                </button>
              </div>
            </div>
          ) : activeSource === 'webdav' && !saveConfig.webdavUrl.trim() ? (
            <div className="rounded-xl border border-[#EAE5DE]/[0.09] bg-[#1D1F22] p-6 text-center space-y-3">
              <Server className="mx-auto h-8 w-8 text-[#D0B49F]" aria-hidden="true" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-[#E6E1DA]">
                  尚未配置你的 WebDAV 网盘地址
                </h3>
                <p className="text-xs text-[#B7B1A8]">
                  请先在「保存路径与网盘」设置中填写你自己的坚果云 / Nextcloud / Alist 地址与用户名密码。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenStorageSettings();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#B89882] px-4 py-2 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792] transition-colors"
              >
                <FolderCog className="h-3.5 w-3.5" />
                <span>前往配置 WebDAV 网盘</span>
              </button>
            </div>
          ) : (
            <>
              {/* Search & Refresh Bar */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8B857C]"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="按文件名检索云端文本、文档、图片或视频..."
                    className="w-full rounded-lg border border-[#EAE5DE]/[0.1] bg-[#191B1E] pl-8 pr-3 py-2 text-xs text-[#E6E1DA] placeholder:text-[#8B857C] focus:border-[#B89882]/60 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void loadFilesForSource(activeSource, searchQuery)}
                  disabled={isLoadingList}
                  className="flex items-center gap-1.5 rounded-lg border border-[#EAE5DE]/[0.1] bg-[#2B2E33] px-3 py-2 text-xs font-medium text-[#E6E1DA] hover:border-[#B89882]/50 disabled:opacity-50 whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingList ? 'animate-spin' : ''}`} />
                  <span>刷新目录</span>
                </button>
              </div>

              {/* File List */}
              {isLoadingList ? (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-[#B7B1A8]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#D0B49F]" />
                  <span>正在读取云端文件目录...</span>
                </div>
              ) : files.length === 0 ? (
                <div className="rounded-xl border border-[#EAE5DE]/[0.08] bg-[#1D1F22] py-10 text-center text-xs text-[#8B857C]">
                  当前目录下暂未匹配到可解析的文件（支持 Google Docs/Sheets/Slides、文本、图片、视频）。
                </div>
              ) : (
                <div className="divide-y divide-[#EAE5DE]/[0.06] rounded-xl border border-[#EAE5DE]/[0.09] bg-[#1D1F22] overflow-hidden">
                  {files.map((item) => {
                    const isImporting = importingFileId === item.id;
                    const kindLabel =
                      item.kind === 'image' ? '图片' : item.kind === 'video' ? '视频' : '文本/文档';
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#2B2E33]/70 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {renderKindIcon(item.kind)}
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-[#E6E1DA]">
                              {item.name}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#8B857C] tabular-nums">
                              <span>{kindLabel}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {item.sizeBytes > 0 ? formatFileSize(item.sizeBytes) : '云端在线文档'}
                              </span>
                              {item.modifiedAt && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{item.modifiedAt}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={Boolean(importingFileId) || remainingSlots <= 0}
                          onClick={() => void handleImportFile(item)}
                          className="flex items-center gap-1.5 rounded-lg bg-[#B89882] px-3 py-1.5 text-xs font-semibold text-[#1B1715] hover:bg-[#C5A792] disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
                        >
                          {isImporting ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>读取中...</span>
                            </>
                          ) : (
                            <span>导入分析</span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
