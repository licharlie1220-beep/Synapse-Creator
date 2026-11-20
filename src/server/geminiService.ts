import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  BrainstormAttachmentPayload,
  BrainstormDirection,
  ChatbotModelMode,
  ChatbotPersonaId,
  GroundingSource,
  RiskAuditReport,
  StoryboardShot,
  TokenUsageSummary,
} from '../types/workspace.ts';
import {
  formatFriendlyErrorMessage,
  parseLooseJsonSafe,
  stripMidjourneyVersionFlags,
} from '../utils/workflow.ts';
import {
  COPYWRITING_RULES_MARKDOWN,
  type EnhancedHookProposal,
  type GeneratedScriptCandidate,
} from '../rules/copywritingRules.ts';

export class GeminiServerError extends Error {
  statusCode: number;
  statusText?: string;
  rawDetails?: string;

  constructor(
    message: string,
    statusCode = 500,
    statusText?: string,
    rawDetails?: string
  ) {
    super(message);
    this.name = 'GeminiServerError';
    this.statusCode = statusCode;
    this.statusText = statusText;
    this.rawDetails = rawDetails;
  }
}

export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
export const PRIMARY_FALLBACK_MODEL = 'gemini-3.8-flash';
export const SECONDARY_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function getServerAiClient(customKey?: string): GoogleGenAI {
  const apiKey = (
    customKey ||
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY
  )?.trim();
  if (!apiKey) {
    throw new GeminiServerError(
      '[Google API 错误 HTTP 401 · MISSING_API_KEY]: 尚未检测到有效 Gemini API Key，请在工作台右上角「设置 > AI 服务商」中输入你的 Gemini API Key 并选择模型。',
      401,
      'MISSING_API_KEY',
      'API Key is missing or empty'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractGeminiUsage(response: unknown, model: string): TokenUsageSummary {
  const r = response as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const promptTokens = Number(r?.usageMetadata?.promptTokenCount || 0);
  const candidatesTokens = Number(r?.usageMetadata?.candidatesTokenCount || 0);
  const totalTokens = Number(
    r?.usageMetadata?.totalTokenCount || promptTokens + candidatesTokens
  );
  return {
    promptTokens,
    candidatesTokens,
    totalTokens,
    model,
  };
}

function extractGroundingSources(response: unknown): GroundingSource[] {
  const r = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
      };
    }>;
  };
  const chunks = r?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundingSource[] = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title || uri;
    if (uri && title && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title, uri });
    }
  }
  return sources.slice(0, 6);
}

export function formatGeminiError(err: unknown): GeminiServerError {
  if (err instanceof GeminiServerError) return err;

  const rawMsg =
    err instanceof Error
      ? err.message
      : typeof (err as any)?.message === 'string'
      ? (err as any).message
      : String(err);
  let status = (err as any)?.status || (err as any)?.statusCode;
  let rawReason = '';
  let googleStatus = '';

  // Extract JSON error payload if available from Google GenAI SDK
  try {
    const jsonMatch = rawMsg.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error) {
        if (!status && parsed.error.code) status = Number(parsed.error.code);
        rawReason = parsed.error.message || '';
        googleStatus = parsed.error.status || '';
      }
    }
  } catch {}

  if (!status) {
    const codeMatch = rawMsg.match(/\b(400|401|403|404|429|500|502|503)\b/);
    if (codeMatch) status = Number(codeMatch[1]);
  }

  status = Number(status) || 500;

  if (
    status === 401 ||
    rawMsg.includes('API_KEY_INVALID') ||
    rawMsg.includes('API key not valid')
  ) {
    return new GeminiServerError(
      `[Google API 错误 HTTP 401 · UNAUTHENTICATED]: API Key 鉴权失败，请检查设置中填写的 Gemini API Key 是否正确或已过期。${rawReason ? `\n详细信息: ${rawReason}` : ''}`,
      401,
      'UNAUTHENTICATED',
      rawReason || rawMsg
    );
  }

  if (status === 403 || rawMsg.includes('PERMISSION_DENIED')) {
    return new GeminiServerError(
      `[Google API 错误 HTTP 403 · PERMISSION_DENIED]: API 权限校验失败，当前 API Key 权限不足或未开通该模型。${rawReason ? `\n详细信息: ${rawReason}` : ''}`,
      403,
      'PERMISSION_DENIED',
      rawReason || rawMsg
    );
  }

  if (status === 404 || rawMsg.includes('NOT_FOUND')) {
    return new GeminiServerError(
      `[Google API 错误 HTTP 404 · NOT_FOUND]: 请求的模型不存在或不可用，请在设置中选择其他可用模型。${rawReason ? `\n详细信息: ${rawReason}` : ''}`,
      404,
      'NOT_FOUND',
      rawReason || rawMsg
    );
  }

  if (status === 429 || rawMsg.includes('RESOURCE_EXHAUSTED')) {
    return new GeminiServerError(
      `[Google API 错误 HTTP 429 · RESOURCE_EXHAUSTED]: API 请求频次或配额达到上限，请稍后片刻再试。${rawReason ? `\n详细信息: ${rawReason}` : ''}`,
      429,
      'RESOURCE_EXHAUSTED',
      rawReason || rawMsg
    );
  }

  if (status === 503 || rawMsg.includes('UNAVAILABLE')) {
    return new GeminiServerError(
      `[Google API 错误 HTTP 503 · UNAVAILABLE]: 模型服务算力拥堵高负载繁忙，请稍后重试。${rawReason ? `\n详细信息: ${rawReason}` : ''}`,
      503,
      'UNAVAILABLE',
      rawReason || rawMsg
    );
  }

  if (status === 400 || rawMsg.includes('INVALID_ARGUMENT')) {
    return new GeminiServerError(
      `[Google API 错误 HTTP 400 · INVALID_ARGUMENT]: 请求参数无效或格式错误。${rawReason ? `\n详细信息: ${rawReason}` : ''}`,
      400,
      'INVALID_ARGUMENT',
      rawReason || rawMsg
    );
  }

  return new GeminiServerError(
    `[Google API 错误 HTTP ${status}${googleStatus ? ` · ${googleStatus}` : ''}]: ${rawReason || rawMsg}`,
    status,
    googleStatus,
    rawReason || rawMsg
  );
}

function is503Error(err: unknown): boolean {
  if (!err) return false;
  const status = (err as any)?.status || (err as any)?.statusCode;
  if (Number(status) === 503) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('Spikes in demand') ||
    msg.includes('The service is currently unavailable')
  );
}

