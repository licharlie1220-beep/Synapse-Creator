import type {
  BrainstormAttachmentPayload,
  BrainstormDirection,
  ChatbotModelMode,
  ChatbotPersonaId,
  GroundingSource,
  RiskAuditReport,
  StoryboardShot,
  TokenUsageSummary,
} from '../types/workspace';
import type {
  EnhancedHookProposal,
  GeneratedScriptCandidate,
} from '../rules/copywritingRules';
import { formatFriendlyErrorMessage } from '../utils/workflow';
import {
  runExternalAddShot,
  runExternalBrainstorm,
  runExternalBranchChat,
  runExternalChatbotTurn,
  runExternalEditShot,
  runExternalGenerateScript,
  runExternalInlineEdit,
  runExternalRiskAudit,
  runExternalStoryboard,
} from './externalAiClient';
import { loadApiProviderConfig } from './projectStorage';

export interface UsageTrackedDetail {
  action: string;
  usage: TokenUsageSummary;
}

export const API_USAGE_EVENT_NAME = 'workbench:api-usage';

const BUILTIN_REQUEST_TIMEOUT_MS = 95000;

function notifyUsageTracked(action: string, usage?: TokenUsageSummary): void {
  if (!usage || typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<UsageTrackedDetail>(API_USAGE_EVENT_NAME, {
      detail: { action, usage },
    })
  );
}

/**
 * Strips any accidental sensitive keys from payloads sent to built-in Gemini routes.
 */
export function sanitizeBuiltinServerPayload<T extends Record<string, unknown>>(
  payload: T
): Omit<T, 'providerConfig' | 'apiKey'> {
  const copy = { ...payload } as Record<string, unknown>;
  delete copy.providerConfig;
  delete copy.apiKey;
  return copy as Omit<T, 'providerConfig' | 'apiKey'>;
}

export const MODEL_FALLBACK_EVENT_NAME = 'workbench:model-fallback';

export interface ModelFallbackEventDetail {
  originalModel?: string;
  fallbackModel: string;
  notice: string;
}

async function postBuiltinGeminiJson<TReq extends Record<string, unknown>, TRes>(
  endpoint: string,
  payload: TReq,
  actionLabel: string
): Promise<TRes> {
  const controller = new AbortController();
  const timerId = window.setTimeout(() => controller.abort(), BUILTIN_REQUEST_TIMEOUT_MS);

  try {
    const config = loadApiProviderConfig();

    if (!config.apiKey || !config.apiKey.trim()) {
      throw new Error(
        '[Google API 错误 HTTP 401 · MISSING_API_KEY]: 尚未配置你的 Google Gemini API Key。请在右上角「设置 > AI 服务商」中输入你的专属 API Key 并选择模型。'
      );
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    headers['x-gemini-api-key'] = config.apiKey.trim();
    if (config.model) {
      headers['x-gemini-model'] = config.model.trim();
    }

    const safePayload = sanitizeBuiltinServerPayload(payload);
    // Also include model in body payload if not specified
    if (typeof (safePayload as any).model === 'undefined' && config.model) {
      (safePayload as any).model = config.model.trim();
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(safePayload),
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`服务端接口响应异常（HTTP ${res.status}），请稍后重试。`);
    }

    let data: TRes & {
      error?: string;
      usage?: TokenUsageSummary;
      fallbackOccurred?: boolean;
      fallbackModel?: string;
      fallbackNotice?: string;
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw new Error(`服务端返回数据解析失败（HTTP ${res.status}），请稍后重试。`);
    }

    if (!res.ok) {
      const errorMsg = data.error || `[Google API 错误 HTTP ${res.status}]: 服务端处理失败`;
      throw new Error(errorMsg);
    }

    // Trigger fallback notification if a fallback occurred
    if (data.fallbackOccurred || res.headers.get('x-gemini-fallback') === 'true') {
      const fallbackModel =
        data.fallbackModel ||
        res.headers.get('x-gemini-model-used') ||
        'gemini-3.8-flash';
      const notice =
        data.fallbackNotice ||
        `检测到当前模型算力拥堵(503)，已自动无缝切换至备用模型 ${fallbackModel} 继续生成，创作流程不受影响。`;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent<ModelFallbackEventDetail>(MODEL_FALLBACK_EVENT_NAME, {
            detail: {
              originalModel: config.model,
              fallbackModel,
              notice,
            },
          })
        );
      }
    }

    if (data.usage) {
      notifyUsageTracked(actionLabel, data.usage);
    }
    return data;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('AI 服务响应超时，请稍后重试或简化当前输入。');
    }
    throw new Error(formatFriendlyErrorMessage(err, 'AI 服务调用失败，请稍后重试。'));
  } finally {
    window.clearTimeout(timerId);
  }
}

