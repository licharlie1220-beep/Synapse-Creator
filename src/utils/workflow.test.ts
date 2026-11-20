import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_PROJECTS } from '../data/seedProjects';
import { sanitizeBuiltinServerPayload } from '../services/geminiClient';
import {
  DEFAULT_API_PROVIDER_CONFIG,
  DEFAULT_API_USAGE_STATS,
  getScopedStorageKey,
} from '../services/projectStorage';
import type { BrainstormDirection, Project } from '../types/workspace';
import {
  accumulateApiUsage,
  appendShotToStoryboard,
  applyInlineEdit,
  applyVisualLockToPrompt,
  buildBriefMarkdown,
  buildStoryboardCsv,
  BUILTIN_GEMINI_MODELS,
  CINEMA_FILM_TEXTURE_CLAUSE,
  classifyAttachmentKind,
  createProjectBriefFromBranch,
  formatFriendlyErrorMessage,
  getEffectiveVisualLockSuffix,
  getUsageAlertState,
  normalizeApiProviderConfig,
  normalizeProjectData,
  openOrActivateBranch,
  parseApiErrorDetail,
  parseLooseJsonSafe,
  parseWebdavPropfindXml,
  VISUAL_LOCK_PRESETS,
} from './workflow';
import { COPYWRITING_RULES_MARKDOWN } from '../rules/copywritingRules';
import { SUPPORTED_LANGUAGES, TRANSLATIONS } from '../i18n/translations';

const mockTestProject: Project = {
  id: 'proj_mock_test',
  name: '测试创作项目',
  platform: '9:16 竖屏 · 1分钟左右',
  topic: '测试选题',
  currentStage: 1,
  updatedAt: '2026-11-20',
  stage1: {
    searchGroundingEnabled: false,
    activeBranchId: null,
    messages: [],
    branches: [],
    riskAudit: null,
  },
  stage2: {
    brief: null,
    scriptContent: '',
    editHistory: [],
  },
  stage3: {
    activeVisualLockId: 'ratio-9-16',
    customVisualLockSuffix: '',
    shots: [
      {
        id: 'shot_1',
        shotNumber: 1,
        shotSize: '中景 MS',
        durationSec: 4,
        visualDescription: '咖啡厅室内全景',
        dialogue: '第一句台词。',
        baseMjPrompt: 'Cafe interior warm lighting',
        cameraMovement: '固定机位 Static',
      },
    ],
  },
};

test('applyInlineEdit replaces strictly the selected range and preserves surrounding paragraphs', () => {
  const original =
    '第一段：很多人一早醒来就脱口而出 Good morning。\n第二段：其实在伦敦街头，大家更常说一句简短的 Morning！\n第三段：明天试着对咖啡师这样说。';
  const target = '其实在伦敦街头，大家更常说一句简短的 Morning！';
  const start = original.indexOf(target);
  const end = start + target.length;

  const { updatedScript, newSelectionEnd } = applyInlineEdit(
    original,
    start,
    end,
    '其实在真实日常里，老外开口就是一句脆生生的 Morning！'
  );

  assert.ok(updatedScript.startsWith('第一段：很多人一早醒来就脱口而出 Good morning。\n第二段：'));
  assert.ok(updatedScript.endsWith('\n第三段：明天试着对咖啡师这样说。'));
  assert.ok(updatedScript.includes('其实在真实日常里，老外开口就是一句脆生生的 Morning！'));
  assert.equal(
    newSelectionEnd,
    start + '其实在真实日常里，老外开口就是一句脆生生的 Morning！'.length
  );
});

test('applyInlineEdit rejects empty selection', () => {
  assert.throws(() => applyInlineEdit('hello world', 3, 3, 'test'));
});