export interface GeminiCallExecutionResult<T> {
  result: T;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}

export async function callGeminiWithRetryAndFallback<T>(
  targetModel: string | undefined,
  customKey: string | undefined,
  operation: (ai: GoogleGenAI, activeModel: string) => Promise<T>
): Promise<GeminiCallExecutionResult<T>> {
  const ai = getServerAiClient(customKey);
  const initialModel = targetModel || DEFAULT_GEMINI_MODEL;

  let last503Error: unknown = null;

  // Attempt initial model with at most 2 retries (total 3 attempts) on 503
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const result = await operation(ai, initialModel);
      return {
        result,
        modelUsed: initialModel,
        fallbackOccurred: false,
      };
    } catch (err) {
      if (is503Error(err)) {
        last503Error = err;
        if (attempt === 0) {
          console.warn(`[Gemini API 503] Model ${initialModel} busy. Waiting 2s before retry 1/2...`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        } else if (attempt === 1) {
          console.warn(`[Gemini API 503] Model ${initialModel} still busy. Waiting 4s before retry 2/2...`);
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        // attempt === 2 exhausted, fall through to fallback
      } else {
        // Non-503 error throws immediately with original status code and raw reasons
        throw formatGeminiError(err);
      }
    }
  }

  // If retries exhausted and still 503, initiate automatic seamless fallback
  const fallbackModel =
    initialModel !== PRIMARY_FALLBACK_MODEL
      ? PRIMARY_FALLBACK_MODEL
      : SECONDARY_FALLBACK_MODEL;

  console.warn(
    `[Gemini API Fallback] ${initialModel} returned 503 after 2 retries. Seamlessly falling back to ${fallbackModel}...`
  );

  try {
    const result = await operation(ai, fallbackModel);
    return {
      result,
      modelUsed: fallbackModel,
      fallbackOccurred: true,
      fallbackModel,
      fallbackNotice: `检测到模型 ${initialModel} 算力拥堵(503)，已自动为您无缝切换至备用模型 ${fallbackModel} 完成当前生成，创作流程不受影响。`,
    };
  } catch (fallbackErr) {
    // If even fallback fails with 503, try secondary fallback once
    if (is503Error(fallbackErr) && fallbackModel !== SECONDARY_FALLBACK_MODEL) {
      try {
        console.warn(`[Gemini API Fallback] ${fallbackModel} also busy. Trying secondary ${SECONDARY_FALLBACK_MODEL}...`);
        const result = await operation(ai, SECONDARY_FALLBACK_MODEL);
        return {
          result,
          modelUsed: SECONDARY_FALLBACK_MODEL,
          fallbackOccurred: true,
          fallbackModel: SECONDARY_FALLBACK_MODEL,
          fallbackNotice: `检测到模型算力拥堵(503)，已自动无缝切换至超轻量备用模型 ${SECONDARY_FALLBACK_MODEL} 完成当前生成，创作流程不受影响。`,
        };
      } catch (secErr) {
        throw formatGeminiError(secErr);
      }
    }
    throw formatGeminiError(fallbackErr || last503Error);
  }
}

function parseLooseJson<T>(raw: string): T {
  try {
    return parseLooseJsonSafe<T>(raw);
  } catch (err) {
    throw new GeminiServerError(
      err instanceof Error ? err.message : '模型返回的内容不是有效 JSON 格式，请重试。',
      502
    );
  }
}

function cleanBaseMjPrompt(raw: string): string {
  return stripMidjourneyVersionFlags(raw || '')
    .replace(/\s*--(?:ar|style|stylize|q|quality)\s+\S+/gi, '')
    .trim();
}

async function runSearchGroundingLookup(
  ai: GoogleGenAI,
  query: string,
  modelName: string
): Promise<{ factSummary: string; sources: GroundingSource[]; usage: TokenUsageSummary }> {
  const res = await ai.models.generateContent({
    model: modelName,
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction:
        '你是一名事实核查研究员。请使用 Google Search 检索与主题相关的最新权威数据、词典释义、行业事实或争议点，并用中文简明扼要地列出已核实要点（不超过350字）。',
    },
  });
  return {
    factSummary: res.text?.trim() || '',
    sources: extractGroundingSources(res),
    usage: extractGeminiUsage(res, modelName),
  };
}

function mergeUsage(a: TokenUsageSummary, b?: TokenUsageSummary): TokenUsageSummary {
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    candidatesTokens: a.candidatesTokens + b.candidatesTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    model: a.model,
  };
}