export async function runBrainstorm(params: {
  projectName: string;
  platform: string;
  topic: string;
  userMessage: string;
  history: Array<{ role: string; content: string }>;
  searchGrounding: boolean;
  attachments?: BrainstormAttachmentPayload[];
}): Promise<{
  reply: string;
  directions: BrainstormDirection[];
  groundingSources: GroundingSource[];
}> {
  const config = loadApiProviderConfig();
  if (config.providerType !== 'builtin-gemini') {
    const res = await runExternalBrainstorm(config, params);
    notifyUsageTracked('策划脑暴', res.usage);
    return res;
  }
  return postBuiltinGeminiJson('/api/gemini/brainstorm', params, '策划脑暴');
}

export async function runBranchChat(params: {
  projectName: string;
  platform: string;
  topic: string;
  branchTitle: string;
  initialAngle: string;
  initialHook: string;
  messages: Array<{ role: string; content: string }>;
  userMessage: string;
  searchGrounding: boolean;
}): Promise<{
  reply: string;
  suggestedConclusion?: string;
  groundingSources: GroundingSource[];
}> {
  const config = loadApiProviderConfig();
  if (config.providerType !== 'builtin-gemini') {
    const res = await runExternalBranchChat(config, params);
    notifyUsageTracked('分支深挖', res.usage);
    return res;
  }
  return postBuiltinGeminiJson('/api/gemini/branch-chat', params, '分支深挖');
}

export async function runRiskAudit(params: {
  projectName: string;
  platform: string;
  topic: string;
  activeBranch: { title: string; coreConclusion: string; initialHook: string } | null;
  directions: Array<{ title: string; angle: string; hook: string }>;
  searchGrounding: boolean;
}): Promise<RiskAuditReport> {
  const config = loadApiProviderConfig();
  if (config.providerType !== 'builtin-gemini') {
    const res = await runExternalRiskAudit(config, params);
    notifyUsageTracked('风险与逻辑体检', res.usage);
    return res;
  }
  return postBuiltinGeminiJson('/api/gemini/risk-audit', params, '风险与逻辑体检');
}

export async function runGenerateScript(params: {
  projectName: string;
  platform: string;
  brief: {
    branchTitle: string;
    topic: string;
    coreThesis: string;
    hookStrategy: string;
    keyPoints: string[];
    riskNotes: string;
  };
}): Promise<{ script: string; candidates: GeneratedScriptCandidate[] }> {
  const config = loadApiProviderConfig();
  if (config.providerType !== 'builtin-gemini') {
    const res = await runExternalGenerateScript(config, params);
    notifyUsageTracked('生成口播脚本', res.usage);
    return {
      script: res.script,
      candidates: [
        {
          id: 'v1',
          versionName: '版本 A · 规则定制版',
          hookType: '黄金钩子',
          estimatedDuration: '约45秒',
          highlight: '遵循短视频创作规则生成',
          scriptText: res.script,
        },
      ],
    };
  }
  const data = await postBuiltinGeminiJson<
    typeof params,
    { script: string; candidates?: GeneratedScriptCandidate[] }
  >('/api/gemini/generate-script', params, '生成口播脚本（3款方案）');

  const candidates =
    Array.isArray(data.candidates) && data.candidates.length > 0
      ? data.candidates
      : [
          {
            id: 'v1',
            versionName: '版本 A · 推荐版',
            hookType: '规则定制钩子',
            estimatedDuration: '约45秒',
            highlight: '严格遵循《自媒体短视频全流程文案创作规则手册》',
            scriptText: data.script,
          },
        ];

  return {
    script: data.script || candidates[0]?.scriptText || '',
    candidates,
  };
}

export async function runEnhanceHook(params: {
  fullScript: string;
  platform?: string;
  brief?: any;
}): Promise<EnhancedHookProposal[]> {
  const data = await postBuiltinGeminiJson<
    typeof params,
    { proposals?: EnhancedHookProposal[] }
  >('/api/gemini/enhance-hook', params, '强化钩子与滑梯润色');

  return data.proposals || [];
}

