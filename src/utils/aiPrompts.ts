import type {
  BrainstormAttachmentPayload,
  StoryboardShot,
} from '../types/workspace';
import { stripMidjourneyVersionFlags } from './workflow';

export function cleanBaseMjPromptText(raw: string): string {
  return stripMidjourneyVersionFlags(raw || '')
    .replace(/\s*--(?:ar|style|stylize|q|quality)\s+\S+/gi, '')
    .trim();
}

export function buildBrainstormPrompts(params: {
  projectName: string;
  platform: string;
  topic: string;
  userMessage: string;
  history: Array<{ role: string; content: string }>;
  attachments?: BrainstormAttachmentPayload[];
  groundingSummary?: string;
  expectJsonInstruction?: boolean;
}) {
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

  const historyContext = params.history
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '创作者' : '策划总监'}: ${m.content}`)
    .join('\n');

  const systemInstruction =
    '你是顶级短视频与自媒体策划总监，擅长抖音、小红书、B站内容策划。如果用户投喂了参考文本、图片或视频文件，请先深度拆解其核心结构、叙事节奏、视觉风格、爆点与受众痛点，再严格结合用户的生成/微调要求，产出 3 到 4 个可独立深挖的相似结构或微调创新方向。每个方向都要有明确的切入角度、具有前3秒留存力的具体钩子台词，以及精准受众画像。';

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
    params.groundingSummary
      ? `Google Search 联网检索核实参考：\n${params.groundingSummary}`
      : '',
    `创作者当前要求：${params.userMessage}`,
    params.expectJsonInstruction
      ? `请严格返回 JSON 对象，字段如下：{"reply": "80-180字策划判断与文件分析摘要", "directions": [{"title": "方向一：...", "angle": "...", "hook": "...", "audience": "...", "verifiedFacts": ""}]}。directions 必须包含 3-4 个对象。`
      : `请给出简短犀利的策划判断（reply，若包含上传文件需先总结文件分析结论），并拆解 3 到 4 个差异化、可独立深挖的创作方向（directions）。`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    systemInstruction,
    prompt,
    mediaAttachments,
  };
}

export function buildBranchChatPrompts(params: {
  projectName: string;
  platform: string;
  topic: string;
  branchTitle: string;
  initialAngle: string;
  initialHook: string;
  messages: Array<{ role: string; content: string }>;
  userMessage: string;
}) {
  const conversation = params.messages
    .slice(-8)
    .map((m) => `${m.role === 'user' ? '创作者' : '分支策划助手'}: ${m.content}`)
    .join('\n');

  const systemInstruction =
    '你是专注单个创意分支的深挖策划搭档。你的回复必须紧凑、有实操颗粒度（使用清晰的 Markdown 列表），并在最后一行输出 `【核心结论更新】...` 概括当前分支最新定调。不要泛泛而谈。';

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

  return { systemInstruction, prompt };
}

export function buildRiskAuditPrompts(params: {
  projectName: string;
  platform: string;
  topic: string;
  activeBranch: { title: string; coreConclusion: string; initialHook: string } | null;
  directions: Array<{ title: string; angle: string; hook: string }>;
  factCheckContext?: string;
  expectJsonInstruction?: boolean;
}) {
  const targetContent = params.activeBranch
    ? `当前锁定/深挖分支「${params.activeBranch.title}」\n钩子：${params.activeBranch.initialHook}\n核心结论：${params.activeBranch.coreConclusion}`
    : `主窗口策划方向：\n${params.directions
        .map((d) => `- ${d.title}: ${d.angle}（钩子：${d.hook}）`)
        .join('\n')}`;

  const systemInstruction =
    '你是一位铁面无私的内容风控与短视频审校总监（独立审校人设）。你绝不奉承创作者，专门负责挑刺：1) 数据与事实存疑点（是否绝对化、缺出处或以偏概全）；2) 平台合规风险（抖音/小红书违禁词、极限词、虚假宣传、引战拉踩）；3) 前3秒钩子漏洞（是否拖沓、缺少视觉/听觉抓手、痛点不痛）。请给出犀利且可直接落地的修改方案。';

  const prompt = [
    `项目：${params.projectName} | 平台：${params.platform} | 选题：${params.topic}`,
    targetContent,
    params.factCheckContext ? `联网事实检索结果：\n${params.factCheckContext}` : '',
    params.expectJsonInstruction
      ? `请严格返回 JSON 对象：{"summary": "...", "dataSkepticism": [{"claim": "...", "issue": "...", "suggestion": "..."}], "complianceRisks": [{"point": "...", "severity": "high|medium|low", "fix": "..."}], "hookVulnerabilities": [{"flaw": "...", "rewriteSuggestion": "..."}]}`
      : `请以最挑剔、毒舌但专业的审校总监视角完成《风险与逻辑体检》。`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { systemInstruction, prompt };
}

export function buildGenerateScriptPrompts(params: {
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
}) {
  const systemInstruction =
    '你是金牌短视频口播编剧。严格遵循传入的《立项简报》和风控要求，直接输出纯净的口播脚本正文（自然分段，方便后续逐句划选微调），不要输出多余的开场寒暄、Markdown 标题或解释文字。';

  const prompt = [
    `项目名称：${params.projectName}`,
    `目标平台：${params.platform}`,
    `选题：${params.brief.topic}`,
    `锁定方向：${params.brief.branchTitle}`,
    `前3秒钩子策略：${params.brief.hookStrategy}`,
    `核心立项结论：${params.brief.coreThesis}`,
    `创作要点：\n${params.brief.keyPoints.map((k) => `- ${k}`).join('\n')}`,
    `风控避坑要求：${params.brief.riskNotes}`,
    `请撰写一篇可直接用于真人出镜/配音口播的短视频脚本（约300-450字，分段清晰，口语自然，无废话，包含必要的音效/停顿提示）。`,
  ].join('\n\n');

  return { systemInstruction, prompt };
}

export function buildInlineEditPrompts(params: {
  fullScript: string;
  selectedText: string;
  instruction: string;
  platform: string;
}) {
  const systemInstruction =
    '你是一个外科手术级局部改写引擎。你只能改写用户划选的片段，使其满足修改指令并无缝衔接上下文语气。严禁输出未选中的前后文、严禁加引号包裹结果、严禁输出任何解释性前缀（如“修改如下：”）。只返回替换后的纯文本本身。';

  const prompt = [
    `【发布平台】${params.platform}`,
    `【完整脚本上下文（只读，严禁复述或改动未选中部分）】\n${params.fullScript}`,
    `【用户划选的局部片段】\n${params.selectedText}`,
    `【局部修改指令】\n${params.instruction}`,
    `请仅输出替换【用户划选的局部片段】的新文本。`,
  ].join('\n\n');

  return { systemInstruction, prompt };
}

export function buildStoryboardPrompts(params: {
  projectName: string;
  platform: string;
  scriptContent: string;
  aspectRatio?: '9:16' | '16:9';
  expectJsonInstruction?: boolean;
}) {
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

  const prompt = [
    `项目：${params.projectName} | 平台：${params.platform} | 目标画幅：${ratio}`,
    `定稿口播或外部已完成文案：\n${params.scriptContent}`,
    params.expectJsonInstruction
      ? `请拆解为 4-7 个紧凑分镜卡片，严格返回 JSON：{"shots": [{"shotNumber": 1, "shotSize": "特写 CU", "durationSec": 4, "visualDescription": "...", "dialogue": "...", "baseMjPrompt": "pure English prompt without --v or --ar", "cameraMovement": "..."}]}`
      : `请按专业导演标准拆解为 4-7 个紧凑分镜卡片。`,
  ].join('\n\n');

  return { ratio, systemInstruction, prompt };
}

export function buildEditShotPrompts(params: {
  projectName: string;
  platform: string;
  shot: StoryboardShot;
  instruction: string;
  aspectRatio?: '9:16' | '16:9';
  shotHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectJsonInstruction?: boolean;
}) {
  const ratio = params.aspectRatio === '16:9' ? '16:9' : '9:16';
  const dialogueContext = (params.shotHistory ?? [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '导演' : '分镜顾问'}: ${m.content}`)
    .join('\n');

  const systemInstruction = [
    '你是短视频与电影视觉分镜执行导演，通过对话为【单个镜头】单独定制视觉画风（例如赛博朋克风格、日式动画/手绘风格、定格动画、复古港风、极简冷峻等）、景别与光影构图。',
    `全局锁定要求：保持 ${ratio} 构图视角与真实电影胶片质感基础；baseMjPrompt 必须为纯英文且【严禁】包含 --v、--version（如 --v 6.1）、--ar 或 --style 参数。`,
    '你需要同时返回一段简明中文对话回复（assistantReply，说明你已为该镜应用了什么画风或调整）以及刷新后的完整镜头字段。',
  ].join('\n');

  const prompt = [
    `项目：${params.projectName} | 平台：${params.platform} | 画面比例：${ratio}`,
    `当前分镜 #${params.shot.shotNumber}：`,
    `- 景别：${params.shot.shotSize}`,
    `- 时长：${params.shot.durationSec}s`,
    `- 原画面描述：${params.shot.visualDescription}`,
    `- 对应台词：${params.shot.dialogue}`,
    `- 原英文 MJ 提示词：${params.shot.baseMjPrompt}`,
    `- 原运镜：${params.shot.cameraMovement}`,
    params.shot.styleNote ? `- 当前单镜画风设定：${params.shot.styleNote}` : '',
    dialogueContext ? `本镜历史对话记录：\n${dialogueContext}` : '',
    `导演本轮单镜对话要求：${params.instruction}`,
    params.expectJsonInstruction
      ? `请严格返回 JSON：{"assistantReply": "...", "styleNote": "简短单镜风格标签如赛博朋克霓虹/手绘动画", "shotSize": "...", "durationSec": 4, "visualDescription": "...", "dialogue": "...", "baseMjPrompt": "pure English prompt without --v or --ar", "cameraMovement": "..."}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { ratio, systemInstruction, prompt };
}

export function buildAddShotPrompts(params: {
  projectName: string;
  platform: string;
  scriptContent: string;
  existingShots: StoryboardShot[];
  instruction: string;
  aspectRatio?: '9:16' | '16:9';
  expectJsonInstruction?: boolean;
}) {
  const ratio = params.aspectRatio === '16:9' ? '16:9' : '9:16';
  const nextNumber =
    params.existingShots.length > 0
      ? Math.max(...params.existingShots.map((s) => s.shotNumber || 0)) + 1
      : 1;

  const existingSummary = params.existingShots
    .slice(-4)
    .map(
      (s) =>
        `Shot ${s.shotNumber} [${s.shotSize}]: ${s.visualDescription} | 台词: ${s.dialogue}`
    )
    .join('\n');

  const systemInstruction = [
    '你是电影广告与短视频分镜导演，负责根据用户新增镜头的要求，设计一个能自然承接现有分镜节奏的新镜头（Shot）。',
    `全局锁定规范：画面构图契合 ${ratio}，并保持真实电影胶片质感；baseMjPrompt 必须为纯英文且【严禁】包含 --v、--version（如 --v 6.1）、--ar 或 --style 参数。`,
  ].join('\n');

  const prompt = [
    `项目：${params.projectName} | 平台：${params.platform} | 画面比例：${ratio}`,
    params.scriptContent ? `参考文案：\n${params.scriptContent.slice(0, 1500)}` : '',
    existingSummary
      ? `已有分镜上下文：\n${existingSummary}`
      : '当前尚无前置镜头，这将是第 1 镜。',
    `创作者新增第 ${nextNumber} 镜的具体要求：${params.instruction}`,
    params.expectJsonInstruction
      ? `请严格返回 JSON：{"shotSize": "...", "durationSec": 4, "visualDescription": "...", "dialogue": "...", "baseMjPrompt": "pure English prompt without --v or --ar", "cameraMovement": "...", "styleNote": "可选画风标签"}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { ratio, nextNumber, systemInstruction, prompt };
}