export async function runBrainstormServer(params: {
  projectName: string;
  platform: string;
  topic: string;
  userMessage: string;
  history: Array<{ role: string; content: string }>;
  searchGrounding: boolean;
  attachments?: BrainstormAttachmentPayload[];
  customGeminiApiKey?: string;
  model?: string;
}): Promise<{
  reply: string;
  directions: BrainstormDirection[];
  groundingSources: GroundingSource[];
  usage: TokenUsageSummary;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}> {
  const execution = await callGeminiWithRetryAndFallback(
    params.model,
    params.customGeminiApiKey,
    async (ai, activeModel) => {
      const attachments = params.attachments ?? [];
      const textAttachmentBlocks = attachments
        .filter((a) => a.kind === 'text' && a.textContent)
        .map(
          (a) =>
            `【参考文本文件：${a.name}】\n${(a.textContent || '').slice(0, 18000)}`
        )
        .join('\n\n');

      const mediaAttachments = attachments.filter(
        (a) => (a.kind === 'image' || a.kind === 'video') && a.base64Data
      );

      const historyContext = (params.history || [])
        .slice(-6)
        .map((m) => `${m.role === 'user' ? '创作者' : '策划总监'}: ${m.content}`)
        .join('\n');

      const baseInstruction =
        '你是顶级短视频与自媒体策划总监，擅长抖音、小红书、B站内容策划。如果用户投喂了参考文本、图片或视频文件，请先深度拆解其核心结构、叙事节奏、视觉风格、爆点与受众痛点，再严格结合用户的生成/微调要求，产出 3 到 4 个可独立深挖的相似结构或微调创新方向。每个方向都要有明确的切入角度、具有前3秒留存力的具体钩子台词，以及精准受众画像。';

      let groundingSummary = '';
      let groundingSources: GroundingSource[] = [];
      let lookupUsage: TokenUsageSummary | undefined;

      if (params.searchGrounding) {
        try {
          const lookup = await runSearchGroundingLookup(
            ai,
            `自媒体选题事实与趋势检索：项目「${params.projectName}」，核心选题「${params.topic}」，用户问题「${params.userMessage}」`,
            activeModel
          );
          groundingSummary = lookup.factSummary;
          groundingSources = lookup.sources;
          lookupUsage = lookup.usage;
        } catch (err) {
          console.warn('Search grounding lookup failed or rate-limited; falling back to pure LLM inference:', err);
        }
      }

      const prompt = [
        `项目名称：${params.projectName}`,
        `发布平台：${params.platform}`,
        `基础选题：${params.topic}`,
        historyContext ? `历史对话：\n${historyContext}` : '',
        textAttachmentBlocks,
        mediaAttachments.length > 0
          ? `已附加 ${mediaAttachments.length} 个多媒体参考文件（${mediaAttachments
              .map((m) => `${m.name} [${m.kind}]`)
              .join('、')}），请结合画面/视频内容与用户要求进行分析与同类/微调策划生成。`
          : '',
        groundingSummary ? `Google Search 联网检索核实参考：\n${groundingSummary}` : '',
        `创作者当前输入：${params.userMessage}`,
        `请给出简短犀利的策划判断（reply，若包含上传文件需先总结文件分析结论），并拆解 3 到 4 个差异化、可独立深挖的创作方向（directions）。`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const contents =
        mediaAttachments.length > 0
          ? {
              parts: [
                ...mediaAttachments.map((att) => ({
                  inlineData: {
                    mimeType: att.mimeType,
                    data: att.base64Data!,
                  },
                })),
                { text: prompt },
              ],
            }
          : prompt;

      const response = await ai.models.generateContent({
        model: activeModel,
        contents,
        config: {
          systemInstruction:
            baseInstruction +
            '如果提供了联网检索结果，请在 verifiedFacts 字段中提炼客观事实支撑。',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: {
                type: Type.STRING,
                description: '对选题或上传文件分析与潜力的简明总评（80-200字）',
              },
              directions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING, description: '方向标题，如“方向一：xxx”' },
                    angle: { type: Type.STRING, description: '核心切入角度与内容结构' },
                    hook: { type: Type.STRING, description: '前3秒钩子台词或开篇冲突' },
                    audience: { type: Type.STRING, description: '目标受众群体' },
                    verifiedFacts: {
                      type: Type.STRING,
                      description: '联网核实的客观支撑点（如无则留空）',
                    },
                  },
                  required: ['title', 'angle', 'hook', 'audience'],
                },
              },
            },
            required: ['reply', 'directions'],
          },
        },
      });

      const parsed = parseLooseJson<{
        reply?: string;
        directions?: Array<{
          title: string;
          angle: string;
          hook: string;
          audience: string;
          verifiedFacts?: string;
        }>;
      }>(response.text ?? '{}');

      const directions: BrainstormDirection[] = (parsed.directions ?? [])
        .slice(0, 4)
        .map((d, index) => ({
          id: `dir_${Date.now()}_${index + 1}`,
          title: d.title,
          angle: d.angle,
          hook: d.hook,
          audience: d.audience,
          verifiedFacts: d.verifiedFacts || undefined,
        }));

      return {
        reply:
          parsed.reply ||
          '已为你拆解以下高传播潜力方向，点击右下角「+ 独立分支展开」可并行深挖：',
        directions,
        groundingSources,
        usage: mergeUsage(extractGeminiUsage(response, activeModel), lookupUsage),
      };
    }
  );

  return {
    ...execution.result,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackModel: execution.fallbackModel,
    fallbackNotice: execution.fallbackNotice,
  };
}