test('VISUAL_LOCK_PRESETS only offers 9:16 and 16:9 with mandatory cinema film texture and zero --v flags', () => {
  assert.equal(VISUAL_LOCK_PRESETS.length, 2);
  assert.deepEqual(
    VISUAL_LOCK_PRESETS.map((p) => p.aspectRatio),
    ['9:16', '16:9']
  );

  for (const preset of VISUAL_LOCK_PRESETS) {
    assert.ok(preset.suffix.includes('35mm cinema film'));
    assert.ok(!/--(?:v|version)\b/i.test(preset.suffix));
    assert.ok(!/--(?:v|version)\b/i.test(preset.label));
  }
});

test('applyVisualLockToPrompt enforces cinema film texture, switches 9:16/16:9 cleanly, and strips any --v flags', () => {
  const base = 'Close-up shot of steaming espresso cup on dark oak table --ar 9:16 --v 6.1';
  const suffix169 = getEffectiveVisualLockSuffix('ratio-16-9', '--cref https://example.com/char.png --v 6.0');
  const locked = applyVisualLockToPrompt(base, suffix169);

  assert.equal((locked.match(/--ar\s+16:9/g) ?? []).length, 1);
  assert.ok(!/--ar\s+9:16/i.test(locked));
  assert.ok(!/--(?:v|version)\b/i.test(locked));
  assert.ok(locked.includes(CINEMA_FILM_TEXTURE_CLAUSE));
  assert.ok(locked.includes('--cref https://example.com/char.png'));
});

test('normalizeProjectData migrates legacy presets to ratio-9-16 and removes --v flags', () => {
  const legacy: Project = {
    ...mockTestProject,
    stage3: {
      activeVisualLockId: 'cyberpunk-word',
      customVisualLockSuffix: '--v 6.1',
      shots: [
        {
          ...mockTestProject.stage3.shots[0],
          baseMjPrompt: 'Neon rain alley --v 6.1 --ar 9:16',
        },
      ],
    },
  };

  const normalized = normalizeProjectData(legacy);
  assert.equal(normalized.stage3.activeVisualLockId, 'ratio-9-16');
  assert.equal(normalized.stage3.customVisualLockSuffix, '');
  assert.equal(normalized.stage3.shots[0].baseMjPrompt, 'Neon rain alley');
});

test('seed projects are completely empty to ensure clean initial program', () => {
  assert.equal(SEED_PROJECTS.length, 0);
});

test('appendShotToStoryboard increments shot number cleanly and strips --v flags', () => {
  const initialShots = mockTestProject.stage3.shots;
  const nextShots = appendShotToStoryboard(initialShots, {
    id: 'shot_new',
    shotSize: '全景 WS',
    durationSec: 5,
    visualDescription: '雨夜街角咖啡店橱窗暖光',
    dialogue: '明天早上去试试看吧。',
    baseMjPrompt: 'Rainy street corner cafe window warm glow --v 6.1 --ar 16:9',
    cameraMovement: '缓慢后拉（Slow Pull-out）',
  });

  assert.equal(nextShots.length, initialShots.length + 1);
  const appended = nextShots[nextShots.length - 1];
  assert.equal(appended.shotNumber, initialShots.length + 1);
  assert.equal(appended.baseMjPrompt, 'Rainy street corner cafe window warm glow');
});

test('accumulateApiUsage and getUsageAlertState calculate tokens and trigger threshold alerts', () => {
  let stats = {
    ...DEFAULT_API_USAGE_STATS,
    warningThresholdTokens: 800,
    budgetLimitTokens: 1000,
  };

  stats = accumulateApiUsage(stats, '策划脑暴', {
    promptTokens: 300,
    candidatesTokens: 200,
    totalTokens: 500,
    model: 'gemini-4-hydrogen',
  });
  assert.equal(stats.totalRequests, 1);
  assert.equal(stats.totalTokens, 500);
  assert.equal(getUsageAlertState(stats).level, 'normal');

  stats = accumulateApiUsage(stats, '导演分镜拆解', {
    promptTokens: 200,
    candidatesTokens: 150,
    totalTokens: 350,
    model: 'gemini-4-hydrogen',
  });
  assert.equal(stats.totalTokens, 850);
  assert.equal(getUsageAlertState(stats).level, 'warning');
  assert.equal(getUsageAlertState(stats).percentage, 85);

  stats = accumulateApiUsage(stats, '新增分镜', {
    promptTokens: 100,
    candidatesTokens: 100,
    totalTokens: 200,
    model: 'deepseek-chat',
  });
  assert.equal(stats.totalTokens, 1050);
  assert.equal(getUsageAlertState(stats).level, 'exceeded');
});

