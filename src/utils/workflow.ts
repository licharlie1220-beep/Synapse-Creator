import type {
  ApiErrorDetail,
  ApiProviderConfig,
  ApiUsageStats,
  AttachmentKind,
  BrainstormDirection,
  BranchTab,
  CloudFileItem,
  Project,
  ProjectBrief,
  RiskAuditReport,
  StoryboardShot,
  TokenUsageSummary,
  VisualLockPreset,
} from '../types/workspace';

export const CINEMA_FILM_TEXTURE_CLAUSE =
  'shot on 35mm cinema film, authentic Kodak Vision3 film grain, subtle halation, organic cinematic film texture';

export const VISUAL_LOCK_PRESETS: VisualLockPreset[] = [
  {
    id: 'ratio-9-16',
    label: '9:16 竖屏 · 电影胶片质感',
    shortLabel: '9:16 竖屏',
    aspectRatio: '9:16',
    suffix: `${CINEMA_FILM_TEXTURE_CLAUSE} --ar 9:16`,
    description: '竖屏短视频构图比例，强制保留 35mm 电影胶片颗粒与质感（不含 --v 版本参数）',
  },
  {
    id: 'ratio-16-9',
    label: '16:9 横屏 · 电影胶片质感',
    shortLabel: '16:9 横屏',
    aspectRatio: '16:9',
    suffix: `${CINEMA_FILM_TEXTURE_CLAUSE} --ar 16:9`,
    description: '横屏宽画幅电影构图比例，强制保留 35mm 电影胶片颗粒与质感（不含 --v 版本参数）',
  },
];

export function normalizeVisualLockId(
  activeVisualLockId: string | null | undefined
): 'ratio-9-16' | 'ratio-16-9' {
  if (activeVisualLockId === 'ratio-16-9') {
    return 'ratio-16-9';
  }
  return 'ratio-9-16';
}

export function getActiveAspectRatio(
  activeVisualLockId: string | null | undefined
): '9:16' | '16:9' {
  return normalizeVisualLockId(activeVisualLockId) === 'ratio-16-9' ? '16:9' : '9:16';
}