export async function runBranchChatServer(params: {
  projectName: string;
  platform: string;
  topic: string;
  branchTitle: string;
  initialAngle: string;
  initialHook: string;
  messages: Array<{ role: string; content: string }>;
  userMessage: string;
  searchGrounding: boolean;
  customGeminiApiKey?: string;
  model?: string;
}): Promise<{
  reply: string;
  suggestedConclusion?: string;
  groundingSources: GroundingSource[];
  usage: TokenUsageSummary;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}> {
  const execution = await callGeminiWithRetryAndFallback(
    params.model,
    params.customGeminiApiKey,
    async (ai, activeModel) => {
      const conversation = (params.messages || [])
        .slice(-8)
        .map((m) => `${m.role === 'user' ? '创作者' : '分支策划助手'}: ${m.content}`)
        .join('\n');

      const prompt = [
        `项目：${params.projectName}（${params.platform}） | 总选题：${params.topic}`,
        `当前隔离分支：${params.branchTitle}`,
        `初始角度：${params.initialAngle}`,
        `初始前3秒钩子：${params.initialHook}`,
        conversation ? `分支内上下文：\n${conversation}` : '',
        `创作者最新追问：${params.userMessage}`,
        `请聚焦该分支给出深度可执行建议（含结构节奏、细节案例或台词示范），并在末尾用【核心结论更新】总结一句可直接用于立项简报的凝练结论。`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const systemInstruction =
        '你是专注单个创意分支的深挖策划搭档。你的回复必须紧凑、有实操颗粒度（使用清晰的 Markdown 列表），并在最后一行输出 `【核心结论更新】...` 概括当前分支最新定调。不要泛泛而谈。';

      let response: any;
      try {
        response = await ai.models.generateContent({
          model: activeModel,
          contents: prompt,
          config: {
            tools: params.searchGrounding ? [{ googleSearch: {} }] : undefined,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction,
          },
        });
      } catch (err: any) {
        const msg = String(err?.message || err);
        if (params.searchGrounding && (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED'))) {
          console.warn('Branch chat search grounding rate-limited; retrying without search tool.');
          response = await ai.models.generateContent({
            model: activeModel,
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              systemInstruction,
            },
          });
        } else {
          throw err;
        }
      }

      const fullText = response.text?.trim() || '';
      const conclusionMatch = fullText.match(/【核心结论更新】\s*([\s\S]+)$/);
      const suggestedConclusion = conclusionMatch ? conclusionMatch[1].trim() : undefined;
      const groundingSources = params.searchGrounding ? extractGroundingSources(response) : [];

      return {
        reply: fullText,
        suggestedConclusion,
        groundingSources,
        usage: extractGeminiUsage(response, activeModel),
      };
    }
  );

  return {
    ...execution.result,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackModel: execution.fallbackModel,
    fallbackNotice: execution.fallbackNotice,
  };
}

export async function runRiskAuditServer(params: {
  projectName: string;
  platform: string;
  topic: string;
  activeBranch: { title: string; coreConclusion: string; initialHook: string } | null;
  directions: Array<{ title: string; angle: string; hook: string }>;
  searchGrounding: boolean;
  customGeminiApiKey?: string;
  model?: string;
}): Promise<RiskAuditReport & {
  usage: TokenUsageSummary;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}> {
  const execution = await callGeminiWithRetryAndFallback(
    params.model,
    params.customGeminiApiKey,
    async (ai, activeModel) => {
      const targetContent = params.activeBranch
        ? `当前锁定/深挖分支「${params.activeBranch.title}」\n钩子：${params.activeBranch.initialHook}\n核心结论：${params.activeBranch.coreConclusion}`
        : `主窗口策划方向：\n${params.directions
            .map((d) => `- ${d.title}: ${d.angle}（钩子：${d.hook}）`)
            .join('\n')}`;

      const systemInstruction =
        '你是一位铁面无私的内容风控与短视频审校总监（独立审校人设）。你绝不奉承创作者，专门负责挑刺：1) 数据与事实存疑点（是否绝对化、缺出处或以偏概全）；2) 平台合规风险（抖音/小红书违禁词、极限词、虚假宣传、引战拉踩）；3) 前3秒钩子漏洞（是否拖沓、缺少视觉/听觉抓手、痛点不痛）。请给出犀利且可直接落地的修改方案。';

      let factCheckContext = '';
      let groundingSources: GroundingSource[] = [];
      let lookupUsage: TokenUsageSummary | undefined;

      if (params.searchGrounding) {
        try {
          const lookup = await runSearchGroundingLookup(
            ai,
            `请核查以下自媒体内容是否存在事实错误、过时数据或平台违禁宣传风险：主题「${params.topic}」，方案「${
              params.activeBranch?.coreConclusion ||
              params.directions.map((d) => d.angle).join('；') ||
              ''
            }」`,
            activeModel
          );
          factCheckContext = lookup.factSummary;
          groundingSources = lookup.sources;
          lookupUsage = lookup.usage;
        } catch (err) {
          console.warn('Risk audit search lookup failed or rate-limited; proceeding with LLM audit:', err);
        }
      }

      const response = await ai.models.generateContent({
        model: activeModel,
        contents: [
          `项目：${params.projectName} | 平台：${params.platform} | 选题：${params.topic}`,
          targetContent,
          factCheckContext ? `联网事实检索结果：\n${factCheckContext}` : '',
          `请以最挑剔、毒舌但专业的审校总监视角完成《风险与逻辑体检》。`,
        ]
          .filter(Boolean)
          .join('\n\n'),
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, description: '审校总评（一句话指出最大隐患）' },
              dataSkepticism: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    claim: { type: Type.STRING, description: '存疑表述或数据点' },
                    issue: { type: Type.STRING, description: '潜在事实或逻辑漏洞' },
                    suggestion: { type: Type.STRING, description: '严谨化修改建议' },
                  },
                  required: ['claim', 'issue', 'suggestion'],
                },
              },
              complianceRisks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    point: { type: Type.STRING, description: '触发平台审核的风险点' },
                    severity: {
                      type: Type.STRING,
                      description: '风险等级：high, medium, 或 low',
                    },
                    fix: { type: Type.STRING, description: '安全替代话术' },
                  },
                  required: ['point', 'severity', 'fix'],
                },
              },
              hookVulnerabilities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    flaw: { type: Type.STRING, description: '前3秒钩子薄弱点' },
                    rewriteSuggestion: { type: Type.STRING, description: '直接可用的改写钩子' },
                  },
                  required: ['flaw', 'rewriteSuggestion'],
                },
              },
            },
            required: ['summary', 'dataSkepticism', 'complianceRisks', 'hookVulnerabilities'],
          },
        },
      });

      const parsed = parseLooseJson<{
        summary?: string;
        dataSkepticism?: Array<{ claim: string; issue: string; suggestion: string }>;
        complianceRisks?: Array<{ point: string; severity: string; fix: string }>;
        hookVulnerabilities?: Array<{ flaw: string; rewriteSuggestion: string }>;
      }>(response.text ?? '{}');

      return {
        id: `audit_${Date.now()}`,
        generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        summary: parsed.summary || '已完成全维度审校体检。',
        dataSkepticism: parsed.dataSkepticism ?? [],
        complianceRisks: (parsed.complianceRisks ?? []).map((c) => ({
          point: c.point,
          severity: (c.severity === 'high' || c.severity === 'low'
            ? c.severity
            : 'medium') as 'high' | 'medium' | 'low',
          fix: c.fix,
        })),
        hookVulnerabilities: parsed.hookVulnerabilities ?? [],
        groundingSources,
        usage: mergeUsage(extractGeminiUsage(response, activeModel), lookupUsage),
      };
    }
  );

  return {
    ...execution.result,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackModel: execution.fallbackModel,
    fallbackNotice: execution.fallbackNotice,
  };
}