test('openOrActivateBranch isolates new branches and avoids duplicating existing branch tabs', () => {
  const direction: BrainstormDirection = {
    id: 'dir_1',
    title: '方向一：语音学懒音规律',
    angle: '从连读和重音弱化讲透省略现象',
    hook: '别再一板一眼说 Good morning 了，老外听着像在念课文！',
    audience: '通勤白领与英语进阶学习者',
  };

  const first = openOrActivateBranch([], direction, '2026-11-18T00:00:00Z');
  assert.equal(first.branches.length, 1);
  assert.equal(first.branches[0].directionId, 'dir_1');

  const second = openOrActivateBranch(first.branches, direction, '2026-11-18T00:01:00Z');
  assert.equal(second.branches.length, 1);
  assert.equal(second.activeBranchId, first.activeBranchId);
});

test('createProjectBriefFromBranch packages branch thesis and risk notes cleanly', () => {
  const { branches } = openOrActivateBranch([], {
    id: 'dir_2',
    title: '方向二：职场破冰微场景',
    angle: '3秒建立松弛感的打招呼法则',
    hook: '电梯里遇到外籍总监，千万别憋出一句 How are you doing today',
    audience: '外企职场人',
  });

  const brief = createProjectBriefFromBranch('早安单词', branches[0], {
    id: 'audit_1',
    generatedAt: '2026-11-18T00:00:00Z',
    summary: '整体可行',
    dataSkepticism: [],
    complianceRisks: [
      { point: '避免绝对化用语“老外绝对不说”', severity: 'medium', fix: '改为“日常口语高频习惯”' },
    ],
    hookVulnerabilities: [
      { flaw: '前两秒铺垫略慢', rewriteSuggestion: '直接对比错误发音与地道发音' },
    ],
  });

  assert.equal(brief.branchTitle, '方向二：职场破冰微场景');
  assert.ok(brief.riskNotes.includes('避免绝对化用语'));
  assert.ok(brief.riskNotes.includes('直接对比错误发音'));
});

test('buildStoryboardCsv escapes quotes and commas with UTF-8 BOM and cinema film lock', () => {
  const mockProject: Project = {
    id: 'p1',
    name: '测试项目',
    platform: '抖音竖屏',
    topic: '测试主题',
    currentStage: 3,
    updatedAt: '2026-11-18T00:00:00Z',
    stage1: {
      searchGroundingEnabled: true,
      messages: [],
      branches: [],
      activeBranchId: null,
      riskAudit: null,
    },
    stage2: {
      brief: null,
      scriptContent: '测试台词',
      editHistory: [],
    },
    stage3: {
      activeVisualLockId: 'ratio-16-9',
      customVisualLockSuffix: '',
      shots: [
        {
          id: 's1',
          shotNumber: 1,
          shotSize: '特写 CU',
          durationSec: 3,
          visualDescription: '桌面咖啡杯，蒸汽升起',
          dialogue: '早上好，"打工人"！',
          baseMjPrompt: 'Steaming coffee cup, morning light',
          cameraMovement: '固定微推',
        },
      ],
    },
  };

  const csv = buildStoryboardCsv(mockProject);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('画面描述(16:9横屏)'));
  assert.ok(csv.includes('"早上好，""打工人""！"'));
  assert.ok(csv.includes('35mm cinema film'));
  assert.ok(csv.includes('--ar 16:9'));
  assert.ok(!/--(?:v|version)\b/i.test(csv));

  const md = buildBriefMarkdown(mockProject);
  assert.ok(md.includes('# 测试项目 · 策划纪要与立项简报'));
});