export async function runInlineEdit(params: {
  fullScript: string;
  selectedText: string;
  instruction: string;
  platform: string;
}): Promise<string> {
  const config = loadApiProviderConfig();
  if (config.providerType !== 'builtin-gemini') {
    const res = await runExternalInlineEdit(config, params);
    notifyUsageTracked('脚本局部微调', res.usage);
    return res.replacement;
  }
  const data = await postBuiltinGeminiJson<typeof params, { replacement: string }>(
    '/api/gemini/inline-edit',
    params,
    '脚本局部微调'
  );
  return data.replacement;
}

export async function runStoryboard(params: {
  projectName: string;
  platform: string;
  scriptContent: string;
  aspectRatio?: '9:16' | '16:9';
}): Promise<StoryboardShot[]> {
  const config = loadApiProviderConfig();
  if (config.providerType !== 'builtin-gemini') {
    const res = await runExternalStoryboard(config, params);
    notifyUsageTracked('导演分镜拆解', res.usage);
    return res.shots;
  }
  const data = await postBuiltinGeminiJson<typeof params, { shots: StoryboardShot[] }>(
    '/api/gemini/storyboard',
    params,
    '导演分镜拆解'
  );
  return data.shots;
}

export async function runEditShot(params: {
  projectName: string;
  platform: string;
  shot: StoryboardShot;
  instruction: string;
  aspectRatio?: '9:16' | '16:9';
  shotHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<Partial<StoryboardShot> & { assistantReply?: string }> {
  const config = loadApiProviderConfig();
  if (config.providerType !== 'builtin-gemini') {
    const res = await runExternalEditShot(config, params);
    notifyUsageTracked('单镜对话设定', res.usage);
    return res;
  }
  return postBuiltinGeminiJson('/api/gemini/edit-shot', params, '单镜对话设定');
}

export async function runAddShot(params: {
  projectName: string;
  platform: string;
  scriptContent: string;
  existingShots: StoryboardShot[];
  instruction: string;
  aspectRatio?: '9:16' | '16:9';
}): Promise<StoryboardShot> {
  const config = loadApiProviderConfig();
  if (config.providerType !== 'builtin-gemini') {
    const res = await runExternalAddShot(config, params);
    notifyUsageTracked('新增分镜', res.usage);
    return res.shot;
  }
  const data = await postBuiltinGeminiJson<typeof params, { shot: StoryboardShot }>(
    '/api/gemini/add-shot',
    params,
    '新增分镜'
  );
  return data.shot;
}

export const CHATBOT_PERSONAS: Array<{
  id: ChatbotPersonaId;
  label: string;
  roleTitle: string;
}> = [
  {
    id: 'script-coach',
    label: '爆款脚本顾问',
    roleTitle: '金牌短视频口播与情绪节奏顾问',
  },
  {
    id: 'visual-director',
    label: '分镜视觉导演',
    roleTitle: '竖屏/横屏视觉与 Midjourney 提示词导演',
  },
  {
    id: 'algorithm-auditor',
    label: '平台风控与算法官',
    roleTitle: '完播率诊断与平台合规审校官',
  },
];

export const CHATBOT_MODEL_MODES: Array<{
  id: ChatbotModelMode;
  label: string;
  model: string;
}> = [
  {
    id: 'flash',
    label: '通用闪速 (gemini-3.8-flash · 默认推荐)',
    model: 'gemini-3.8-flash',
  },
  {
    id: 'hydrogen',
    label: '前沿推理 (gemini-4-hydrogen)',
    model: 'gemini-4-hydrogen',
  },
  {
    id: 'argon',
    label: '深度架构 (gemini-4-argon)',
    model: 'gemini-4-argon',
  },
  {
    id: 'fast',
    label: '极速轻量 (gemini-3.1-flash-lite)',
    model: 'gemini-3.1-flash-lite',
  },
];

export async function runChatbotTurn(params: {
  personaId: ChatbotPersonaId;
  modeId: ChatbotModelMode;
  projectContextSummary: string;
  history: Array<{ role: 'user' | 'model'; content: string }>;
  userMessage: string;
}): Promise<{ reply: string; modelUsed: string }> {
  const config = loadApiProviderConfig();
  if (config.providerType !== 'builtin-gemini') {
    const res = await runExternalChatbotTurn(config, params);
    notifyUsageTracked('AI 顾问对话', res.usage);
    return { reply: res.reply, modelUsed: res.modelUsed };
  }
  return postBuiltinGeminiJson('/api/gemini/chatbot', params, 'AI 顾问对话');
}