export async function runGenerateScriptServer(params: {
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
  customGeminiApiKey?: string;
  model?: string;
}): Promise<{
  script: string;
  candidates: GeneratedScriptCandidate[];
  usage: TokenUsageSummary;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}> {
  const execution = await callGeminiWithRetryAndFallback(
    params.model,
    params.customGeminiApiKey,
    async (ai, activeModel) => {
      const brief = params.brief || ({} as any);
      const keyPoints = Array.isArray(brief.keyPoints) ? brief.keyPoints : [];
      const prompt = [
        `【输入立项信息】`,
        `项目名称：${params.projectName || ''}`,
        `目标平台与画幅时长：${params.platform || ''}`,
        `选题：${brief.topic || ''}`,
        `锁定分支方向：${brief.branchTitle || ''}`,
        `前3秒钩子策略备忘：${brief.hookStrategy || ''}`,
        `核心立项结论：${brief.coreThesis || ''}`,
        keyPoints.length > 0 ? `创作要点：\n${keyPoints.map((k: string) => `- ${k}`).join('\n')}` : '',
        brief.riskNotes ? `风控与避坑备忘：${brief.riskNotes}` : '',
        `【强制创作任务】`,
        `请严格参照《自媒体短视频全流程文案创作规则手册》，为该选题撰写【3 种不同切入角度与钩子风格】的完整口播脚本供创作者选择参考：`,
        `1. 版本 A（反差/认知突破型）：主打反差/反常识或危机恐惧钩子，高信息密度，以猎物认知酬赏为主，节奏紧凑。`,
        `2. 版本 B（细节/场景共情型）：主打生活微观细节或痛点场景切入，以情感共鸣和自我释怀酬赏为主，克制不煽情，画面感强。`,
        `3. 版本 C（揭秘/避坑捷径型）：主打行业潜规则或实证捷径，快速排除误区并交付清晰掌控感，首尾语境无缝咬合。`,
        `【红线检查要求】`,
        `- 黄金前3秒：前两句台词总长严格 ≤ 25 个汉字（英文 ≤ 15 词），零寒暄零废话，制造强认知缺口。`,
        `- 中段滑梯节奏：每 7-15 字标注口播停顿切镜符 /，穿插极简 [切镜/画面] 提示，每 5-8 秒植入一颗好奇心种子。`,
        `- 70%~85% 酬赏峰值：核心解法/真相集中落在 70%~85% 区间，包含 1 个日常物理强类比（Linking）。`,
        `- 结尾微投入：严禁“求点赞关注/扣1”，采用评论站队、收藏备用或首尾自然闭环。`,
        `请直接返回严格的 JSON 格式代码块：`,
        `{`,
        `  "versions": [`,
        `    {`,
        `      "id": "v1",`,
        `      "versionName": "版本 A · 反差认知突破型",`,
        `      "hookType": "反差/反常识 + 危机避害",`,
        `      "estimatedDuration": "约45秒 / 210字",`,
        `      "highlight": "通过推翻直觉假设制造强烈认知冲突，短句快节奏高密度输出",`,
        `      "scriptText": "【赛道A】《标题》（预估时长：XX秒 / 约XX字）\\n台词一。/ 台词二。/ [画面提示]..."`,
        `    },`,
        `    {`,
        `      "id": "v2",`,
        `      "versionName": "版本 B · 细节场景共情型",`,
        `      "hookType": "微观细节切入 + 痛点场景",`,
        `      "estimatedDuration": "约50秒 / 230字",`,
        `      "highlight": "以日常感官微故事切入，先点头共情后拆解深层逻辑，富有电影感",`,
        `      "scriptText": "..."`,
        `    },`,
        `    {`,
        `      "id": "v3",`,
        `      "versionName": "版本 C · 揭秘避坑捷径型",`,
        `      "hookType": "揭秘潜规则 + 数据捷径",`,
        `      "estimatedDuration": "约40秒 / 195字",`,
        `      "highlight": "行业内幕视角直击痛点，给出低门槛可执行步骤与自然首尾闭环",`,
        `      "scriptText": "..."`,
        `    }`,
        `  ]`,
        `}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const systemInstruction = `你是短视频顶级编剧与算法推流专家。你拥有并严格执行《自媒体短视频全流程文案创作规则手册》：\n\n${COPYWRITING_RULES_MARKDOWN}\n\n你必须直接输出严格的 JSON 代码块，绝不要输出 JSON 以外的额外文本。`;

      const response = await ai.models.generateContent({
        model: activeModel,
        contents: prompt,
        config: { systemInstruction },
      });

      const rawText = response.text?.trim() || '';
      let candidates: GeneratedScriptCandidate[] = [];

      try {
        const parsed = parseLooseJson<{ versions?: GeneratedScriptCandidate[] }>(rawText);
        if (Array.isArray(parsed?.versions) && parsed.versions.length > 0) {
          candidates = parsed.versions.map((v, i) => ({
            id: v.id || `v${i + 1}`,
            versionName: v.versionName || `版本 ${String.fromCharCode(65 + i)}`,
            hookType: v.hookType || '黄金钩子',
            estimatedDuration: v.estimatedDuration || '约45秒',
            highlight: v.highlight || '',
            scriptText: v.scriptText || '',
          }));
        }
      } catch {
        // Fallback if model returned plain script instead of JSON
        candidates = [
          {
            id: 'v1',
            versionName: '版本 A · 推荐标准版',
            hookType: '规则定制钩子',
            estimatedDuration: '约45秒',
            highlight: '严格遵循《创作规则手册》5大模块生成',
            scriptText: rawText,
          },
        ];
      }

      const primaryScript = candidates[0]?.scriptText || rawText;

      return {
        script: primaryScript,
        candidates,
        usage: extractGeminiUsage(response, activeModel),
      };
    }
  );

  return {
    ...execution.result,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackModel: execution.fallbackModel,
    fallbackNotice: execution.fallbackNotice,
  };
}

export async function runEnhanceHookServer(params: {
  fullScript: string;
  platform?: string;
  brief?: any;
  customGeminiApiKey?: string;
  model?: string;
}): Promise<{
  proposals: EnhancedHookProposal[];
  usage: TokenUsageSummary;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}> {
  const execution = await callGeminiWithRetryAndFallback(
    params.model,
    params.customGeminiApiKey,
    async (ai, activeModel) => {
      const prompt = [
        `【创作者提供的待改写文案】\n${params.fullScript}`,
        params.platform ? `【发布平台与画幅】${params.platform}` : '',
        `【强化改写与滑梯润色任务】`,
        `请严格参照《自媒体短视频全流程文案创作规则手册》，对这篇原文案进行深度诊断与外科手术级改写，提供【3 款不同钩子风格的强化润色方案】：`,
        `1. 重点重构前 3 秒黄金钩子：严格保证前两句台词总长 ≤ 25 个汉字（英文 ≤ 15 词），零寒暄零铺垫，制造致命认知缺口或内部触发痛点；`,
        `2. 中段滑梯效应节奏控制：采用非对称韵律，每 7-15 字标注断句切镜符 /，穿插极简 [切镜/画面] 提示，植入好奇心种子；`,
        `3. 70%~85% 酬赏峰值：引入生活日常物理强类比，去除居高临下说教；`,
        `4. 结尾闭环：清除求赞套路，设计自然评论站队/收藏备用/首尾语境闭环。`,
        `请直接返回 JSON 格式：`,
        `{`,
        `  "proposals": [`,
        `    {`,
        `      "id": "prop_1",`,
        `      "hookStyle": "方案一：反差认知与危机避害钩子",`,
        `      "openingHookText": "前两句台词（总长严格 ≤25 字）",`,
        `      "hookAnalysis": "剖析此钩子为何能破除观众滑走防线",`,
        `      "fullPolishedScript": "按滑梯法则润色后的完整口播稿（含 / 断句与极简 [切镜]）"`,
        `    },`,
        `    {`,
        `      "id": "prop_2",`,
        `      "hookStyle": "方案二：微观细节与场景共情钩子",`,
        `      "openingHookText": "前两句台词（总长严格 ≤25 字）",`,
        `      "hookAnalysis": "生活细节切入与点头共鸣机制",`,
        `      "fullPolishedScript": "..."`,
        `    },`,
        `    {`,
        `      "id": "prop_3",`,
        `      "hookStyle": "方案三：行业揭秘与数据捷径钩子",`,
        `      "openingHookText": "前两句台词（总长严格 ≤25 字）",`,
        `      "hookAnalysis": "潜规则猎物预期与首尾回扣逻辑",`,
        `      "fullPolishedScript": "..."`,
        `    }`,
        `  ]`,
        `}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const systemInstruction = `你是爆款短视频文案外科手术级改写专家。你拥有并严格执行《自媒体短视频全流程文案创作规则手册》：\n\n${COPYWRITING_RULES_MARKDOWN}\n\n你必须直接输出严格合法的 JSON 代码块，绝不要输出额外解释。`;

      const response = await ai.models.generateContent({
        model: activeModel,
        contents: prompt,
        config: { systemInstruction },
      });

      const rawText = response.text?.trim() || '';
      let proposals: EnhancedHookProposal[] = [];

      try {
        const parsed = parseLooseJson<{ proposals?: EnhancedHookProposal[] }>(rawText);
        if (Array.isArray(parsed?.proposals) && parsed.proposals.length > 0) {
          proposals = parsed.proposals.map((p, i) => ({
            id: p.id || `prop_${i + 1}`,
            hookStyle: p.hookStyle || `强化方案 ${i + 1}`,
            openingHookText: p.openingHookText || '',
            hookAnalysis: p.hookAnalysis || '',
            fullPolishedScript: p.fullPolishedScript || '',
          }));
        }
      } catch {
        proposals = [
          {
            id: 'prop_1',
            hookStyle: '标准滑梯强化方案',
            openingHookText: '严格遵循前3秒黄金法则（≤25字）',
            hookAnalysis: '已注入好奇心种子与非对称韵律',
            fullPolishedScript: rawText,
          },
        ];
      }

      return {
        proposals,
        usage: extractGeminiUsage(response, activeModel),
      };
    }
  );

  return {
    ...execution.result,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackModel: execution.fallbackModel,
    fallbackNotice: execution.fallbackNotice,
  };
}

export async function runInlineEditServer(params: {
  fullScript: string;
  selectedText: string;
  instruction: string;
  platform: string;
  customGeminiApiKey?: string;
  model?: string;
}): Promise<{
  replacement: string;
  usage: TokenUsageSummary;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}> {
  const execution = await callGeminiWithRetryAndFallback(
    params.model,
    params.customGeminiApiKey,
    async (ai, activeModel) => {
      const prompt = [
        `【发布平台】${params.platform}`,
        `【完整脚本上下文（只读，严禁复述或改动未选中部分）】\n${params.fullScript}`,
        `【用户划选的局部片段】\n${params.selectedText}`,
        `【局部修改指令】\n${params.instruction}`,
        `请仅输出替换【用户划选的局部片段】的新文本。`,
      ].join('\n\n');

      const systemInstruction =
        '你是一个外科手术级局部改写引擎。你只能改写用户划选的片段，使其满足修改指令并无缝衔接上下文语气。严禁输出未选中的前后文、严禁加引号包裹结果、严禁输出任何解释性前缀（如“修改如下：”）。只返回替换后的纯文本本身。';

      const response = await ai.models.generateContent({
        model: activeModel,
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction,
        },
      });

      return {
        replacement: (response.text ?? '').trim().replace(/^["“]|["”]$/g, ''),
        usage: extractGeminiUsage(response, activeModel),
      };
    }
  );

  return {
    ...execution.result,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackModel: execution.fallbackModel,
    fallbackNotice: execution.fallbackNotice,
  };
}