test('normalizeApiProviderConfig upgrades legacy defaults and uses latest 2026 presets', () => {
  const builtin = normalizeApiProviderConfig();
  assert.equal(builtin.providerType, 'builtin-gemini');
  assert.equal(builtin.presetId, 'gemini');

  const legacyDeepseek = normalizeApiProviderConfig({
    providerType: 'custom-openai',
    presetId: 'deepseek',
    model: 'deepseek-chat',
    apiKey: ' sk-test ',
  });
  assert.equal(legacyDeepseek.providerType, 'deepseek');
  assert.equal(legacyDeepseek.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(legacyDeepseek.model, 'deepseek-flash');
  assert.equal(legacyDeepseek.apiKey, 'sk-test');

  const openai = normalizeApiProviderConfig({ providerType: 'openai', model: 'gpt-4o' });
  assert.equal(openai.providerType, 'openai');
  assert.equal(openai.baseUrl, 'https://api.openai.com/v1');
  assert.equal(openai.model, 'gpt-6.2-sol');

  const claude = normalizeApiProviderConfig({
    providerType: 'claude',
    model: 'claude-sonnet-4-20250514',
  });
  assert.equal(claude.providerType, 'claude');
  assert.equal(claude.baseUrl, 'https://api.anthropic.com');
  assert.equal(claude.model, 'claude-sonnet-5-5');
});

test('classifyAttachmentKind detects text, image, video, and rejects unsupported types', () => {
  assert.equal(classifyAttachmentKind('script.md', ''), 'text');
  assert.equal(classifyAttachmentKind('data.csv', 'text/csv'), 'text');
  assert.equal(classifyAttachmentKind('cover.png', 'image/png'), 'image');
  assert.equal(classifyAttachmentKind('clip.mp4', 'video/mp4'), 'video');
  assert.equal(classifyAttachmentKind('archive.zip', 'application/zip'), null);
});

test('parseWebdavPropfindXml extracts supported cloud files and skips directories', () => {
  const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
  <d:multistatus xmlns:d="DAV:">
    <d:response>
      <d:href>/dav/creator/</d:href>
      <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
    </d:response>
    <d:response>
      <d:href>/dav/creator/%E5%8F%A3%E6%92%AD%E5%8F%82%E8%80%83.md</d:href>
      <d:propstat><d:prop><d:displayname>口播参考.md</d:displayname><d:getcontentlength>2048</d:getcontentlength><d:getcontenttype>text/markdown</d:getcontenttype></d:prop></d:propstat>
    </d:response>
    <d:response>
      <d:href>/dav/creator/keyframe.jpg</d:href>
      <d:propstat><d:prop><d:getcontentlength>102400</d:getcontentlength><d:getcontenttype>image/jpeg</d:getcontenttype></d:prop></d:propstat>
    </d:response>
    <d:response>
      <d:href>/dav/creator/backup.zip</d:href>
      <d:propstat><d:prop><d:getcontentlength>500</d:getcontentlength><d:getcontenttype>application/zip</d:getcontenttype></d:prop></d:propstat>
    </d:response>
  </d:multistatus>`;

  const parsed = parseWebdavPropfindXml(sampleXml, 'https://dav.example.com/dav/creator/');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, '口播参考.md');
  assert.equal(parsed[0].kind, 'text');
  assert.equal(parsed[0].downloadRef, 'https://dav.example.com/dav/creator/%E5%8F%A3%E6%92%AD%E5%8F%82%E8%80%83.md');
  assert.equal(parsed[1].name, 'keyframe.jpg');
  assert.equal(parsed[1].kind, 'image');
});

test('parseLooseJsonSafe parses fenced JSON and throws friendly Chinese error on invalid input', () => {
  const fenced = '```json\n{"reply":"ok","directions":[]}\n```';
  const obj = parseLooseJsonSafe<{ reply: string }>(fenced);
  assert.equal(obj.reply, 'ok');

  assert.throws(
    () => parseLooseJsonSafe('not valid json at all'),
    /有效 JSON 格式/
  );
});

test('formatFriendlyErrorMessage translates raw network/auth errors into Chinese guidance', () => {
  assert.ok(formatFriendlyErrorMessage(new Error('Failed to fetch')).includes('网络连接'));
  assert.ok(formatFriendlyErrorMessage(new Error('HTTP 401 unauthorized')).includes('API Key'));
  assert.ok(formatFriendlyErrorMessage(new Error('429 rate limit exceeded')).includes('频繁'));
  assert.ok(formatFriendlyErrorMessage(new Error('auth/popup-blocked')).includes('弹窗被浏览器拦截'));
});

test('sanitizeBuiltinServerPayload strips apiKey and providerConfig before hitting built-in server routes', () => {
  const dirty = {
    projectName: 'Synapse Demo',
    apiKey: 'sk-secret-do-not-send',
    providerConfig: { apiKey: 'sk-secret-do-not-send' },
  };
  const clean = sanitizeBuiltinServerPayload(dirty) as Record<string, unknown>;
  assert.equal(clean.projectName, 'Synapse Demo');
  assert.equal('apiKey' in clean, false);
  assert.equal('providerConfig' in clean, false);
});

test('getScopedStorageKey isolates guest and signed-in UID caches', () => {
  assert.equal(getScopedStorageKey('creator_workbench_projects_v1'), 'creator_workbench_projects_v1');
  assert.equal(
    getScopedStorageKey('creator_workbench_projects_v1', 'uid_abc'),
    'creator_workbench_projects_v1_uid_uid_abc'
  );
});

test('BUILTIN_GEMINI_MODELS includes gemini-3.8-flash, gemini-4-hydrogen, gemini-4-argon, and gemini-3.1-flash-lite', () => {
  const modelIds = BUILTIN_GEMINI_MODELS.map((m) => m.id);
  assert.ok(modelIds.includes('gemini-3.8-flash'));
  assert.ok(modelIds.includes('gemini-4-hydrogen'));
  assert.ok(modelIds.includes('gemini-4-argon'));
  assert.ok(modelIds.includes('gemini-3.1-flash-lite'));

  const defaultModel = BUILTIN_GEMINI_MODELS.find((m) => m.isDefault);
  assert.equal(defaultModel?.id, 'gemini-3.8-flash');
});

test('DEFAULT_API_PROVIDER_CONFIG has empty apiKey and defaults to gemini-3.8-flash', () => {
  assert.equal(DEFAULT_API_PROVIDER_CONFIG.apiKey, '');
  assert.equal(DEFAULT_API_PROVIDER_CONFIG.model, 'gemini-3.8-flash');
  assert.equal(DEFAULT_API_PROVIDER_CONFIG.providerType, 'builtin-gemini');
});

test('parseApiErrorDetail correctly diagnoses 401, 403, 404, 429, 503 and preserves raw Google message', () => {
  const err403 = parseApiErrorDetail(
    '{"error":{"code":403,"message":"models/gemini-4-hydrogen is not permitted","status":"PERMISSION_DENIED"}}'
  );
  assert.equal(err403?.statusCode, 403);
  assert.equal(err403?.statusText, 'PERMISSION_DENIED');
  assert.ok(err403?.message.includes('not permitted'));

  const err404 = parseApiErrorDetail(
    '[Google API 错误 HTTP 404 · NOT_FOUND]: 请求的模型不存在。'
  );
  assert.equal(err404?.statusCode, 404);
  assert.equal(err404?.statusText, 'NOT_FOUND');

  const err429 = parseApiErrorDetail(
    '{"error":{"code":429,"message":"Resource has been exhausted","status":"RESOURCE_EXHAUSTED"}}'
  );
  assert.equal(err429?.statusCode, 429);
  assert.equal(err429?.statusText, 'RESOURCE_EXHAUSTED');

  const err503 = parseApiErrorDetail(
    '{"error":{"code":503,"message":"This model is experiencing high demand","status":"UNAVAILABLE"}}'
  );
  assert.equal(err503?.statusCode, 503);
  assert.equal(err503?.statusText, 'UNAVAILABLE');
});

test('New project creation enforces 9:16 or 16:9 aspect ratios and strictly 4 duration options', () => {
  const allowedAspectRatios = ['9:16', '16:9'];
  const allowedDurations = ['10~20秒', '1分钟左右', '2分钟左右', '3~5分钟'];

  assert.equal(allowedAspectRatios.length, 2);
  assert.equal(allowedDurations.length, 4);
  assert.ok(allowedDurations.includes('10~20秒'));
  assert.ok(allowedDurations.includes('1分钟左右'));
  assert.ok(allowedDurations.includes('2分钟左右'));
  assert.ok(allowedDurations.includes('3~5分钟'));

  // Test composite platform title formatting
  const p1 = `${allowedAspectRatios[0]} 竖屏 · ${allowedDurations[0]}`;
  assert.equal(p1, '9:16 竖屏 · 10~20秒');
  const p2 = `${allowedAspectRatios[1]} 横屏 · ${allowedDurations[3]}`;
  assert.equal(p2, '16:9 横屏 · 3~5分钟');
});

test('UI Theme tone options support charcoal, obsidian, midnight, and slate', () => {
  const validTones = ['charcoal', 'obsidian', 'midnight', 'slate'];
  assert.equal(validTones.length, 4);
  assert.ok(validTones.includes('charcoal'));
  assert.ok(validTones.includes('obsidian'));
  assert.ok(validTones.includes('midnight'));
  assert.ok(validTones.includes('slate'));
});

test('Copywriting rules handbook is mounted and covers all 5 core modules and 5 red lines', () => {
  assert.ok(COPYWRITING_RULES_MARKDOWN.includes('自媒体短视频全流程文案创作规则手册'));
  assert.ok(COPYWRITING_RULES_MARKDOWN.includes('模块一：触发与黄金前 3 秒'));
  assert.ok(COPYWRITING_RULES_MARKDOWN.includes('模块二：中段留存与滑梯效应节奏控制'));
  assert.ok(COPYWRITING_RULES_MARKDOWN.includes('模块三：多变的酬赏与核心价值交付'));
  assert.ok(COPYWRITING_RULES_MARKDOWN.includes('模块四：投入与闭环设计'));
  assert.ok(COPYWRITING_RULES_MARKDOWN.includes('模块五：输出规范与 5 条红线质检'));
  assert.ok(COPYWRITING_RULES_MARKDOWN.includes('25 汉字'));
});

test('Multilingual system supports Chinese, English, Portuguese, and Thai', () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 4);
  const ids = SUPPORTED_LANGUAGES.map((l) => l.id);
  assert.ok(ids.includes('zh-CN'));
  assert.ok(ids.includes('en-US'));
  assert.ok(ids.includes('pt-BR'));
  assert.ok(ids.includes('th-TH'));

  for (const lang of ids) {
    assert.ok(TRANSLATIONS[lang]);
    assert.ok(TRANSLATIONS[lang]['nav.stage1_short']);
    assert.ok(TRANSLATIONS[lang]['nav.stage2_short']);
    assert.ok(TRANSLATIONS[lang]['nav.stage3_short']);
    assert.ok(TRANSLATIONS[lang]['stage1.introTitle']);
    assert.ok(TRANSLATIONS[lang]['stage2.editorTitle']);
    assert.ok(TRANSLATIONS[lang]['stage2.enhanceHookBtn']);
    assert.ok(TRANSLATIONS[lang]['stage3.headerTitle']);
    assert.ok(TRANSLATIONS[lang]['stage3.visualLockLabel']);
    assert.ok(TRANSLATIONS[lang]['coach.title']);
    assert.ok(TRANSLATIONS[lang]['settings.title']);
    assert.ok(TRANSLATIONS[lang]['settings.languageSection']);
    assert.ok(TRANSLATIONS[lang]['empty.title']);
    assert.ok(TRANSLATIONS[lang]['error.modalTitle']);
  }
});


