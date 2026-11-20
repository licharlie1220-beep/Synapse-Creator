import 'dotenv/config';
import express, { type Response } from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  appendSqlChatMessage,
  deleteUserSqlProject,
  listSqlChatMessages,
  listUserSqlProjects,
  upsertUserSqlProject,
} from './src/db/projectsRepo.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  GeminiServerError,
  runAddShotServer,
  runBrainstormServer,
  runBranchChatServer,
  runChatbotTurnServer,
  runEditShotServer,
  runEnhanceHookServer,
  runGenerateScriptServer,
  runInlineEditServer,
  runRiskAuditServer,
  runStoryboardServer,
} from './src/server/geminiService.ts';
import { classifyAttachmentKind, parseWebdavPropfindXml } from './src/utils/workflow.ts';

const currentFilename =
  typeof __filename !== 'undefined'
    ? __filename
    : typeof import.meta?.url === 'string'
    ? fileURLToPath(import.meta.url)
    : '';
const currentDirname =
  typeof __dirname !== 'undefined'
    ? __dirname
    : currentFilename
    ? path.dirname(currentFilename)
    : process.cwd();

function handleGeminiRouteError(res: Response, error: unknown, context: string) {
  console.error(`${context} error:`, error);
  if (error instanceof GeminiServerError) {
    res.status(error.statusCode).json({
      error: error.message,
      statusCode: error.statusCode,
      statusText: error.statusText,
      rawDetails: error.rawDetails,
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'Gemini 请求处理失败';
  res.status(500).json({ error: message, statusCode: 500 });
}

function sanitizeGeminiBody<T>(body: T, req?: express.Request): T {
  if (!body || typeof body !== 'object') {
    return {} as T;
  }
  const clean = { ...(body as Record<string, unknown>) };
  delete clean.providerConfig;
  delete clean.apiKey;

  if (req) {
    const headerKey = req.headers['x-gemini-api-key'];
    if (typeof headerKey === 'string' && headerKey.trim()) {
      clean.customGeminiApiKey = headerKey.trim();
    }
    const headerModel = req.headers['x-gemini-model'];
    if (typeof headerModel === 'string' && headerModel.trim() && !clean.model) {
      clean.model = headerModel.trim();
    }
  }
  return clean as T;
}

async function fetchWithServerTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 30000
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('远程 WebDAV 网盘连接超时，请检查网盘地址与网络状态。');
    }
    throw err;
  } finally {
    clearTimeout(timerId);
  }
}