export async function runStoryboardServer(params: {
  projectName: string;
  platform: string;
  scriptContent: string;
  aspectRatio?: '9:16' | '16:9';
  customGeminiApiKey?: string;
  model?: string;
}): Promise<{
  shots: StoryboardShot[];
  usage: TokenUsageSummary;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}> {
  const execution = await callGeminiWithRetryAndFallback(
    params.model,
    params.customGeminiApiKey,
    async (ai, activeModel) => {
      const ratio = params.aspectRatio === '16:9' ? '16:9' : '9:16';
      const ratioDesc =
        ratio === '16:9'
          ? '16:9 横屏电影画幅构图（宽景调度、三分线视觉平衡与留白呼吸感）'
          : '9:16 竖屏构图（竖屏中心视觉聚焦、避开顶部标题与底部字幕安全区）';

      const systemInstruction = [
        '你是资深电影广告与短视频视觉导演，严格执行以下视听与 Midjourney 规范：',
        `1. 画面比例规范：${ratioDesc}；`,
        '2. 电影胶片质感原则：所有镜头的画面描述与英文提示词都必须立足真实电影摄影机与 35mm 电影胶片质感（film grain、halation、自然戏剧布光），保持质感统一；',
        '3. 景别节奏：严格交替使用特写(CU/ECU)、中近景(MCU)、中景(MS)、全景(WS)保持每3-6秒一次视觉刷新；',
        '4. 静态首帧原则：第1镜（Shot 01）必须设计成极其抓眼、主体清晰无糊屏拖影的强静态首帧构图；',
        '5. 【严禁 Midjourney 版本参数】：baseMjPrompt 必须是纯英文画面主体、光影、材质描述，严禁出现 --v、--version（如 --v 6.1）、--ar 或 --style 等参数（比例与电影胶片质感尾缀由顶部视觉资产锁统一拼接）。',
      ].join('\n');

      const response = await ai.models.generateContent({
        model: activeModel,
        contents: [
          `项目：${params.projectName} | 平台：${params.platform} | 目标画幅：${ratio}`,
          `定稿口播或外部已完成文案：\n${params.scriptContent}`,
          '请根据上述口播稿内容、叙事节奏与情绪曲线，拆解为 6 到 12 个电影质感分镜（shots）。',
        ],
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                shotNumber: { type: Type.INTEGER },
                shotSize: {
                  type: Type.STRING,
                  description: '大特写 ECU、特写 CU、中近景 MCU、中景 MS、全景 WS',
                },
                durationSec: { type: Type.INTEGER, description: '2 到 8 秒之间' },
                visualDescription: { type: Type.STRING, description: '中文电影机位机理描述' },
                dialogue: { type: Type.STRING, description: '对应此镜头的口播台词片段或留白' },
                baseMjPrompt: {
                  type: Type.STRING,
                  description:
                    '纯英文画面主体与光影摄影描述，严禁包含任何 --v、--version、--ar 或 --style 参数',
                },
                cameraMovement: {
                  type: Type.STRING,
                  description: '运镜调度，如平稳推进、缓慢平移、定焦静止等',
                },
                styleNote: { type: Type.STRING, description: '色彩、光影或胶片色调补充提示' },
              },
              required: [
                'shotNumber',
                'shotSize',
                'durationSec',
                'visualDescription',
                'dialogue',
                'baseMjPrompt',
                'cameraMovement',
              ],
            },
          },
        },
      });

      const parsedList = parseLooseJson<
        Array<{
          shotNumber: number;
          shotSize: string;
          durationSec: number;
          visualDescription: string;
          dialogue: string;
          baseMjPrompt: string;
          cameraMovement: string;
          styleNote?: string;
        }>
      >(response.text ?? '[]');

      const shots: StoryboardShot[] = parsedList.map((item, index) => {
        const shotNumber = item.shotNumber || index + 1;
        return {
          id: `shot_${Date.now()}_${shotNumber}`,
          shotNumber,
          shotSize: item.shotSize || '中景 MS',
          durationSec: Math.max(2, Math.min(15, item.durationSec || 4)),
          visualDescription: item.visualDescription || `镜头 ${shotNumber} 画面`,
          dialogue: item.dialogue || '',
          baseMjPrompt: cleanBaseMjPrompt(item.baseMjPrompt),
          cameraMovement: item.cameraMovement || '平稳推进（Slow Push-in）',
          styleNote: item.styleNote || undefined,
        };
      });

      return {
        shots,
        usage: extractGeminiUsage(response, activeModel),
      };
    }
  );

  return {
    ...execution.result,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackModel: execution.fallbackModel,
    fallbackNotice: execution.fallbackNotice,
  };
}

