const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');

// Global uncaught exception protection for Electron Main process
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'EADDRINUSE' || String(err).includes('EADDRINUSE') || String(err).includes('address already in use'))) {
    console.warn(`[Electron Main] Handled EADDRINUSE gracefully: ${err.message || err}`);
    return;
  }
  console.error('[Electron Main] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.warn('[Electron Main] Handled unhandledRejection gracefully:', reason);
});

// Suppress default Electron error dialog for harmless port conflicts
const originalShowErrorBox = dialog.showErrorBox;
dialog.showErrorBox = (title, content) => {
  const text = `${title || ''} ${content || ''}`;
  if (text.includes('EADDRINUSE') || text.includes('address already in use')) {
    console.warn(`[Electron Main] Suppressed EADDRINUSE dialog box: ${content}`);
    return;
  }
  return originalShowErrorBox.call(dialog, title, content);
};

// Enforce single instance lock to prevent duplicate servers and port collisions
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Electron Main] Another instance of Synapse is already running. Quitting duplicate instance.');
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Use standard Chrome User-Agent to prevent Google OAuth from blocking with 'disallowed_useragent'
app.userAgentFallback =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Attempt loading .env from application paths
const envCandidates = [
  path.join(__dirname, '..', '.env'),
  path.join(process.cwd(), '.env'),
  path.join(path.dirname(app.getPath('exe')), '.env'),
];
for (const envP of envCandidates) {
  if (fs.existsSync(envP)) {
    try {
      require('dotenv').config({ path: envP });
      break;
    } catch {
      // ignore
    }
  }
}

let mainWindow = null;
let serverInstance = null;
let appPort = 3000;