export function stripMidjourneyVersionFlags(prompt: string): string {
  return prompt
    .replace(/\s*--(?:v|version)\s+\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function getEffectiveVisualLockSuffix(
  activeVisualLockId: string | null | undefined,
  customSuffix: string
): string {
  const normalizedId = normalizeVisualLockId(activeVisualLockId);
  const preset =
    VISUAL_LOCK_PRESETS.find((p) => p.id === normalizedId) ?? VISUAL_LOCK_PRESETS[0];
  const parts: string[] = [preset.suffix.trim()];

  const trimmedCustom = stripMidjourneyVersionFlags(customSuffix || '');
  if (trimmedCustom) {
    // Move --ar flag to the very end after custom suffix
    const arMatch = preset.suffix.match(/--ar\s+\S+/i);
    const baseFilmClause = CINEMA_FILM_TEXTURE_CLAUSE;
    const customClean = trimmedCustom.replace(/\s*--ar\s+\S+/gi, '').trim();
    const combinedParts = [baseFilmClause, customClean, arMatch ? arMatch[0] : `--ar ${preset.aspectRatio}`].filter(Boolean);
    return combinedParts.join(', ').replace(/,\s*(--ar\s+\S+)/i, ' $1').trim();
  }

  return parts.join(' ').trim();
}

/**
 * Strips any --v/--version/--ar flags from base prompt, ensures cinema film texture is preserved,
 * and appends the selected 9:16 or 16:9 aspect ratio cleanly without ever emitting --v flags.
 */
export function applyVisualLockToPrompt(
  basePrompt: string,
  lockSuffix: string
): string {
  const cleanBase = stripMidjourneyVersionFlags(basePrompt)
    .replace(/\s*--ar\s+\S+/gi, '')
    .trim()
    .replace(/[,;\s]+$/, '');

  const cleanSuffix = stripMidjourneyVersionFlags(lockSuffix);
  if (!cleanSuffix) {
    return cleanBase;
  }

  if (!cleanBase) {
    return cleanSuffix;
  }

  if (cleanSuffix.startsWith('--')) {
    return `${cleanBase} ${cleanSuffix}`;
  }
  return `${cleanBase}, ${cleanSuffix}`;
}

export function normalizeProjectData(project: Project): Project {
  const normalizedLockId = normalizeVisualLockId(project.stage3?.activeVisualLockId);
  const cleanedCustomSuffix = stripMidjourneyVersionFlags(
    project.stage3?.customVisualLockSuffix || ''
  );
  const cleanedShots = (project.stage3?.shots ?? []).map((shot, idx) => ({
    ...shot,
    shotNumber: shot.shotNumber || idx + 1,
    baseMjPrompt: stripMidjourneyVersionFlags(shot.baseMjPrompt || '').replace(
      /\s*--ar\s+\S+/gi,
      ''
    ),
  }));

  return {
    ...project,
    stage3: {
      activeVisualLockId: normalizedLockId,
      customVisualLockSuffix: cleanedCustomSuffix,
      shots: cleanedShots,
    },
  };
}

export function appendShotToStoryboard(
  existingShots: StoryboardShot[],
  draft: Omit<StoryboardShot, 'shotNumber'> & { shotNumber?: number }
): StoryboardShot[] {
  const nextNumber =
    existingShots.length > 0
      ? Math.max(...existingShots.map((s) => s.shotNumber || 0)) + 1
      : 1;
  const cleanPrompt = stripMidjourneyVersionFlags(draft.baseMjPrompt || '').replace(
    /\s*--ar\s+\S+/gi,
    ''
  );
  const newShot: StoryboardShot = {
    ...draft,
    shotNumber: draft.shotNumber && draft.shotNumber > existingShots.length ? draft.shotNumber : nextNumber,
    durationSec: Math.max(2, Math.min(15, Number(draft.durationSec) || 4)),
    baseMjPrompt: cleanPrompt,
  };
  return [...existingShots, newShot];
}

export function accumulateApiUsage(
  prev: ApiUsageStats,
  action: string,
  usage: TokenUsageSummary,
  nowIso: string = new Date().toISOString()
): ApiUsageStats {
  const promptTokens = Math.max(0, Math.round(usage.promptTokens || 0));
  const candidatesTokens = Math.max(0, Math.round(usage.candidatesTokens || 0));
  const totalTokens = Math.max(promptTokens + candidatesTokens, Math.round(usage.totalTokens || 0));
  const record = {
    id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    action,
    model: usage.model || 'gemini-4-hydrogen',
    promptTokens,
    candidatesTokens,
    totalTokens,
    timestamp: nowIso.slice(11, 19),
  };

  return {
    ...prev,
    totalRequests: prev.totalRequests + 1,
    promptTokens: prev.promptTokens + promptTokens,
    candidatesTokens: prev.candidatesTokens + candidatesTokens,
    totalTokens: prev.totalTokens + totalTokens,
    lastUpdatedAt: nowIso.slice(0, 16).replace('T', ' '),
    recentRecords: [record, ...prev.recentRecords].slice(0, 20),
  };
}

export function getUsageAlertState(stats: ApiUsageStats): {
  level: 'normal' | 'warning' | 'exceeded';
  percentage: number;
  message: string | null;
} {
  const limit = Math.max(1000, stats.budgetLimitTokens || 200000);
  const warnAt = Math.max(500, Math.min(limit, stats.warningThresholdTokens || Math.round(limit * 0.8)));
  const percentage = Math.min(999, Math.round((stats.totalTokens / limit) * 100));

  if (stats.totalTokens >= limit) {
    return {
      level: 'exceeded',
      percentage,
      message: `API Token 用量已达 ${stats.totalTokens.toLocaleString()}（超出设定上限 ${limit.toLocaleString()}），请注意控制调用频次或调高配额预算。`,
    };
  }
  if (stats.totalTokens >= warnAt) {
    return {
      level: 'warning',
      percentage,
      message: `API Token 用量已使用 ${percentage}%（${stats.totalTokens.toLocaleString()} / ${limit.toLocaleString()}），已触发预警阈值。`,
    };
  }
  return {
    level: 'normal',
    percentage,
    message: null,
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ProviderPresetMeta {
  id: 'deepseek' | 'openai' | 'claude';
  label: string;
  shortLabel: string;
  defaultBaseUrl: string;
  defaultModel: string;
  models: string[];
  description: string;
  keyHint: string;
}

export const BUILTIN_GEMINI_MODELS = [
  {
    id: 'gemini-3.8-flash',
    name: 'gemini-3.8-flash',
    label: 'gemini-3.8-flash（默认 · 推荐生产级）',
    description: '官方推荐主力模型，高性价比极速生成，深度支持短视频分镜与结构化脚本。',
    isDefault: true,
  },
  {
    id: 'gemini-4-hydrogen',
    name: 'gemini-4-hydrogen',
    label: 'gemini-4-hydrogen（前沿推理 Hydrogen）',
    description: '新一代推理架构预览模型，算力需求高；若遇到 503 拥堵会自动兜底至 3.8-flash。',
    isDefault: false,
  },
  {
    id: 'gemini-4-argon',
    name: 'gemini-4-argon',
    label: 'gemini-4-argon（深度架构 Argon）',
    description: '高维度上下文长文本创作与审校模型；遇到 503 拥堵时同样自动兜底至 3.8-flash。',
    isDefault: false,
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'gemini-3.1-flash-lite',
    label: 'gemini-3.1-flash-lite（极速轻量 Flash-Lite）',
    description: '低延迟极速模型，消耗资源极低，全天候超高并发可用。',
    isDefault: false,
  },
] as const;

export const EXTERNAL_PROVIDER_PRESETS: ProviderPresetMeta[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek (V4)',
    shortLabel: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat'],
    description: 'DeepSeek V4 最新一代高性价比推理与多模态创作模型（支持图片参考直读）。',
    keyHint: 'sk-...',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT-6)',
    shortLabel: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6.2-sol',
    models: ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6-luna'],
    description: 'OpenAI 最新 GPT-6 系列与 Responses API (/v1/responses)，支持文本与图片多模态直读。',
    keyHint: 'sk-proj-...',
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic 5.5)',
    shortLabel: 'Claude',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-5-5',
    models: [
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-2',
    ],
    description: 'Anthropic 最新 Claude 5.5 系列与 Messages API (2026-10-21)，擅长长文本叙事与图片直读。',
    keyHint: 'sk-ant-...',
  },
];

const LEGACY_DEFAULT_MODEL_UPGRADES: Record<string, string> = {
  'deepseek-chat': 'deepseek-flash',
  'gpt-4o': 'gpt-6.2-sol',
  'claude-sonnet-4-20250514': 'claude-sonnet-5-5',
};

export function normalizeApiProviderConfig(
  raw?: Partial<ApiProviderConfig> | null
): ApiProviderConfig {
  const rawType = raw?.providerType;
  const presetId = raw?.presetId;

  let providerType: ApiProviderConfig['providerType'] = 'builtin-gemini';
  if (rawType === 'deepseek' || rawType === 'openai' || rawType === 'claude') {
    providerType = rawType;
  } else if (rawType === 'custom-openai') {
    if (presetId === 'deepseek') providerType = 'deepseek';
    else if (presetId === 'openai') providerType = 'openai';
    else if (presetId === 'claude') providerType = 'claude';
    else providerType = 'custom-openai';
  }

  const matchedPreset = EXTERNAL_PROVIDER_PRESETS.find((p) => p.id === providerType);
  const rawModel = (raw?.model || '').trim();
  const upgradedModel =
    rawModel && LEGACY_DEFAULT_MODEL_UPGRADES[rawModel]
      ? LEGACY_DEFAULT_MODEL_UPGRADES[rawModel]
      : rawModel;

  return {
    providerType,
    presetId:
      providerType === 'builtin-gemini'
        ? 'gemini'
        : matchedPreset
        ? matchedPreset.id
        : 'custom',
    baseUrl:
      (raw?.baseUrl || '').trim() ||
      matchedPreset?.defaultBaseUrl ||
      'https://api.deepseek.com/v1',
    model:
      upgradedModel ||
      (providerType === 'builtin-gemini'
        ? 'gemini-3.8-flash'
        : matchedPreset?.defaultModel || 'deepseek-flash'),
    apiKey: (raw?.apiKey || '').trim(),
  };
}

export function classifyAttachmentKind(
  fileName: string,
  mimeType: string
): AttachmentKind | null {
  const lowerName = (fileName || '').toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();

  if (
    lowerMime.startsWith('text/') ||
    lowerMime === 'application/json' ||
    lowerMime === 'application/csv' ||
    /\.(txt|md|markdown|csv|json|srt|vtt|log)$/i.test(lowerName)
  ) {
    return 'text';
  }
  if (
    lowerMime.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif)$/i.test(lowerName)
  ) {
    return 'image';
  }
  if (
    lowerMime.startsWith('video/') ||
    /\.(mp4|mov|webm|m4v)$/i.test(lowerName)
  ) {
    return 'video';
  }
  return null;
}