export async function runEditShotServer(params: {
  projectName: string;
  platform: string;
  shot: StoryboardShot;
  instruction: string;
  scriptContent?: string;
  aspectRatio?: '9:16' | '16:9';
  customGeminiApiKey?: string;
  model?: string;
}): Promise<{
  shot: StoryboardShot;
  usage: TokenUsageSummary;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}> {
  const execution = await callGeminiWithRetryAndFallback(
    params.model,
    params.customGeminiApiKey,
    async (ai, activeModel) => {
      const ratio = params.aspectRatio === '16:9' ? '16:9' : '9:16';
      const promptContent = [
        `项目：${params.projectName} | 平台：${params.platform} | 目标画幅：${ratio}`,
        `【当前单镜设定】\n镜号：Shot ${params.shot.shotNumber}\n景别：${params.shot.shotSize}\n时长：${params.shot.durationSec}s\n画面描述：${params.shot.visualDescription}\n对应台词：${params.shot.dialogue}\nMidjourney基础提示词：${params.shot.baseMjPrompt}\n运镜：${params.shot.cameraMovement}`,
        params.scriptContent ? `完整脚本上下文参考：\n${params.scriptContent.slice(0, 1500)}` : '',
        `【创作者微调指令】\n${params.instruction}`,
        `请严格围绕修改指令，输出该镜头更新后的属性（保持电影胶片感，baseMjPrompt为纯英文且严禁带--v/--ar参数）。`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const systemInstruction =
        '你是视听分镜微调导演。根据用户指令对单个镜头的景别、时长、画面描述、运镜或英文提示词进行外科手术式精准修改，baseMjPrompt 严禁输出 --v、--ar 或 --style 参数。';

      const response = await ai.models.generateContent({
        model: activeModel,
        contents: promptContent,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              shotSize: { type: Type.STRING },
              durationSec: { type: Type.INTEGER },
              visualDescription: { type: Type.STRING },
              dialogue: { type: Type.STRING },
              baseMjPrompt: { type: Type.STRING },
              cameraMovement: { type: Type.STRING },
              styleNote: { type: Type.STRING },
            },
            required: [
              'shotSize',
              'durationSec',
              'visualDescription',
              'dialogue',
              'baseMjPrompt',
              'cameraMovement',
            ],
          },
        },
      });

      const parsed = parseLooseJson<{
        shotSize?: string;
        durationSec?: number;
        visualDescription?: string;
        dialogue?: string;
        baseMjPrompt?: string;
        cameraMovement?: string;
        styleNote?: string;
      }>(response.text ?? '{}');

      return {
        shot: {
          ...params.shot,
          shotSize: parsed.shotSize || params.shot.shotSize,
          durationSec: Math.max(2, Math.min(15, parsed.durationSec || params.shot.durationSec)),
          visualDescription: parsed.visualDescription || params.shot.visualDescription,
          dialogue: parsed.dialogue ?? params.shot.dialogue,
          baseMjPrompt: cleanBaseMjPrompt(parsed.baseMjPrompt || params.shot.baseMjPrompt),
          cameraMovement: parsed.cameraMovement || params.shot.cameraMovement,
          styleNote: parsed.styleNote || params.shot.styleNote,
        },
        usage: extractGeminiUsage(response, activeModel),
      };
    }
  );

  return {
    ...execution.result,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackModel: execution.fallbackModel,
    fallbackNotice: execution.fallbackNotice,
  };
}