function isSynapseRunning(port = 3000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/storage/local-folder/default-path`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function findAvailablePort(startPort = 3000) {
  return new Promise((resolve) => {
    function testNext(port) {
      if (port > 3100) {
        // Fall back to ephemeral OS-assigned port
        const s = net.createServer();
        s.unref();
        s.listen(0, '127.0.0.1', () => {
          const ephemeralPort = s.address().port;
          s.close(() => resolve(ephemeralPort));
        });
        return;
      }
      const tester = net.createServer();
      tester.unref();
      tester.once('error', (err) => {
        if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
          testNext(port + 1);
        } else {
          testNext(port + 1);
        }
      });
      tester.once('listening', () => {
        const freePort = tester.address().port;
        tester.close(() => resolve(freePort));
      });
      tester.listen(port, '127.0.0.1');
    }
    testNext(startPort);
  });
}

function getDocumentsWorkspaceDir() {
  const docs = app.getPath('documents');
  const ws = path.join(docs, 'Synapse_Workspace');
  if (!fs.existsSync(ws)) {
    try {
      fs.mkdirSync(ws, { recursive: true });
    } catch {
      // ignore
    }
  }
  return ws;
}

async function startEmbeddedServer(preferredPort = 3000) {
  return new Promise((resolve) => {
    try {
      process.env.NODE_ENV = 'production';
      process.env.AUTO_START_SERVER = 'false';
      process.env.PORT = String(preferredPort);

      const serverCjsPath = path.join(__dirname, '..', 'server.cjs');
      const serverJsPath = path.join(__dirname, '..', 'server.js');

      if (fs.existsSync(serverCjsPath)) {
        try {
          const mod = require(serverCjsPath);
          if (typeof mod.startServer === 'function') {
            mod.startServer(preferredPort)
              .then((result) => {
                const actualPort = result?.port || preferredPort;
                serverInstance = result?.server || null;
                resolve(actualPort);
              })
              .catch(() => resolve(preferredPort));
            return;
          }
          console.log(`Embedded Synapse server loaded via CJS on port ${preferredPort}`);
          setTimeout(() => resolve(preferredPort), 600);
          return;
        } catch (err) {
          console.error('CJS require server error:', err);
        }
      }

      if (fs.existsSync(serverJsPath)) {
        import('file://' + serverJsPath.replace(/\\/g, '/'))
          .then((mod) => {
            if (typeof mod.startServer === 'function') {
              mod.startServer(preferredPort)
                .then((result) => {
                  const actualPort = result?.port || preferredPort;
                  serverInstance = result?.server || null;
                  resolve(actualPort);
                })
                .catch(() => resolve(preferredPort));
            } else {
              setTimeout(() => resolve(preferredPort), 800);
            }
          })
          .catch((err) => {
            console.error('Failed to import embedded server:', err);
            resolve(preferredPort);
          });
        return;
      }

      resolve(preferredPort);
    } catch (err) {
      console.error('Embedded server startup error:', err);
      resolve(preferredPort);
    }
  });
}

function createWindow(port = 3000) {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const pngIconPath = path.join(__dirname, '..', 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#101113',
    title: 'Synapse — 创作者工作台',
    icon: fs.existsSync(iconPath) ? iconPath : (fs.existsSync(pngIconPath) ? pngIconPath : undefined),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  const startUrl = isDev
    ? `http://localhost:${process.env.PORT || 3000}`
    : `http://localhost:${port}`;

  // Retry loading in case the server takes a moment to bind
  let retries = 0;
  const loadPage = () => {
    mainWindow.loadURL(startUrl).catch((err) => {
      if (retries < 15) {
        retries++;
        setTimeout(loadPage, 600);
      } else {
        console.error('Failed to load Synapse URL:', err);
      }
    });
  };

  loadPage();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow Firebase Auth and Google OAuth popup windows inside Electron
    const isAuthUrl =
      url.includes('firebaseapp.com') ||
      url.includes('accounts.google.com') ||
      url.includes('google.com/o/oauth2') ||
      url.includes('googleapis.com');

    if (isAuthUrl) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          title: 'Google 账号登录与授权',
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
          },
        },
      };
    }

    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('select-directory', async (_event, defaultPath) => {
  if (!mainWindow) return null;
  const initial = defaultPath && fs.existsSync(defaultPath)
    ? defaultPath
    : getDocumentsWorkspaceDir();

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 Synapse 本地自动保存文件夹',
    defaultPath: initial,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('get-default-workspace-path', () => {
  return getDocumentsWorkspaceDir();
});

ipcMain.handle('open-path', async (_event, targetPath) => {
  if (!targetPath) return false;
  try {
    if (fs.existsSync(targetPath)) {
      await shell.openPath(targetPath);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
});

ipcMain.handle('save-project-files', async (_event, folderPath, payload) => {
  try {
    const {
      project,
      jsonString,
      briefMd,
      scriptTxt,
      storyboardCsv,
      storyboardXlsxBase64,
    } = payload;

    const targetDir = folderPath || getDocumentsWorkspaceDir();
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const safeTitle = (project.name || '创作项目').replace(/[\\/:*?"<>|]/g, '_').trim();
    const filesWritten = [];

    // 1. .synapse.json
    const jsonPath = path.join(targetDir, `${safeTitle}.synapse.json`);
    fs.writeFileSync(jsonPath, jsonString, 'utf8');
    filesWritten.push(`${safeTitle}.synapse.json`);

    // 2. .md
    if (briefMd) {
      const mdPath = path.join(targetDir, `${safeTitle}_策划纪要.md`);
      fs.writeFileSync(mdPath, briefMd, 'utf8');
      filesWritten.push(`${safeTitle}_策划纪要.md`);
    }

    // 3. .txt
    if (scriptTxt) {
      const txtPath = path.join(targetDir, `${safeTitle}_口播脚本.txt`);
      fs.writeFileSync(txtPath, scriptTxt, 'utf8');
      filesWritten.push(`${safeTitle}_口播脚本.txt`);
    }

    // 4. .csv
    if (storyboardCsv) {
      const csvPath = path.join(targetDir, `${safeTitle}_分镜提示词表.csv`);
      fs.writeFileSync(csvPath, storyboardCsv, 'utf8');
      filesWritten.push(`${safeTitle}_分镜提示词表.csv`);
    }

    // 5. .xlsx
    if (storyboardXlsxBase64) {
      const xlsxPath = path.join(targetDir, `${safeTitle}_分镜提示词表.xlsx`);
      fs.writeFileSync(xlsxPath, Buffer.from(storyboardXlsxBase64, 'base64'));
      filesWritten.push(`${safeTitle}_分镜提示词表.xlsx`);
    }

    return { ok: true, filesWritten };
  } catch (err) {
    return { ok: false, filesWritten: [], error: err.message };
  }
});

ipcMain.handle('list-project-files', async (_event, folderPath) => {
  try {
    const targetDir = folderPath || getDocumentsWorkspaceDir();
    if (!fs.existsSync(targetDir)) return [];

    const files = fs.readdirSync(targetDir);
    const results = [];
    for (const f of files) {
      if (f.endsWith('.synapse.json')) {
        const full = path.join(targetDir, f);
        const stats = fs.statSync(full);
        results.push({
          fileName: f,
          projectName: f.replace('.synapse.json', ''),
          updatedAt: stats.mtime.toLocaleString('zh-CN'),
          fileSize: stats.size,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
});

ipcMain.handle('load-project-file', async (_event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

function getAppConfigPath() {
  return path.join(app.getPath('userData'), 'synapse-config.json');
}

ipcMain.handle('save-app-config', async (_event, config) => {
  try {
    const p = getAppConfigPath();
    const configDir = path.dirname(p);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
    const ws = getDocumentsWorkspaceDir();
    fs.writeFileSync(path.join(ws, 'synapse-config.json'), JSON.stringify(config, null, 2), 'utf8');
    if (config?.apiKey) {
      process.env.GEMINI_API_KEY = config.apiKey;
    }
    if (config?.model) {
      process.env.GEMINI_MODEL = config.model;
    }
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('load-app-config', async () => {
  try {
    const p = getAppConfigPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    const ws = path.join(getDocumentsWorkspaceDir(), 'synapse-config.json');
    if (fs.existsSync(ws)) {
      return JSON.parse(fs.readFileSync(ws, 'utf8'));
    }
  } catch {
    // ignore
  }
  return null;
});

app.whenReady().then(async () => {
  if (process.env.NODE_ENV !== 'development') {
    const isAlreadyRunning = await isSynapseRunning(3000);
    if (isAlreadyRunning) {
      console.log('Detected active Synapse server on port 3000, connecting directly.');
      appPort = 3000;
    } else {
      const freePort = await findAvailablePort(3000);
      console.log(`[Electron Main] Selected available local port: ${freePort}`);
      appPort = await startEmbeddedServer(freePort);
    }
  } else {
    appPort = Number(process.env.PORT || 3000);
  }
  createWindow(appPort);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(appPort);
  });
});

app.on('before-quit', () => {
  if (serverInstance && typeof serverInstance.close === 'function') {
    try {
      serverInstance.close();
    } catch {
      // ignore
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (serverInstance && typeof serverInstance.close === 'function') {
    try {
      serverInstance.close();
    } catch {
      // ignore
    }
  }
  process.exit(0);
});
