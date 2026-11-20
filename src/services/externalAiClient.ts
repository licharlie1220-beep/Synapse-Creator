import type {
  ApiProviderConfig,
  BrainstormAttachmentPayload,
  BrainstormDirection,
  ChatbotModelMode,
  ChatbotPersonaId,
  GroundingSource,
  RiskAuditReport,
  StoryboardShot,
  TokenUsageSummary,
} from '../types/workspace';
import {
  buildAddShotPrompts,
  buildBrainstormPrompts,
  buildBranchChatPrompts,
  buildEditShotPrompts,
  buildGenerateScriptPrompts,
  buildInlineEditPrompts,
  buildRiskAuditPrompts,
  buildStoryboardPrompts,
  cleanBaseMjPromptText,
} from '../utils/aiPrompts';
import { formatFriendlyErrorMessage, parseLooseJsonSafe } from '../utils/workflow';

const CLIENT_PERSONA_INSTRUCTIONS: Record<ChatbotPersonaId, string> = {
  'script-coach':
    '你是金牌短视频口播编剧与爆款策划顾问，专注抖音、小红书与B站竖屏内容。请结合当前项目上下文（选题、立项简报与脚本草稿），以多轮对话方式帮创作者打磨前3秒黄金钩子、口语化表达、转折情绪张力与互动评论诱饵。回答直接给可执行建议和改写示范，避免空话。',
  'visual-director':
    '你是资深广告与短视频视觉导演，精通 9:16 竖屏与 16:9 横屏安全区构图、景别交替节奏（ECU/CU/MCU/MS/WS）、静态首帧吸睛原则、35mm电影胶片质感以及不含 --v 版本尾缀的 Midjourney 英文提示词工程。请围绕当前项目为创作者提供分镜画面设计、单镜风格设定与运镜调度建议。',
  'algorithm-auditor':
    '你是铁面无私的短视频平台推荐算法策略师与内容风控审校官。你的职责是识别口播稿中的违禁极限词、虚假宣传风险、前3秒跳出隐患与低完播结构，并给出合规替代话术和留存率拉升方案。',
};

const REQUEST_TIMEOUT_MS = 90000;