export async function runAddShotServer(params: {
  projectName: string;
  platform: string;
  existingShots: StoryboardShot[];
  instruction: string;
  scriptContent?: string;
  aspectRatio?: '9:16' | '16:9';
  customGeminiApiKey?: string;
  model?: string;
}): Promise<{
  shot: StoryboardShot;
  usage: TokenUsageSummary;
  modelUsed: string;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}> {
  const execution = await callGeminiWithRetryAndFallback(
    params.model,
    params.customGeminiApiKey,
    async (ai, activeModel) => {
      const ratio = params.aspectRatio === '16:9' ? '16:9' : '9:16';
      const nextNumber =
        params.existingShots.length > 0
          ? Math.max(...params.existingShots.map((s) => s.shotNumber)) + 1
          : 1;

      const existingSummary = (params.existingShots || [])
        .slice(-4)
        .map((s) => `Shot ${s.shotNumber} [${s.shotSize}]: ${s.visualDescription} | 台词: ${s.dialogue}`)
        .join('\n');

      const systemInstruction = [
        '你是电影广告与短视频分镜导演，负责根据用户新增镜头的要求，设计一个能自然承接现有分镜节奏的新镜头（Shot）。',
        `全局锁定规范：画面构图契合 ${ratio}，并保持真实电影胶片质感；baseMjPrompt 必须为纯英文且【严禁】包含 --v、--version（如 --v 6.1）、--ar 或 --style 参数。`,
      ].join('\n');

      const promptContent = [
        `项目：${params.projectName} | 平台：${params.platform} | 画面比例：${ratio}`,
        params.scriptContent ? `参考文案：\n${params.scriptContent.slice(0, 1500)}` : '',
        existingSummary ? `已有分镜上下文：\n${existingSummary}` : '当前尚无前置镜头，这将是第 1 镜。',
        `创作者新增第 ${nextNumber} 镜的具体要求：${params.instruction}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: activeModel,
        contents: promptContent,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              shotSize: { type: Type.STRING },
              durationSec: { type: Type.INTEGER },
              visualDescription: { type: Type.STRING },
              dialogue: { type: Type.STRING },
              baseMjPrompt: { type: Type.STRING },
              cameraMovement: { type: Type.STRING },
              styleNote: { type: Type.STRING },
            },
            required: [
              'shotSize',
              'durationSec',
              'visualDescription',
              'dialogue',
              'baseMjPrompt',
              'cameraMovement',
            ],
          },
        },
      });

      const parsed = parseLooseJson<{
        shotSize: string;
        durationSec: number;
        visualDescription: string;
        dialogue: string;
        baseMjPrompt: string;
        cameraMovement: string;
        styleNote?: string;
      }>(response.text ?? '{}');

      return {
        shot: {
          id: `shot_${Date.now()}_${nextNumber}`,
          shotNumber: nextNumber,
          shotSize: parsed.shotSize || '中景 MS',
          durationSec: Math.max(2, Math.min(15, parsed.durationSec || 4)),
          visualDescription: parsed.visualDescription || params.instruction,
          dialogue: parsed.dialogue || '（画面转场留白）',
          baseMjPrompt: cleanBaseMjPrompt(parsed.baseMjPrompt),
          cameraMovement: parsed.cameraMovement || '平稳推进（Slow Push-in）',
          styleNote: parsed.styleNote || undefined,
        },
        usage: extractGeminiUsage(response, activeModel),
      };
    }
  );

  return {
    ...execution.result,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackModel: execution.fallbackModel,
    fallbackNotice: execution.fallbackNotice,
  };
}

const SERVER_PERSONA_INSTRUCTIONS: Record<ChatbotPersonaId, string> = {
  'script-coach':
    '你是金牌短视频口播编剧与爆款策划顾问，专注抖音、小红书与B站竖屏内容。请结合当前项目上下文（选题、立项简报与脚本草稿），以多轮对话方式帮创作者打磨前3秒黄金钩子、口语化表达、转折情绪张力与互动评论诱饵。回答直接给可执行建议和改写示范，避免空话。',
  'visual-director':
    '你是资深广告与短视频视觉导演，精通 9:16 竖屏与 16:9 横屏安全区构图、景别交替节奏（ECU/CU/MCU/MS/WS）、静态首帧吸睛原则、35mm电影胶片质感以及不含 --v 版本尾缀的 Midjourney 英文提示词工程。请围绕当前项目为创作者提供分镜画面设计、单镜风格设定与运镜调度建议。',
  'algorithm-auditor':
    '你是铁面无私的短视频平台推荐算法策略师与内容风控审校官。你的职责是识别口播稿中的违禁极限词、虚假宣传风险、前3秒跳出隐患与低完播结构，并给出合规替代话术和留存率拉升方案。',
};

export async function runChatbotTurnServer(params: {
  personaId: ChatbotPersonaId;
  modeId: ChatbotModelMode;
  projectContextSummary: string;
  history: Array<{ role: 'user' | 'model'; content: string }>;
  userMessage: string;
  customGeminiApiKey?: string;
  model?: string;
}): Promise<{
  reply: string;
  modelUsed: string;
  usage: TokenUsageSummary;
  fallbackOccurred: boolean;
  fallbackModel?: string;
  fallbackNotice?: string;
}> {
  // Resolve model based on modeId or custom model
  let targetModel = params.model;
  if (!targetModel) {
    if (params.modeId === 'hydrogen') targetModel = 'gemini-4-hydrogen';
    else if (params.modeId === 'argon') targetModel = 'gemini-4-argon';
    else if (params.modeId === 'fast') targetModel = 'gemini-3.1-flash-lite';
    else targetModel = DEFAULT_GEMINI_MODEL;
  }

  const execution = await callGeminiWithRetryAndFallback(
    targetModel,
    params.customGeminiApiKey,
    async (ai, activeModel) => {
      const personaInstruction =
        SERVER_PERSONA_INSTRUCTIONS[params.personaId] ?? SERVER_PERSONA_INSTRUCTIONS['script-coach'];
      const systemInstruction = [
        personaInstruction,
        `当前工作台项目实时上下文：\n${params.projectContextSummary}`,
      ].join('\n\n');

      const chat = ai.chats.create({
        model: activeModel,
        config: {
          systemInstruction,
        },
        history: (params.history || []).slice(-16).map((item) => ({
          role: item.role,
          parts: [{ text: item.content }],
        })),
      });

      const response = await chat.sendMessage({ message: params.userMessage });
      const reply = response.text?.trim() || '暂未生成有效回复，请调整提问后重试。';
      return {
        reply,
        usage: extractGeminiUsage(response, activeModel),
      };
    }
  );

  return {
    reply: execution.result.reply,
    usage: execution.result.usage,
    modelUsed: execution.modelUsed,
    fallbackOccurred: execution.fallbackOccurred,
    fallbackModel: execution.fallbackModel,
    fallbackNotice: execution.fallbackNotice,
  };
}