export function parseWebdavPropfindXml(
  xmlText: string,
  baseUrl: string
): CloudFileItem[] {
  const responseRegex = /<(?:[a-zA-Z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?response>/gi;
  const items: CloudFileItem[] = [];
  let originBase = baseUrl.trim().replace(/\/+$/, '');
  try {
    originBase = new URL(baseUrl).origin;
  } catch {
    // Keep provided base string
  }

  let match: RegExpExecArray | null;
  while ((match = responseRegex.exec(xmlText)) !== null) {
    const block = match[1];
    const hrefMatch = block.match(/<(?:[a-zA-Z0-9_-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?href>/i);
    if (!hrefMatch) continue;
    const rawHref = hrefMatch[1].trim();
    const isCollection = /<(?:[a-zA-Z0-9_-]+:)?collection\b/i.test(block);
    if (isCollection || rawHref.endsWith('/')) continue;

    const displayNameMatch = block.match(
      /<(?:[a-zA-Z0-9_-]+:)?displayname\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?displayname>/i
    );
    const lenMatch = block.match(
      /<(?:[a-zA-Z0-9_-]+:)?getcontentlength\b[^>]*>(\d+)<\/(?:[a-zA-Z0-9_-]+:)?getcontentlength>/i
    );
    const mimeMatch = block.match(
      /<(?:[a-zA-Z0-9_-]+:)?getcontenttype\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?getcontenttype>/i
    );
    const modMatch = block.match(
      /<(?:[a-zA-Z0-9_-]+:)?getlastmodified\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?getlastmodified>/i
    );

    const decodedSegments = rawHref.split('/').filter(Boolean);
    const rawLastSeg = decodedSegments[decodedSegments.length - 1] || '';
    let fallbackName = rawLastSeg;
    try {
      fallbackName = decodeURIComponent(rawLastSeg);
    } catch {
      // Keep raw segment if URI percent-encoding is malformed
    }
    const name = (displayNameMatch?.[1]?.trim() || fallbackName).trim();
    const mimeType = (mimeMatch?.[1]?.trim() || '').split(';')[0].trim();
    const kind = classifyAttachmentKind(name, mimeType);
    if (!name || !kind) continue;

    let absoluteHref = rawHref;
    if (rawHref.startsWith('/')) {
      absoluteHref = `${originBase}${rawHref}`;
    } else if (!/^https?:\/\//i.test(rawHref)) {
      absoluteHref = `${baseUrl.replace(/\/+$/, '')}/${rawHref.replace(/^\/+/, '')}`;
    }

    items.push({
      id: `webdav_${items.length}_${name}`,
      source: 'webdav',
      name,
      mimeType: mimeType || (kind === 'text' ? 'text/plain' : kind === 'image' ? 'image/png' : 'video/mp4'),
      sizeBytes: Number(lenMatch?.[1] || 0),
      modifiedAt: modMatch?.[1]?.trim(),
      kind,
      downloadRef: absoluteHref,
    });
  }

  return items;
}

export function applyInlineEdit(
  fullScript: string,
  start: number,
  end: number,
  replacement: string
): { updatedScript: string; newSelectionEnd: number } {
  const safeStart = Math.max(0, Math.min(start, fullScript.length));
  const safeEnd = Math.max(safeStart, Math.min(end, fullScript.length));

  if (safeStart === safeEnd) {
    throw new Error('选区为空，无法执行局部替换');
  }

  const before = fullScript.slice(0, safeStart);
  const after = fullScript.slice(safeEnd);
  const updatedScript = `${before}${replacement}${after}`;
  return {
    updatedScript,
    newSelectionEnd: safeStart + replacement.length,
  };
}

export function openOrActivateBranch(
  branches: BranchTab[],
  direction: BrainstormDirection,
  nowIso: string = new Date().toISOString()
): { branches: BranchTab[]; activeBranchId: string } {
  const existing = branches.find((b) => b.directionId === direction.id);
  if (existing) {
    return {
      branches,
      activeBranchId: existing.id,
    };
  }

  const newBranch: BranchTab = {
    id: `branch_${direction.id}_${Date.now()}`,
    directionId: direction.id,
    title: direction.title,
    initialAngle: direction.angle,
    initialHook: direction.hook,
    coreConclusion: `${direction.title}：${direction.angle}\n开篇钩子：${direction.hook}`,
    messages: [
      {
        id: `bmsg_${Date.now()}`,
        role: 'assistant',
        timestamp: nowIso,
        content: [
          `已为你开启独立分支工作区：**${direction.title}**`,
          ``,
          `- **切入角度**：${direction.angle}`,
          `- **黄金前3秒钩子**：${direction.hook}`,
          `- **受众痛点**：${direction.audience}`,
          direction.verifiedFacts ? `- **检索事实支撑**：${direction.verifiedFacts}` : '',
          ``,
          `你可以在此分支内继续深挖案例细节、调整叙事节奏或补充反常识论据，不会影响主窗口及其他分支。确认方案后点击上方「锁定方案并进入脚本环节」。`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  };

  return {
    branches: [...branches, newBranch],
    activeBranchId: newBranch.id,
  };
}

export function createProjectBriefFromBranch(
  projectTopic: string,
  branch: BranchTab,
  riskAudit: RiskAuditReport | null,
  nowIso: string = new Date().toISOString()
): ProjectBrief {
  const riskNotesList: string[] = [];
  if (riskAudit) {
    for (const c of riskAudit.complianceRisks) {
      riskNotesList.push(`[合规] ${c.point} -> 建议：${c.fix}`);
    }
    for (const h of riskAudit.hookVulnerabilities) {
      riskNotesList.push(`[前3秒优化] ${h.flaw} -> 建议：${h.rewriteSuggestion}`);
    }
  }

  return {
    lockedAt: nowIso,
    branchId: branch.id,
    branchTitle: branch.title,
    topic: projectTopic,
    coreThesis: branch.coreConclusion.trim() || branch.initialAngle,
    targetAudience: '短视频核心目标受众（由立项分支锁定）',
    hookStrategy: branch.initialHook,
    keyPoints: [
      `核心视角：${branch.initialAngle}`,
      `前3秒钩子：${branch.initialHook}`,
      ...branch.messages
        .filter((m) => m.role === 'user')
        .slice(-2)
        .map((m) => `创作者补充指令：${m.content}`),
    ],
    riskNotes:
      riskNotesList.length > 0
        ? riskNotesList.join('\n')
        : '暂未发现高危合规与逻辑漏洞，写作时注意口语化与节奏紧凑。',
  };
}

export function buildBriefMarkdown(project: Project): string {
  const brief = project.stage2.brief;
  const lines: string[] = [
    `# ${project.name} · 策划纪要与立项简报`,
    ``,
    `- **项目主题**：${project.topic}`,
    `- **发布平台**：${project.platform}`,
    `- **最后更新时间**：${project.updatedAt}`,
    ``,
  ];

  if (brief) {
    lines.push(
      `## 一、锁定立项简报`,
      `- **锁定分支**：${brief.branchTitle}`,
      `- **锁定时间**：${brief.lockedAt}`,
      `- **前3秒钩子策略**：${brief.hookStrategy}`,
      ``,
      `### 核心立项结论`,
      brief.coreThesis,
      ``,
      `### 关键创作要点`,
      ...brief.keyPoints.map((p) => `- ${p}`),
      ``,
      `### 审校与风控备忘`,
      brief.riskNotes,
      ``
    );
  }

  if (project.stage1.branches.length > 0) {
    lines.push(`## 二、探索分支档案`);
    for (const b of project.stage1.branches) {
      lines.push(
        `### ${b.title}${b.isLocked ? ' [已锁定]' : ''}`,
        `- 切入角度：${b.initialAngle}`,
        `- 结论摘要：${b.coreConclusion}`,
        ``
      );
    }
  }

  if (project.stage1.riskAudit) {
    const audit = project.stage1.riskAudit;
    lines.push(`## 三、风险与逻辑体检报告`, audit.summary, ``);
    if (audit.dataSkepticism.length > 0) {
      lines.push(`### 数据存疑点`);
      audit.dataSkepticism.forEach((d) =>
        lines.push(`- **${d.claim}**：${d.issue}（建议：${d.suggestion}）`)
      );
      lines.push(``);
    }
    if (audit.complianceRisks.length > 0) {
      lines.push(`### 平台合规风险`);
      audit.complianceRisks.forEach((c) =>
        lines.push(`- [${c.severity.toUpperCase()}] ${c.point}（规避：${c.fix}）`)
      );
      lines.push(``);
    }
    if (audit.hookVulnerabilities.length > 0) {
      lines.push(`### 前3秒钩子漏洞`);
      audit.hookVulnerabilities.forEach((h) =>
        lines.push(`- ${h.flaw} -> 优化建议：${h.rewriteSuggestion}`)
      );
      lines.push(``);
    }
  }

  return lines.join('\n');
}

export function buildScriptText(project: Project): string {
  const header = [
    `【项目名称】${project.name}`,
    `【目标平台】${project.platform}`,
    `【核心主题】${project.topic}`,
    `========================================`,
    ``,
  ].join('\n');

  return `${header}${project.stage2.scriptContent.trim()}\n`;
}

export interface StoryboardExportRow {
  镜号: string;
  景别: string;
  时长秒: number;
  画面描述: string;
  对应台词: string;
  Midjourney英文提示词: string;
  运镜指令: string;
}

export function buildStoryboardRows(project: Project): StoryboardExportRow[] {
  const lockSuffix = getEffectiveVisualLockSuffix(
    project.stage3.activeVisualLockId,
    project.stage3.customVisualLockSuffix
  );

  return project.stage3.shots.map((shot: StoryboardShot) => ({
    镜号: `Shot ${String(shot.shotNumber).padStart(2, '0')}`,
    景别: shot.shotSize,
    时长秒: shot.durationSec,
    画面描述: shot.visualDescription,
    对应台词: shot.dialogue,
    Midjourney英文提示词: applyVisualLockToPrompt(shot.baseMjPrompt, lockSuffix),
    运镜指令: shot.cameraMovement,
  }));
}

function escapeCsvField(value: string | number): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildStoryboardCsv(project: Project): string {
  const rows = buildStoryboardRows(project);
  const ratio = getActiveAspectRatio(project.stage3.activeVisualLockId);
  const headers = [
    '镜号',
    '景别',
    '时长(秒)',
    `画面描述(${ratio === '16:9' ? '16:9横屏' : '9:16竖屏'})`,
    '对应台词',
    'Midjourney英文提示词',
    '运镜指令',
  ];

  const lines = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((r) =>
      [
        r.镜号,
        r.景别,
        r.时长秒,
        r.画面描述,
        r.对应台词,
        r.Midjourney英文提示词,
        r.运镜指令,
      ]
        .map(escapeCsvField)
        .join(',')
    ),
  ];

  // UTF-8 BOM for seamless Chinese display in Excel
  return `\uFEFF${lines.join('\r\n')}`;
}

export function parseLooseJsonSafe<T>(raw: string): T {
  const trimmed = (raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as T;
      } catch {
        // Fall through to friendly error
      }
    }
    throw new Error('模型返回的内容不是有效 JSON 格式，请重试。');
  }
}

export function parseApiErrorDetail(error: unknown): ApiErrorDetail | null {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const msg = raw.trim();
  if (!msg) return null;

  let code = 0;
  let statusText = '';
  let rawReason = '';

  // 1. Check for JSON error object from Google GenAI
  const jsonMatch = msg.match(/\{[\s\S]*"error"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error) {
        code = Number(parsed.error.code) || 0;
        statusText = parsed.error.status || '';
        rawReason = parsed.error.message || '';
      }
    } catch {}
  }

  // 2. Check for formatted tag like [Google API 错误 HTTP 403 · PERMISSION_DENIED]
  const tagMatch = msg.match(/\[Google API 错误 HTTP (\d{3})(?: · ([A-Z_]+))?\]:\s*([\s\S]*)/);
  if (tagMatch) {
    code = Number(tagMatch[1]);
    statusText = tagMatch[2] || statusText;
    const body = tagMatch[3]?.trim();
    return {
      title: `Google API 请求异常 (HTTP ${code})`,
      statusCode: code,
      statusText: statusText || undefined,
      message: body || msg,
      rawDetails: rawReason || body || msg,
    };
  }

  // 3. Check for status code in text
  if (!code) {
    const httpMatch = msg.match(/\bHTTP\s*(\d{3})\b/i) || msg.match(/\b(400|401|403|404|429|500|502|503)\b/);
    if (httpMatch) {
      code = Number(httpMatch[1]);
    }
  }

  if (code >= 400 && code < 600) {
    let title = `Google API 错误 (HTTP ${code})`;
    if (code === 400) title = 'HTTP 400 · 请求参数错误 (INVALID_ARGUMENT)';
    else if (code === 401) title = 'HTTP 401 · API Key 鉴权失败 (UNAUTHENTICATED)';
    else if (code === 403) title = 'HTTP 403 · 权限不足 (PERMISSION_DENIED)';
    else if (code === 404) title = 'HTTP 404 · 模型不存在 (NOT_FOUND)';
    else if (code === 429) title = 'HTTP 429 · 频次超限或配额耗尽 (RESOURCE_EXHAUSTED)';
    else if (code === 503) title = 'HTTP 503 · 算力拥堵繁忙 (UNAVAILABLE)';

    return {
      title,
      statusCode: code,
      statusText: statusText || undefined,
      message: rawReason || msg,
      rawDetails: rawReason || msg,
    };
  }

  return null;
}

export function formatFriendlyErrorMessage(
  error: unknown,
  fallback = '操作未能完成，请稍后重试。'
): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const msg = raw.trim();
  if (!msg) return fallback;

  // Preserve structured Google API errors that already contain full diagnosis
  if (msg.startsWith('[Google API 错误')) {
    return msg;
  }

  // Handle JSON-encoded Firestore error wrapper
  if (msg.startsWith('{') && msg.includes('"operationType"')) {
    try {
      const parsed = JSON.parse(msg) as { error?: string; operationType?: string };
      const inner = parsed.error || '';
      if (/permission|insufficient|denied/i.test(inner)) {
        return '云端同步权限受限，你的改动已安全保存在当前浏览器本地缓存中。';
      }
      if (/network|offline|unavailable|timeout/i.test(inner)) {
        return '云端网络连接暂时不可用，当前修改已自动保存在本地浏览器缓存中。';
      }
      return `云端同步提示（${parsed.operationType || 'sync'}）：当前改动已保存在本地，稍后可重试同步。`;
    } catch {
      // Continue below
    }
  }

  if (/auth\/popup-blocked/i.test(msg)) {
    return '登录弹窗被浏览器拦截，请允许当前页面弹出窗口后重试。';
  }
  if (/auth\/popup-closed-by-user/i.test(msg)) {
    return '已取消登录弹窗授权。';
  }
  if (/401|unauthorized|invalid.*api.?key/i.test(msg)) {
    return 'API Key 鉴权失败（401），请检查你在本地填写的 API Key 是否正确或已过期。';
  }
  if (/429|rate limit|too many requests|RESOURCE_EXHAUSTED/i.test(msg)) {
    return '请求过于频繁或已触及配额上限（429），请稍后片刻再试。';
  }
  if (/AbortError|TimeoutError|timed out|timeout/i.test(msg)) {
    return '请求超时，请检查网络连接或稍后重试。';
  }
  if (/Failed to fetch|NetworkError|Load failed|ERR_NETWORK|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return '网络连接失败或目标接口不可达（若使用自定义外部 API，请检查网络及接口跨域 CORS 设置）。';
  }
  if (/Unexpected token|JSON\.parse|is not valid JSON/i.test(msg)) {
    return '接口返回数据格式异常（非预期 JSON），请检查接口地址或稍后重试。';
  }
  if (/QuotaExceededError|exceeded the quota/i.test(msg)) {
    return '浏览器本地存储空间已接近上限，建议导出项目包后清理历史项目。';
  }
  if (/NotAllowedError/i.test(msg)) {
    return '未授予系统权限（如本地文件夹或剪贴板访问），已保持当前数据安全。';
  }

  return msg;
}