function formatHttpStatusError(status: number, providerLabel: string, detail?: string): string {
  const cleanDetail = detail ? `：${detail}` : '';
  if (status === 401) {
    return `${providerLabel} API Key 无效或已过期（HTTP 401）${cleanDetail}，请在设置中核对本地保存的密钥。`;
  }
  if (status === 403) {
    return `${providerLabel} 接口权限不足或账户余额受限（HTTP 403）${cleanDetail}。`;
  }
  if (status === 404) {
    return `${providerLabel} 接口地址或模型名称不存在（HTTP 404）${cleanDetail}。`;
  }
  if (status === 429) {
    return `${providerLabel} 请求频次或配额达到上限（HTTP 429）${cleanDetail}，请稍后重试。`;
  }
  if (status >= 500) {
    return `${providerLabel} 模型服务端暂时繁忙（HTTP ${status}）${cleanDetail}，请稍后重试。`;
  }
  return `${providerLabel} 接口请求失败（HTTP ${status}）${cleanDetail}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timerId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('外部模型接口请求超时，请检查网络连接后重试。');
    }
    throw new Error(
      formatFriendlyErrorMessage(
        err,
        '无法直连外部模型接口，请检查网络及目标接口跨域（CORS）设置。'
      )
    );
  } finally {
    window.clearTimeout(timerId);
  }
}

async function callDirectClaudeApi(params: {
  config: ApiProviderConfig;
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  imageAttachments?: BrainstormAttachmentPayload[];
}): Promise<{ text: string; usage: TokenUsageSummary }> {
  const baseUrl = (params.config.baseUrl || 'https://api.anthropic.com').trim().replace(/\/+$/, '');
  const model = (params.config.model || 'claude-sonnet-5-5').trim();
  const apiKey = (params.config.apiKey || '').trim();

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error('Claude 接口 Base URL 格式无效，请以 https:// 开头。');
  }
  if (!model) {
    throw new Error('请在模型设置中填写 Claude 模型名称（如 claude-sonnet-5-5）。');
  }
  if (!apiKey) {
    throw new Error('请在工作台设置中填写你本地保存的 Claude API Key。');
  }
  if (apiKey.startsWith('AQ.') || apiKey.startsWith('AIzaSy')) {
    throw new Error(
      '检测到你当前填写的是 Google Gemini 官方 API Key（以 AQ./AIza 开头），不能用于 Claude。请在右上角「设置 ➜ AI 服务商」中切换回「内置 Gemini（默认）」。'
    );
  }

  const endpoint = baseUrl.endsWith('/messages')
    ? baseUrl
    : baseUrl.endsWith('/v1')
    ? `${baseUrl}/messages`
    : `${baseUrl}/v1/messages`;

  const imageBlocks = (params.imageAttachments ?? [])
    .filter((a) => a.kind === 'image' && a.base64Data)
    .map((a) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: a.mimeType || 'image/png',
        data: a.base64Data!,
      },
    }));

  const anthropicMessages = params.messages.map((m, idx) => {
    const isLastUser = idx === params.messages.length - 1 && m.role === 'user';
    if (isLastUser && imageBlocks.length > 0) {
      return {
        role: 'user' as const,
        content: [...imageBlocks, { type: 'text', text: m.content }],
      };
    }
    return { role: m.role, content: m.content };
  });

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: params.systemInstruction,
      messages: anthropicMessages,
    }),
  });

  const rawText = await res.text().catch(() => '');
  if (!res.ok) {
    let detail = '';
    try {
      const errJson = JSON.parse(rawText) as { error?: { message?: string }; message?: string };
      detail = errJson.error?.message || errJson.message || '';
    } catch {
      detail = rawText.slice(0, 140);
    }
    throw new Error(formatHttpStatusError(res.status, 'Claude', detail));
  }

  let data: {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error('Claude 接口返回了非有效 JSON 格式响应，请检查接口地址是否正确。');
  }

  const text = (data.content ?? [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
    .trim();
  const promptTokens = Number(data.usage?.input_tokens || 0);
  const candidatesTokens = Number(data.usage?.output_tokens || 0);

  return {
    text,
    usage: {
      promptTokens,
      candidatesTokens,
      totalTokens: promptTokens + candidatesTokens,
      model: data.model || model,
    },
  };
}

async function callDirectOpenAiResponsesApi(params: {
  config: ApiProviderConfig;
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectJson?: boolean;
  imageAttachments?: BrainstormAttachmentPayload[];
}): Promise<{ text: string; usage: TokenUsageSummary }> {
  const baseUrl = (params.config.baseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  const model = (params.config.model || 'gpt-6.2-sol').trim();
  const apiKey = (params.config.apiKey || '').trim();

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error('OpenAI 接口 Base URL 格式无效，请以 https:// 开头。');
  }
  if (!model) {
    throw new Error('请在模型设置中填写 OpenAI 模型名称（如 gpt-6.2-sol）。');
  }
  if (!apiKey) {
    throw new Error('请在工作台设置中填写你本地保存的 OpenAI API Key。');
  }

  const endpoint = baseUrl.endsWith('/responses') ? baseUrl : `${baseUrl}/responses`;
  const imageItems = (params.imageAttachments ?? [])
    .filter((a) => a.kind === 'image' && a.base64Data)
    .map((a) => ({
      type: 'input_image',
      image_url: `data:${a.mimeType || 'image/png'};base64,${a.base64Data!}`,
    }));

  const inputItems = params.messages.map((m, idx) => {
    const isLastUser = idx === params.messages.length - 1 && m.role === 'user';
    if (isLastUser && imageItems.length > 0) {
      return {
        role: 'user',
        content: [{ type: 'input_text', text: m.content }, ...imageItems],
      };
    }
    return {
      role: m.role,
      content: m.content,
    };
  });

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: params.systemInstruction,
      input: inputItems,
      ...(params.expectJson ? { text: { format: { type: 'json_object' } } } : {}),
    }),
  });

  const rawText = await res.text().catch(() => '');
  if (!res.ok) {
    let detail = '';
    try {
      const errJson = JSON.parse(rawText) as {
        error?: { message?: string } | string;
        message?: string;
      };
      detail =
        typeof errJson.error === 'string'
          ? errJson.error
          : errJson.error?.message || errJson.message || '';
    } catch {
      detail = rawText.slice(0, 140);
    }
    throw new Error(formatHttpStatusError(res.status, 'OpenAI', detail));
  }

  let data: {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    model?: string;
  };
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error('OpenAI 接口返回了非有效 JSON 格式响应，请检查接口地址是否正确。');
  }

  const collectedParts = (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((c) => typeof c.text === 'string' && c.text)
    .map((c) => c.text as string);
  const text = (data.output_text || collectedParts.join('\n')).trim();

  const promptTokens = Number(data.usage?.input_tokens || 0);
  const candidatesTokens = Number(data.usage?.output_tokens || 0);
  const totalTokens = Number(data.usage?.total_tokens || promptTokens + candidatesTokens);

  return {
    text,
    usage: {
      promptTokens,
      candidatesTokens,
      totalTokens,
      model: data.model || model,
    },
  };
}

async function callDirectOpenAiCompatibleApi(params: {
  config: ApiProviderConfig;
  systemInstruction: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectJson?: boolean;
  imageAttachments?: BrainstormAttachmentPayload[];
}): Promise<{ text: string; usage: TokenUsageSummary }> {
  if (params.config.providerType === 'claude') {
    return callDirectClaudeApi({
      config: params.config,
      systemInstruction: params.systemInstruction,
      messages: params.messages,
      imageAttachments: params.imageAttachments,
    });
  }

  const baseUrl = (params.config.baseUrl || '').trim().replace(/\/+$/, '');
  if (
    params.config.providerType === 'openai' &&
    !baseUrl.endsWith('/chat/completions')
  ) {
    return callDirectOpenAiResponsesApi(params);
  }

  const model = (params.config.model || '').trim();
  const apiKey = (params.config.apiKey || '').trim();

  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error('外部模型接口 Base URL 格式无效，请以 https:// 开头。');
  }
  if (!model) {
    throw new Error('请在模型设置中填写模型名称（如 deepseek-flash / gpt-6.2-sol）。');
  }
  if (!apiKey) {
    throw new Error('请在工作台设置中填写你本地保存的 API Key。');
  }
  if (apiKey.startsWith('AQ.') || apiKey.startsWith('AIzaSy')) {
    throw new Error(
      '检测到你当前填写的是 Google Gemini 官方 API Key（以 AQ./AIza 开头），不能用于第三方服务商（DeepSeek/OpenAI）。请在右上角「设置 ➜ AI 服务商」中切换回「内置 Gemini（默认）」。'
    );
  }

  const endpoint = baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : `${baseUrl}/chat/completions`;

  const imageBlocks = (params.imageAttachments ?? [])
    .filter((a) => a.kind === 'image' && a.base64Data)
    .map((a) => ({
      type: 'image_url',
      image_url: {
        url: `data:${a.mimeType || 'image/png'};base64,${a.base64Data!}`,
      },
    }));

  const formattedMessages = params.messages.map((m, idx) => {
    const isLastUser = idx === params.messages.length - 1 && m.role === 'user';
    if (isLastUser && imageBlocks.length > 0) {
      return {
        role: 'user',
        content: [{ type: 'text', text: m.content }, ...imageBlocks],
      };
    }
    return { role: m.role, content: m.content };
  });

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: params.systemInstruction },
        ...formattedMessages,
      ],
      ...(params.expectJson ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  const rawText = await res.text().catch(() => '');
  const providerLabel =
    params.config.providerType === 'deepseek'
      ? 'DeepSeek'
      : params.config.providerType === 'openai'
      ? 'OpenAI'
      : '外部模型';

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = JSON.parse(rawText) as {
        error?: { message?: string } | string;
        message?: string;
      };
      detail =
        typeof errJson.error === 'string'
          ? errJson.error
          : errJson.error?.message || errJson.message || '';
    } catch {
      detail = rawText.slice(0, 140);
    }
    throw new Error(formatHttpStatusError(res.status, providerLabel, detail));
  }

  let data: {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  };
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`${providerLabel} 接口返回了非有效 JSON 格式响应，请检查接口地址是否正确。`);
  }

  const text = data.choices?.[0]?.message?.content?.trim() || '';
  const promptTokens = Number(data.usage?.prompt_tokens || 0);
  const candidatesTokens = Number(data.usage?.completion_tokens || 0);
  const totalTokens = Number(data.usage?.total_tokens || promptTokens + candidatesTokens);

  return {
    text,
    usage: {
      promptTokens,
      candidatesTokens,
      totalTokens,
      model: data.model || model,
    },
  };
}

export async function runExternalBrainstorm(
  config: ApiProviderConfig,
  params: {
    projectName: string;
    platform: string;
    topic: string;
    userMessage: string;
    history: Array<{ role: string; content: string }>;
    attachments?: BrainstormAttachmentPayload[];
  }
): Promise<{
  reply: string;
  directions: BrainstormDirection[];
  groundingSources: GroundingSource[];
  usage: TokenUsageSummary;
}> {
  const attachments = params.attachments ?? [];
  const imageAtts = attachments.filter((a) => a.kind === 'image' && a.base64Data);
  const videoAtts = attachments.filter((a) => a.kind === 'video' && a.base64Data);

  if (videoAtts.length > 0) {
    throw new Error(
      '视频多模态文件直读分析需要内置 Gemini 引擎；当前外部模型接口暂不支持视频直读，请切换回「内置 Gemini」或改传图片/文本文件。'
    );
  }
  if (
    imageAtts.length > 0 &&
    config.providerType !== 'openai' &&
    config.providerType !== 'claude' &&
    config.providerType !== 'deepseek'
  ) {
    throw new Error(
      '当前选择的自定义接口不支持图片直读；请切换至「内置 Gemini」、「DeepSeek (V4)」、「OpenAI」或「Claude」，或改传 .txt/.md/.csv 文本文件。'
    );
  }

  const { systemInstruction, prompt } = buildBrainstormPrompts({
    ...params,
    attachments: attachments.filter((a) => a.kind !== 'video'),
    expectJsonInstruction: true,
  });

  const res = await callDirectOpenAiCompatibleApi({
    config,
    systemInstruction,
    messages: [{ role: 'user', content: prompt }],
    expectJson: config.providerType !== 'claude',
    imageAttachments: imageAtts,
  });

  const parsed = parseLooseJsonSafe<{
    reply?: string;
    directions?: Array<{
      title: string;
      angle: string;
      hook: string;
      audience: string;
      verifiedFacts?: string;
    }>;
  }>(res.text);

  return {
    reply:
      parsed.reply ||
      '已根据你的需求拆解以下高传播潜力方向，点击右下角「+ 独立分支展开」可并行深挖：',
    directions: (parsed.directions ?? []).slice(0, 4).map((d, index) => ({
      id: `dir_${Date.now()}_${index + 1}`,
      title: d.title,
      angle: d.angle,
      hook: d.hook,
      audience: d.audience,
      verifiedFacts: d.verifiedFacts || undefined,
    })),
    groundingSources: [],
    usage: res.usage,
  };
}

export async function runExternalBranchChat(
  config: ApiProviderConfig,
  params: {
    projectName: string;
    platform: string;
    topic: string;
    branchTitle: string;
    initialAngle: string;
    initialHook: string;
    messages: Array<{ role: string; content: string }>;
    userMessage: string;
  }
): Promise<{
  reply: string;
  suggestedConclusion?: string;
  groundingSources: GroundingSource[];
  usage: TokenUsageSummary;
}> {
  const { systemInstruction, prompt } = buildBranchChatPrompts(params);
  const res = await callDirectOpenAiCompatibleApi({
    config,
    systemInstruction,
    messages: [{ role: 'user', content: prompt }],
  });
  const conclusionMatch = res.text.match(/【核心结论更新】\s*([\s\S]+)$/);
  return {
    reply: res.text,
    suggestedConclusion: conclusionMatch ? conclusionMatch[1].trim() : undefined,
    groundingSources: [],
    usage: res.usage,
  };
}

export async function runExternalRiskAudit(
  config: ApiProviderConfig,
  params: {
    projectName: string;
    platform: string;
    topic: string;
    activeBranch: { title: string; coreConclusion: string; initialHook: string } | null;
    directions: Array<{ title: string; angle: string; hook: string }>;
  }
): Promise<RiskAuditReport & { usage: TokenUsageSummary }> {
  const { systemInstruction, prompt } = buildRiskAuditPrompts({
    ...params,
    expectJsonInstruction: true,
  });
  const res = await callDirectOpenAiCompatibleApi({
    config,
    systemInstruction,
    messages: [{ role: 'user', content: prompt }],
    expectJson: config.providerType !== 'claude',
  });

  const parsed = parseLooseJsonSafe<{
    summary?: string;
    dataSkepticism?: Array<{ claim: string; issue: string; suggestion: string }>;
    complianceRisks?: Array<{ point: string; severity: string; fix: string }>;
    hookVulnerabilities?: Array<{ flaw: string; rewriteSuggestion: string }>;
  }>(res.text);

  return {
    id: `audit_${Date.now()}`,
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    summary: parsed.summary || '已完成全维度审校体检。',
    dataSkepticism: parsed.dataSkepticism ?? [],
    complianceRisks: (parsed.complianceRisks ?? []).map((c) => ({
      point: c.point,
      severity:
        c.severity === 'high' || c.severity === 'medium' || c.severity === 'low'
          ? c.severity
          : 'medium',
      fix: c.fix,
    })),
    hookVulnerabilities: parsed.hookVulnerabilities ?? [],
    groundingSources: [],
    usage: res.usage,
  };
}

export async function runExternalGenerateScript(
  config: ApiProviderConfig,
  params: {
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
  }
): Promise<{ script: string; usage: TokenUsageSummary }> {
  const { systemInstruction, prompt } = buildGenerateScriptPrompts(params);
  const res = await callDirectOpenAiCompatibleApi({
    config,
    systemInstruction,
    messages: [{ role: 'user', content: prompt }],
  });
  return { script: res.text, usage: res.usage };
}

export async function runExternalInlineEdit(
  config: ApiProviderConfig,
  params: {
    fullScript: string;
    selectedText: string;
    instruction: string;
    platform: string;
  }
): Promise<{ replacement: string; usage: TokenUsageSummary }> {
  const { systemInstruction, prompt } = buildInlineEditPrompts(params);
  const res = await callDirectOpenAiCompatibleApi({
    config,
    systemInstruction,
    messages: [{ role: 'user', content: prompt }],
  });
  return {
    replacement: res.text.replace(/^["“]|["”]$/g, ''),
    usage: res.usage,
  };
}

export async function runExternalStoryboard(
  config: ApiProviderConfig,
  params: {
    projectName: string;
    platform: string;
    scriptContent: string;
    aspectRatio?: '9:16' | '16:9';
  }
): Promise<{ shots: StoryboardShot[]; usage: TokenUsageSummary }> {
  const { systemInstruction, prompt } = buildStoryboardPrompts({
    ...params,
    expectJsonInstruction: true,
  });
  const res = await callDirectOpenAiCompatibleApi({
    config,
    systemInstruction,
    messages: [{ role: 'user', content: prompt }],
    expectJson: config.providerType !== 'claude',
  });
  const parsed = parseLooseJsonSafe<{
    shots?: Array<{
      shotNumber: number;
      shotSize: string;
      durationSec: number;
      visualDescription: string;
      dialogue: string;
      baseMjPrompt: string;
      cameraMovement: string;
    }>;
  }>(res.text);

  return {
    shots: (parsed.shots ?? []).map((s, idx) => ({
      id: `shot_${Date.now()}_${idx + 1}`,
      shotNumber: s.shotNumber || idx + 1,
      shotSize: s.shotSize,
      durationSec: Math.max(2, Math.min(15, s.durationSec || 4)),
      visualDescription: s.visualDescription,
      dialogue: s.dialogue,
      baseMjPrompt: cleanBaseMjPromptText(s.baseMjPrompt),
      cameraMovement: s.cameraMovement,
    })),
    usage: res.usage,
  };
}

export async function runExternalEditShot(
  config: ApiProviderConfig,
  params: {
    projectName: string;
    platform: string;
    shot: StoryboardShot;
    instruction: string;
    aspectRatio?: '9:16' | '16:9';
    shotHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }
): Promise<Partial<StoryboardShot> & { assistantReply: string; usage: TokenUsageSummary }> {
  const { systemInstruction, prompt } = buildEditShotPrompts({
    ...params,
    expectJsonInstruction: true,
  });
  const res = await callDirectOpenAiCompatibleApi({
    config,
    systemInstruction,
    messages: [{ role: 'user', content: prompt }],
    expectJson: config.providerType !== 'claude',
  });
  const parsed = parseLooseJsonSafe<{
    assistantReply?: string;
    styleNote?: string;
    shotSize: string;
    durationSec: number;
    visualDescription: string;
    dialogue: string;
    baseMjPrompt: string;
    cameraMovement: string;
  }>(res.text);

  return {
    assistantReply: parsed.assistantReply || '已按你的对话指令更新当前镜头的画风与提示词。',
    styleNote: parsed.styleNote || params.shot.styleNote,
    shotSize: parsed.shotSize || params.shot.shotSize,
    durationSec: parsed.durationSec || params.shot.durationSec,
    visualDescription: parsed.visualDescription || params.shot.visualDescription,
    dialogue: parsed.dialogue || params.shot.dialogue,
    baseMjPrompt: cleanBaseMjPromptText(parsed.baseMjPrompt || params.shot.baseMjPrompt),
    cameraMovement: parsed.cameraMovement || params.shot.cameraMovement,
    usage: res.usage,
  };
}

export async function runExternalAddShot(
  config: ApiProviderConfig,
  params: {
    projectName: string;
    platform: string;
    scriptContent: string;
    existingShots: StoryboardShot[];
    instruction: string;
    aspectRatio?: '9:16' | '16:9';
  }
): Promise<{ shot: StoryboardShot; usage: TokenUsageSummary }> {
  const { nextNumber, systemInstruction, prompt } = buildAddShotPrompts({
    ...params,
    expectJsonInstruction: true,
  });
  const res = await callDirectOpenAiCompatibleApi({
    config,
    systemInstruction,
    messages: [{ role: 'user', content: prompt }],
    expectJson: config.providerType !== 'claude',
  });
  const parsed = parseLooseJsonSafe<{
    shotSize: string;
    durationSec: number;
    visualDescription: string;
    dialogue: string;
    baseMjPrompt: string;
    cameraMovement: string;
    styleNote?: string;
  }>(res.text);

  return {
    shot: {
      id: `shot_${Date.now()}_${nextNumber}`,
      shotNumber: nextNumber,
      shotSize: parsed.shotSize || '中景 MS',
      durationSec: Math.max(2, Math.min(15, parsed.durationSec || 4)),
      visualDescription: parsed.visualDescription || params.instruction,
      dialogue: parsed.dialogue || '（画面转场留白）',
      baseMjPrompt: cleanBaseMjPromptText(parsed.baseMjPrompt),
      cameraMovement: parsed.cameraMovement || '平稳推进（Slow Push-in）',
      styleNote: parsed.styleNote || undefined,
    },
    usage: res.usage,
  };
}

export async function runExternalChatbotTurn(
  config: ApiProviderConfig,
  params: {
    personaId: ChatbotPersonaId;
    modeId: ChatbotModelMode;
    projectContextSummary: string;
    history: Array<{ role: 'user' | 'model'; content: string }>;
    userMessage: string;
  }
): Promise<{ reply: string; modelUsed: string; usage: TokenUsageSummary }> {
  const personaInstruction =
    CLIENT_PERSONA_INSTRUCTIONS[params.personaId] ?? CLIENT_PERSONA_INSTRUCTIONS['script-coach'];
  const systemInstruction = [
    personaInstruction,
    `当前工作台项目实时上下文：\n${params.projectContextSummary}`,
  ].join('\n\n');

  const historyMsgs = params.history.slice(-12).map((item) => ({
    role: (item.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: item.content,
  }));

  const res = await callDirectOpenAiCompatibleApi({
    config,
    systemInstruction,
    messages: [...historyMsgs, { role: 'user', content: params.userMessage }],
  });

  return {
    reply: res.text || '暂未生成有效回复，请调整提问后重试。',
    modelUsed: res.usage.model,
    usage: res.usage,
  };
}