export async function startServer(customPort?: number): Promise<any> {
  const app = express();
  const PORT = customPort || Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '40mb' }));

  // --- Server-side Local Configuration Persistence ---
  function getPersistentConfigFile(): string {
    const homeDir = process.env.USERPROFILE || process.env.HOME || process.cwd();
    const wsDir = path.join(homeDir, 'Documents', 'Synapse_Workspace');
    if (!fs.existsSync(wsDir)) {
      try {
        fs.mkdirSync(wsDir, { recursive: true });
      } catch {
        // ignore
      }
    }
    return path.join(wsDir, 'synapse-config.json');
  }

  app.get('/api/config/provider', (_req, res) => {
    try {
      const cfgPath = getPersistentConfigFile();
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf8');
        return res.json(JSON.parse(raw));
      }
    } catch {
      // ignore
    }
    res.json({
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      providerType: 'builtin-gemini',
    });
  });

  app.post('/api/config/provider', (req, res) => {
    try {
      const cfg = req.body || {};
      const cfgPath = getPersistentConfigFile();
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
      if (cfg.apiKey) {
        process.env.GEMINI_API_KEY = cfg.apiKey;
      }
      if (cfg.model) {
        process.env.GEMINI_MODEL = cfg.model;
      }
      res.json({ ok: true, savedPath: cfgPath });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Helper to set fallback headers ---
  function sendGeminiResult(res: Response, result: any) {
    if (result && typeof result === 'object' && result.fallbackOccurred) {
      res.setHeader('x-gemini-fallback', 'true');
      if (result.modelUsed) {
        res.setHeader('x-gemini-model-used', result.modelUsed);
      }
    }
    res.json(result);
  }

  // --- Server-side Gemini API Proxy Routes ---
  app.post('/api/gemini/brainstorm', async (req, res) => {
    try {
      const result = await runBrainstormServer(sanitizeGeminiBody(req.body, req));
      sendGeminiResult(res, result);
    } catch (error) {
      handleGeminiRouteError(res, error, 'POST /api/gemini/brainstorm');
    }
  });

  app.post('/api/gemini/branch-chat', async (req, res) => {
    try {
      const result = await runBranchChatServer(sanitizeGeminiBody(req.body, req));
      sendGeminiResult(res, result);
    } catch (error) {
      handleGeminiRouteError(res, error, 'POST /api/gemini/branch-chat');
    }
  });

  app.post('/api/gemini/risk-audit', async (req, res) => {
    try {
      const result = await runRiskAuditServer(sanitizeGeminiBody(req.body, req));
      sendGeminiResult(res, result);
    } catch (error) {
      handleGeminiRouteError(res, error, 'POST /api/gemini/risk-audit');
    }
  });

  app.post('/api/gemini/generate-script', async (req, res) => {
    try {
      const result = await runGenerateScriptServer(sanitizeGeminiBody(req.body, req));
      sendGeminiResult(res, result);
    } catch (error) {
      handleGeminiRouteError(res, error, 'POST /api/gemini/generate-script');
    }
  });

  app.post('/api/gemini/enhance-hook', async (req, res) => {
    try {
      const result = await runEnhanceHookServer(sanitizeGeminiBody(req.body, req));
      sendGeminiResult(res, result);
    } catch (error) {
      handleGeminiRouteError(res, error, 'POST /api/gemini/enhance-hook');
    }
  });

  app.post('/api/gemini/inline-edit', async (req, res) => {
    try {
      const result = await runInlineEditServer(sanitizeGeminiBody(req.body, req));
      sendGeminiResult(res, result);
    } catch (error) {
      handleGeminiRouteError(res, error, 'POST /api/gemini/inline-edit');
    }
  });

  app.post('/api/gemini/storyboard', async (req, res) => {
    try {
      const result = await runStoryboardServer(sanitizeGeminiBody(req.body, req));
      sendGeminiResult(res, result);
    } catch (error) {
      handleGeminiRouteError(res, error, 'POST /api/gemini/storyboard');
    }
  });

  app.post('/api/gemini/edit-shot', async (req, res) => {
    try {
      const updated = await runEditShotServer(sanitizeGeminiBody(req.body, req));
      sendGeminiResult(res, updated);
    } catch (error) {
      handleGeminiRouteError(res, error, 'POST /api/gemini/edit-shot');
    }
  });

  app.post('/api/gemini/add-shot', async (req, res) => {
    try {
      const result = await runAddShotServer(sanitizeGeminiBody(req.body, req));
      sendGeminiResult(res, result);
    } catch (error) {
      handleGeminiRouteError(res, error, 'POST /api/gemini/add-shot');
    }
  });

  app.post('/api/gemini/chatbot', async (req, res) => {
    try {
      const result = await runChatbotTurnServer(sanitizeGeminiBody(req.body, req));
      sendGeminiResult(res, result);
    } catch (error) {
      handleGeminiRouteError(res, error, 'POST /api/gemini/chatbot');
    }
  });

  // --- Stateless User-Configured WebDAV Cloud Drive Save & Read Proxy ---
  function validateExternalWebdavUrl(rawUrl: string): URL {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl.trim());
    } catch {
      throw new Error('WebDAV 地址格式无效，请以 https:// 开头。');
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error('WebDAV 仅支持 http/https 协议。');
    }
    const host = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isPrivate172 = /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === '127.0.0.1' ||
      host.startsWith('127.') ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80:') ||
      host.startsWith('169.254.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      isPrivate172
    ) {
      throw new Error('出于安全限制，不允许访问本机或内网保留地址。');
    }
    return parsedUrl;
  }

  function buildWebdavAuthHeader(username?: string, password?: string): Record<string, string> {
    if (!username && !password) return {};
    const token = Buffer.from(`${username || ''}:${password || ''}`, 'utf8').toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  app.post('/api/storage/webdav-list', async (req, res) => {
    try {
      const { webdavUrl, webdavPath, username, password } = req.body as {
        webdavUrl?: string;
        webdavPath?: string;
        username?: string;
        password?: string;
      };
      if (!webdavUrl) {
        res.status(400).json({ error: '请先在保存设置中填写 WebDAV 网盘地址。' });
        return;
      }
      validateExternalWebdavUrl(webdavUrl);
      const cleanBase = webdavUrl.trim().replace(/\/+$/, '');
      const cleanSubdir = (webdavPath || '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean)
        .map((seg) => encodeURIComponent(seg))
        .join('/');
      const dirUrl = cleanSubdir ? `${cleanBase}/${cleanSubdir}/` : `${cleanBase}/`;

      const upstream = await fetchWithServerTimeout(dirUrl, {
        method: 'PROPFIND',
        headers: {
          Depth: '1',
          'Content-Type': 'application/xml; charset=utf-8',
          ...buildWebdavAuthHeader(username, password),
        },
      });

      if (!upstream.ok && upstream.status !== 207) {
        res.status(upstream.status).json({
          error: `读取 WebDAV 目录失败（HTTP ${upstream.status}），请检查网盘地址或授权密码。`,
        });
        return;
      }

      const xmlText = await upstream.text();
      const files = parseWebdavPropfindXml(xmlText, cleanBase);
      res.json({ files });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : '读取 WebDAV 目录失败。',
      });
    }
  });

  app.post('/api/storage/webdav-read', async (req, res) => {
    try {
      const { webdavUrl, username, password, fileHref, fileName, mimeType } = req.body as {
        webdavUrl?: string;
        username?: string;
        password?: string;
        fileHref?: string;
        fileName?: string;
        mimeType?: string;
      };
      if (!webdavUrl || !fileHref) {
        res.status(400).json({ error: '缺少 WebDAV 地址或目标文件路径。' });
        return;
      }

      const baseParsed = validateExternalWebdavUrl(webdavUrl);
      const fileParsed = validateExternalWebdavUrl(fileHref);
      if (baseParsed.origin !== fileParsed.origin) {
        res.status(400).json({ error: '目标文件必须与已配置的 WebDAV 服务器同源。' });
        return;
      }

      const upstream = await fetchWithServerTimeout(
        fileParsed.toString(),
        {
          method: 'GET',
          headers: buildWebdavAuthHeader(username, password),
        },
        45000
      );

      if (!upstream.ok) {
        res.status(upstream.status).json({
          error: `读取 WebDAV 文件失败（HTTP ${upstream.status}）。`,
        });
        return;
      }

      const arrBuf = await upstream.arrayBuffer();
      const MAX_BYTES = 20 * 1024 * 1024;
      if (arrBuf.byteLength > MAX_BYTES) {
        res.status(400).json({ error: 'WebDAV 云端文件超过 20MB 限制，请裁剪后重试。' });
        return;
      }

      const rawTail = fileParsed.pathname.split('/').pop() || 'cloud_file';
      let decodedTail = rawTail;
      try {
        decodedTail = decodeURIComponent(rawTail);
      } catch {
        // Keep raw tail if percent-encoding is malformed
      }
      const resolvedName = fileName || decodedTail;
      const resolvedMime = (mimeType || upstream.headers.get('content-type') || '').split(';')[0].trim();
      const kind = classifyAttachmentKind(resolvedName, resolvedMime) || 'text';

      if (kind === 'text') {
        const textContent = Buffer.from(arrBuf).toString('utf8').slice(0, 30000);
        res.json({
          attachment: {
            id: `att_wd_${Date.now()}`,
            name: resolvedName,
            mimeType: resolvedMime || 'text/plain',
            kind: 'text',
            sizeBytes: arrBuf.byteLength,
            textContent,
          },
        });
        return;
      }

      res.json({
        attachment: {
          id: `att_wd_${Date.now()}`,
          name: resolvedName,
          mimeType: resolvedMime || (kind === 'image' ? 'image/png' : 'video/mp4'),
          kind,
          sizeBytes: arrBuf.byteLength,
          base64Data: Buffer.from(arrBuf).toString('base64'),
        },
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : '读取 WebDAV 文件失败。',
      });
    }
  });

  app.post('/api/storage/webdav', async (req, res) => {
    try {
      const { webdavUrl, webdavPath, username, password, filename, contentBase64 } =
        req.body as {
          webdavUrl?: string;
          webdavPath?: string;
          username?: string;
          password?: string;
          filename?: string;
          contentBase64?: string;
        };

      if (!webdavUrl || !filename || !contentBase64) {
        res.status(400).json({ error: '请填写完整的 WebDAV 网盘地址、目标文件名与文件内容。' });
        return;
      }

      validateExternalWebdavUrl(webdavUrl);

      const cleanBase = webdavUrl.trim().replace(/\/+$/, '');
      const cleanSubdir = (webdavPath || '')
        .trim()
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean)
        .map((seg) => encodeURIComponent(seg))
        .join('/');
      const safeFile = encodeURIComponent(filename.replace(/[\\/]/g, '_'));
      const targetUrl = cleanSubdir
        ? `${cleanBase}/${cleanSubdir}/${safeFile}`
        : `${cleanBase}/${safeFile}`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/zip',
        ...buildWebdavAuthHeader(username, password),
      };

      const buffer = Buffer.from(contentBase64, 'base64');
      const upstream = await fetchWithServerTimeout(
        targetUrl,
        {
          method: 'PUT',
          headers,
          body: buffer,
        },
        45000
      );

      if (!upstream.ok && upstream.status !== 201 && upstream.status !== 204) {
        const errText = await upstream.text().catch(() => '');
        res.status(upstream.status).json({
          error: `WebDAV 网盘上传失败（HTTP ${upstream.status}）：${errText.slice(0, 160) || '请检查账号密码或目录权限'}`,
        });
        return;
      }

      res.json({ ok: true, targetUrl });
    } catch (error) {
      console.error('POST /api/storage/webdav error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'WebDAV 网盘连接失败，请检查网络或网盘地址。' });
    }
  });

  // --- Local Folder Auto-Save & Reveal Endpoints ---
  app.get('/api/storage/local-folder/default-path', (_req, res) => {
    try {
      const homeDir = process.env.USERPROFILE || process.env.HOME || 'D:\\';
      const defaultDir = path.join(homeDir, 'Documents', 'Synapse_Workspace');
      if (!fs.existsSync(defaultDir)) {
        fs.mkdirSync(defaultDir, { recursive: true });
      }
      res.json({ defaultPath: defaultDir });
    } catch {
      res.json({ defaultPath: 'D:\\Synapse_Workspace' });
    }
  });

  app.post('/api/storage/local-folder/save', async (req, res) => {
    try {
      const {
        folderPath,
        safeTitle,
        jsonString,
        briefMd,
        scriptTxt,
        storyboardCsv,
        storyboardXlsxBase64,
      } = req.body as {
        folderPath?: string;
        safeTitle?: string;
        jsonString?: string;
        briefMd?: string;
        scriptTxt?: string;
        storyboardCsv?: string;
        storyboardXlsxBase64?: string;
      };

      if (!folderPath || !jsonString) {
        res.status(400).json({ error: '缺少本地保存路径或项目数据' });
        return;
      }

      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }

      const title = (safeTitle || 'Synapse_Project').replace(/[\\/:*?"<>|]/g, '_');
      const filesWritten: string[] = [];

      // 1. Project JSON state
      const jsonFile = path.join(folderPath, `${title}.synapse.json`);
      fs.writeFileSync(jsonFile, jsonString, 'utf8');
      filesWritten.push(`${title}.synapse.json`);

      // 2. Brief Markdown
      if (briefMd) {
        const mdFile = path.join(folderPath, `${title}_策划纪要.md`);
        fs.writeFileSync(mdFile, briefMd, 'utf8');
        filesWritten.push(`${title}_策划纪要.md`);
      }

      // 3. Script Text
      if (scriptTxt) {
        const txtFile = path.join(folderPath, `${title}_口播脚本.txt`);
        fs.writeFileSync(txtFile, scriptTxt, 'utf8');
        filesWritten.push(`${title}_口播脚本.txt`);
      }

      // 4. Storyboard CSV
      if (storyboardCsv) {
        const csvFile = path.join(folderPath, `${title}_分镜提示词表.csv`);
        fs.writeFileSync(csvFile, storyboardCsv, 'utf8');
        filesWritten.push(`${title}_分镜提示词表.csv`);
      }

      // 5. Storyboard XLSX
      if (storyboardXlsxBase64) {
        const xlsxFile = path.join(folderPath, `${title}_分镜提示词表.xlsx`);
        fs.writeFileSync(xlsxFile, Buffer.from(storyboardXlsxBase64, 'base64'));
        filesWritten.push(`${title}_分镜提示词表.xlsx`);
      }

      res.json({ ok: true, filesWritten });
    } catch (error) {
      console.error('Local folder save error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : '写入本地文件夹失败' });
    }
  });

  app.post('/api/storage/local-folder/reveal', async (req, res) => {
    try {
      const { folderPath } = req.body as { folderPath?: string };
      if (folderPath && fs.existsSync(folderPath)) {
        const { exec } = await import('child_process');
        if (process.platform === 'win32') {
          exec(`explorer.exe "${folderPath.replace(/\//g, '\\')}"`);
        }
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: '无法打开资源管理器' });
    }
  });

  app.get('/api/storage/local-folder/list', (req, res) => {
    try {
      const folderPath = String(req.query.path || '').trim();
      if (!folderPath || !fs.existsSync(folderPath)) {
        res.json({ projects: [] });
        return;
      }
      const files = fs.readdirSync(folderPath);
      const synapseFiles = files.filter((f) => f.endsWith('.synapse.json'));
      const projects = synapseFiles.map((fileName) => {
        const fullPath = path.join(folderPath, fileName);
        const stats = fs.statSync(fullPath);
        return {
          fileName,
          projectName: fileName.replace('.synapse.json', ''),
          updatedAt: stats.mtime.toLocaleString('zh-CN'),
          fileSize: stats.size,
        };
      });
      res.json({ projects });
    } catch (error) {
      res.status(500).json({ error: '读取项目列表失败' });
    }
  });

  // --- Authenticated Cloud SQL Project Persistence Routes ---
  app.get('/api/sql/projects', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const rows = await listUserSqlProjects(uid);
      res.json({ projects: rows });
    } catch (error) {
      console.error('GET /api/sql/projects error:', error);
      res.status(500).json({ error: 'Failed to retrieve projects' });
    }
  });

  app.put('/api/sql/projects/:externalId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const externalId = String(req.params.externalId || '').trim();
      const { name, platform, topic, currentStage, payloadJson } = req.body as {
        name?: string;
        platform?: string;
        topic?: string;
        currentStage?: number;
        payloadJson?: string;
      };

      if (!externalId || !name || !payloadJson) {
        res.status(400).json({ error: 'Missing required project fields' });
        return;
      }

      const saved = await upsertUserSqlProject({
        externalId,
        userUid: uid,
        name: name.slice(0, 120),
        platform: (platform || '').slice(0, 120),
        topic: (topic || '').slice(0, 500),
        currentStage: Number.isInteger(currentStage) ? Number(currentStage) : 1,
        payloadJson,
      });
      res.json({ project: saved });
    } catch (error) {
      console.error('PUT /api/sql/projects error:', error);
      res.status(500).json({ error: 'Failed to save project' });
    }
  });

  app.delete('/api/sql/projects/:externalId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const externalId = String(req.params.externalId || '').trim();
      if (!externalId) {
        res.status(400).json({ error: 'Missing project ID' });
        return;
      }
      await deleteUserSqlProject(uid, externalId);
      res.json({ deleted: true });
    } catch (error) {
      console.error('DELETE /api/sql/projects error:', error);
      res.status(500).json({ error: 'Failed to delete project' });
    }
  });

  // --- Authenticated Cloud SQL Multi-Turn Chatbot History Routes ---
  app.get('/api/sql/chat/:projectExternalId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const projectExternalId = String(req.params.projectExternalId || '').trim();
      const messages = await listSqlChatMessages(uid, projectExternalId);
      res.json({ messages });
    } catch (error) {
      console.error('GET /api/sql/chat error:', error);
      res.status(500).json({ error: 'Failed to load chat history' });
    }
  });

  app.post('/api/sql/chat', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const { projectExternalId, role, personaId, modelName, content } = req.body as {
        projectExternalId?: string;
        role?: string;
        personaId?: string;
        modelName?: string;
        content?: string;
      };

      if (!projectExternalId || !role || !content) {
        res.status(400).json({ error: 'Missing required chat message fields' });
        return;
      }

      const row = await appendSqlChatMessage({
        userUid: uid,
        projectExternalId: projectExternalId.slice(0, 128),
        role: role === 'model' ? 'model' : 'user',
        personaId: (personaId || 'script-coach').slice(0, 64),
        modelName: (modelName || 'gemini-4-hydrogen').slice(0, 64),
        content: content.slice(0, 20000),
      });
      res.status(201).json({ message: row });
    } catch (error) {
      console.error('POST /api/sql/chat error:', error);
      res.status(500).json({ error: 'Failed to persist chat message' });
    }
  });

  // Ensure unmatched /api/* routes always return JSON, never HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(currentDirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  return new Promise((resolve) => {
    function tryListen(portToTry: number, maxAttempts = 10) {
      const server = http.createServer(app);
      let handled = false;

      server.on('error', (err: any) => {
        if (handled) return;
        handled = true;
        try {
          server.close();
        } catch {
          // ignore
        }
        if (err && err.code === 'EADDRINUSE') {
          console.warn(`[Synapse Server] Port ${portToTry} in use, automatically trying port ${portToTry + 1}...`);
          if (maxAttempts > 0) {
            tryListen(portToTry + 1, maxAttempts - 1);
          } else {
            console.error('[Synapse Server] Could not find an available port after retries.');
            resolve({ port: portToTry, server: null });
          }
        } else {
          console.error('[Synapse Server] Listen error:', err);
          resolve({ port: portToTry, server: null });
        }
      });

      server.listen(portToTry, '127.0.0.1', () => {
        console.log(`[Synapse Server] Listening on http://127.0.0.1:${portToTry}`);
        resolve({ port: portToTry, server });
      });
    }

    tryListen(PORT);
  });
}

const isElectronProcess = Boolean(
  process.versions?.electron ||
  process.env.ELECTRON_RUN_AS_NODE ||
  process.env.AUTO_START_SERVER === 'false'
);

if (!isElectronProcess) {
  void startServer();
}
