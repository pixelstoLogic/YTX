const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, globalShortcut, shell, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const http = require('node:http');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform, Readable } = require('node:stream');

const GITHUB_REPOSITORY = 'pixelstoLogic/YTX';

let backendProcess = null;
let backendPort = null;
let backendStartup = null;
let mainWindow = null;
let tray = null;
let quitting = false;
let pendingVideoUrl = '';
let adobeBridgeServer = null;
let adobeBridgePort = 0;
let adobeBridgeToken = crypto.randomBytes(24).toString('hex');
const adobeHeartbeats = new Map();
const adobeCommands = { premiere: [], aftereffects: [] };
const adobeWaiters = new Map();
const preferencesPath = () => path.join(app.getPath('userData'), 'preferences.json');
const updateStatePath = () => path.join(app.getPath('userData'), 'update-state.json');
function readUpdateState() { try { return JSON.parse(fs.readFileSync(updateStatePath(), 'utf8')); } catch { return {}; } }
function writeUpdateState(state) { fs.mkdirSync(path.dirname(updateStatePath()), { recursive: true }); fs.writeFileSync(updateStatePath(), JSON.stringify(state, null, 2), 'utf8'); }
function loadPreferences() { try { return { openAtLogin: false, keepInTray: false, ...JSON.parse(fs.readFileSync(preferencesPath(), 'utf8')) }; } catch { return { openAtLogin: false, keepInTray: false }; } }
let preferences = { openAtLogin: false, keepInTray: false };

function acceptProtocolUrl(raw) {
  try {
    const parsed = new URL(raw);
    const videoUrl = parsed.searchParams.get('url');
    if (parsed.protocol !== 'ytx:' || parsed.hostname !== 'download' || !videoUrl) return;
    const target = new URL(videoUrl);
    if (!['http:', 'https:'].includes(target.protocol) || !/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(target.hostname)) return;
    pendingVideoUrl = target.href;
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); flushProtocolUrl(); }
  } catch {}
}
function protocolArgument(argv) {
  return argv.map(arg => String(arg).replace(/^['"]|['"]$/g, '')).find(arg => /^ytx:\/\//i.test(arg));
}
function flushProtocolUrl() { if (!pendingVideoUrl || !mainWindow || mainWindow.isDestroyed()) return; mainWindow.webContents.send('app:protocol-video', pendingVideoUrl); pendingVideoUrl = ''; }
if (!app.requestSingleInstanceLock()) app.quit();
else app.on('second-instance', (_event, argv) => { const url = protocolArgument(argv); if (url) acceptProtocolUrl(url); if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
if (process.platform === 'win32') { const url = protocolArgument(process.argv); if (url) acceptProtocolUrl(url); }
app.on('open-url', (event, url) => { event.preventDefault(); acceptProtocolUrl(url); });

function createWindow(hidden = false) {
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'ytx-mark.png') : path.join(__dirname, 'assets', 'ytx-mark.png');
  const win = new BrowserWindow({ width: 1500, height: 960, minWidth: 1120, minHeight: 720, backgroundColor: '#0d0f12', icon: iconPath, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow = win;
  win.once('ready-to-show', () => { if (!hidden) win.show(); });
  win.webContents.on('did-finish-load', flushProtocolUrl);
  win.on('close', event => { if (preferences.keepInTray && !quitting) { event.preventDefault(); win.hide(); } });
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  win.loadFile('index.html');
  return win;
}
app.whenReady().then(() => {
  const updateState = readUpdateState(), currentVersion = app.getVersion();
  let installed = updateState.installed, installedAt = updateState.installedAt;
  if (updateState.pending && !isNewerVersion(updateState.pending.version, currentVersion)) {
    installed = updateState.pending; installedAt = new Date().toISOString();
  } else if (updateState.lastRunVersion && isNewerVersion(currentVersion, updateState.lastRunVersion)) {
    let notes = '';
    try {
      const lines = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
      const heading = lines.findIndex(line => line.startsWith(`## ${currentVersion}`));
      if (heading >= 0) { const next = lines.findIndex((line, i) => i > heading && line.startsWith('## ')); notes = lines.slice(heading + 1, next < 0 ? undefined : next).join('\n').trim(); }
    } catch {}
    installed = { version: currentVersion, notes, name: `YTX ${currentVersion}` }; installedAt = new Date().toISOString();
  }
  writeUpdateState({ installed, installedAt, lastRunVersion: currentVersion });
  preferences = loadPreferences();
  app.setAsDefaultProtocolClient('ytx');
  createTray();
  globalShortcut.register('Control+Alt+Y', () => { if (!mainWindow) createWindow(); else { mainWindow.show(); mainWindow.focus(); } });
  startAdobeBridge().catch(error => console.error('Adobe bridge server failed:', error));
  createWindow(process.argv.includes('--hidden'));
  ensureBackend().catch(error => console.error('Python bridge failed to start:', error.message));
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(false); });
});
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); if (backendProcess && !backendProcess.killed) backendProcess.kill(); if (adobeBridgeServer) adobeBridgeServer.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !preferences.keepInTray) app.quit(); });

function createTray() {
  if (tray) return;
  const candidates = app.isPackaged ? [path.join(process.resourcesPath, 'ytx.ico'), path.join(process.resourcesPath, 'ytx-mark.png')] : [path.join(__dirname, 'build', 'ytx.ico'), path.join(__dirname, 'assets', 'ytx-mark.png')];
  const icon = candidates.map(file => nativeImage.createFromPath(file)).find(candidate => !candidate.isEmpty());
  if (!icon) { console.error('YTX tray icon could not be loaded from:', candidates); return; }
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('YTX Studio · Ctrl+Alt+Y to open');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open YTX Studio', click: () => { if (!mainWindow) createWindow(); else { mainWindow.show(); mainWindow.focus(); } } },
    { label: 'Open browser extension folder', click: () => shell.openPath(browserExtensionPath()) },
    { type: 'separator' }, { label: 'Quit YTX', click: () => app.quit() }
  ]));
  tray.on('click', () => { if (!mainWindow) createWindow(); else { mainWindow.show(); mainWindow.focus(); } });
}
function browserExtensionPath() {
  const installed = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'YTX', 'browser-extension');
  return fs.existsSync(installed) ? installed : (app.isPackaged ? path.join(process.resourcesPath, 'browser-extension') : path.join(__dirname, 'build', 'resources', 'browser-extension'));
}

ipcMain.handle('media:status', async () => backendRequest('GET', '/health'));
ipcMain.handle('media:resolve', async (_event, url) => backendRequest('POST', '/resolve', { url }));
ipcMain.handle('media:export', async (_event, opts) => {
  const ext = String(opts.format || (opts.audio ? 'mp3' : 'mp4')).replace(/^\./, '');
  const result = await dialog.showSaveDialog({ title: 'Export media', defaultPath: opts.filename.replace(/\.[^.]+$/, '') + '.' + ext, filters: [{ name: `${ext.toUpperCase()} media`, extensions: [ext] }] });
  if (result.canceled) return { canceled: true };
  return backendRequest('POST', '/export', { source: opts.input, target: result.filePath, start: opts.start, end: opts.end, kind: opts.audio ? 'audio' : 'video', videoQuality: opts.videoQuality, audioQuality: opts.audioQuality, videoCodec: opts.videoCodec, audioCodec: opts.audioCodec, colorProfile: opts.colorProfile });
});
ipcMain.handle('media:convert-batch', async (_event, options) => {
  const files = await dialog.showOpenDialog({ title: 'Choose files to convert', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media files', extensions: ['mp4','mov','mkv','webm','avi','m4v','ts','mp3','m4a','wav','flac','ogg','opus'] }] });
  if (files.canceled || !files.filePaths.length) return { canceled: true };
  const folder = await dialog.showOpenDialog({ title: 'Choose output folder', properties: ['openDirectory', 'createDirectory'] });
  if (folder.canceled || !folder.filePaths.length) return { canceled: true };
  const started = await backendRequest('POST', '/convert/start', { ...options, files: files.filePaths, outputDir: folder.filePaths[0] });
  if (started.error) return started;
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 350));
    const job = await backendRequest('GET', `/jobs/${started.id}`);
    if (job.error) return job;
    sendTaskProgress({ id: started.id, type: 'convert', progress: job.percent || 0, message: job.message || 'Converting media…', currentFile: job.currentFile || 0, totalFiles: job.totalFiles || files.filePaths.length, done: Boolean(job.done), error: job.error || '', files: job.done ? (job.files || []) : [] });
    if (job.done) return job.error ? { error: job.error, files: job.files || [] } : { files: job.files || [] };
  }
});
ipcMain.handle('media:download-section', async (_event, opts) => {
  const extension = opts.format || (opts.audio ? (opts.extension || 'mp3') : 'mp4');
  const base = `${opts.title || 'video'}-trim.${extension}`.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  const result = await dialog.showSaveDialog({ title: 'Save selected range', defaultPath: base, filters: [{ name: `${extension.toUpperCase()} media`, extensions: [extension] }] });
  if (result.canceled) return { canceled: true };
  const started = await backendRequest('POST', '/download/start', { url: opts.url, target: result.filePath, start: opts.start, end: opts.end, kind: opts.audio ? 'audio' : 'video', videoFormat: opts.videoFormat, audioFormat: opts.audioFormat, format: extension, videoCodec: opts.videoCodec, audioCodec: opts.audioCodec, colorProfile: opts.colorProfile, videoQuality: opts.videoQuality, audioQuality: opts.audioQuality });
  if (started.error) return started;
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const job = await backendRequest('GET', `/jobs/${started.id}`);
    if (job.error) return job;
    sendTaskProgress({ id: started.id, type: 'download', progress: Math.round(job.percent || 0), downloaded: job.downloaded || 0, total: job.total || 0, speed: job.speed || 0, eta: job.eta, message: job.filename ? `Downloading ${job.filename}` : (job.status || 'Preparing download…'), done: Boolean(job.done), error: job.result && job.result.error || '', path: job.done && job.result ? job.result.path : '' });
    if (job.done) return job.result || { error: 'Download failed.' };
  }
});
ipcMain.handle('media:open', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }] });
  return result.canceled ? null : { path: result.filePaths[0], url: pathToFileURL(result.filePaths[0]).href };
});
ipcMain.handle('media:reveal-file', async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return { error: 'That file is no longer available.' };
  shell.showItemInFolder(filePath);
  return { ok: true };
});
ipcMain.handle('app:get-changelog', () => {
  try { return fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8'); }
  catch { return '# YTX Studio\n\nChangelog is unavailable.'; }
});
ipcMain.handle('app:check-updates', async () => checkForUpdates());
ipcMain.handle('app:download-update', async (_event, asset) => downloadReleaseAsset(asset));
ipcMain.handle('app:open-installer', async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return { error: 'Installer file not found.' };
  return { error: await shell.openPath(filePath) };
});
ipcMain.handle('app:open-release', async (_event, rawUrl) => {
  try { const url = new URL(rawUrl); if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(`/${GITHUB_REPOSITORY}/releases`)) return { error: 'Invalid GitHub release URL.' }; await shell.openExternal(url.href); return { ok: true }; }
  catch (error) { return { error: error.message }; }
});
ipcMain.handle('media:adobe-status', async () => ({
  premiere: { ...bridgeAppStatus('premiere'), running: await isProcessRunning('Adobe Premiere Pro.exe') },
  aftereffects: { ...bridgeAppStatus('aftereffects'), running: await isProcessRunning('AfterFX.exe') }
}));
ipcMain.handle('media:import-adobe', async (_event, opts) => queueAdobeImport(opts.target, opts.path));
ipcMain.handle('media:project-media', async (_event, target) => getProjectMedia(target));
ipcMain.handle('media:open-browser-extension', async () => ({ path: browserExtensionPath(), error: await shell.openPath(browserExtensionPath()) }));
ipcMain.handle('app:preferences', async (_event, next) => {
  preferences = { openAtLogin: Boolean(next.openAtLogin), keepInTray: Boolean(next.keepInTray) };
  fs.mkdirSync(path.dirname(preferencesPath()), { recursive: true });
  fs.writeFileSync(preferencesPath(), JSON.stringify(preferences, null, 2), 'utf8');
  app.setLoginItemSettings({ openAtLogin: preferences.openAtLogin, args: preferences.openAtLogin ? ['--hidden'] : [] });
  return preferences;
});
ipcMain.handle('app:get-preferences', () => preferences);
ipcMain.handle('app:system-scan', async () => scanSystem());
ipcMain.on('media:start-native-drag', (event, filePath) => {
  const resolved = path.resolve(String(filePath || ''));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return;
  const iconFile = app.isPackaged ? path.join(process.resourcesPath, 'ytx-mark.png') : path.join(__dirname, 'assets', 'ytx-mark.png');
  event.sender.startDrag({ file: resolved, icon: iconFile });
});
ipcMain.handle('app:system-status', async () => {
  const python = findPython();
  const pythonAvailable = app.isPackaged ? fs.existsSync(python.command) : await new Promise(resolve => {
    const child = spawn(python.command, [...python.prefixArgs, '--version'], { windowsHide: true, stdio: 'ignore' });
    child.once('error', () => resolve(false)); child.once('close', code => resolve(code === 0));
  });
  const ffmpeg = findFfmpeg();
  let health = {};
  try { health = await backendRequest('GET', '/health'); } catch {}
  return { python: pythonAvailable, ffmpeg: Boolean(ffmpeg && fs.existsSync(ffmpeg)) && Boolean(health.ffmpeg), backend: Boolean(health.ok), adobeBridge: Boolean(adobeBridgePort), ytDlp: Boolean(health.ytDlp), version: app.getVersion() };
});

function scanSystem() {
  const env = process.env;
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA, env.APPDATA].filter(Boolean);
  const candidates = [
    { name: 'Adobe Premiere Pro', paths: roots.flatMap(root => [path.join(root, 'Adobe', 'Adobe Premiere Pro 2026', 'Adobe Premiere Pro.exe'), path.join(root, 'Adobe', 'Adobe Premiere Pro 2025', 'Adobe Premiere Pro.exe'), path.join(root, 'Adobe', 'Adobe Premiere Pro 2024', 'Adobe Premiere Pro.exe')]) },
    { name: 'Adobe After Effects', paths: roots.flatMap(root => [path.join(root, 'Adobe', 'Adobe After Effects 2026', 'Support Files', 'AfterFX.exe'), path.join(root, 'Adobe', 'Adobe After Effects 2025', 'Support Files', 'AfterFX.exe'), path.join(root, 'Adobe', 'Adobe After Effects 2024', 'Support Files', 'AfterFX.exe')]) },
    { name: 'Google Chrome', paths: roots.flatMap(root => [path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(root, 'Google', 'Chrome SxS', 'Application', 'chrome.exe')]) },
    { name: 'Microsoft Edge', paths: roots.map(root => path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')) },
    { name: 'Mozilla Firefox', paths: roots.map(root => path.join(root, 'Mozilla Firefox', 'firefox.exe')) },
    { name: 'Brave', paths: roots.map(root => path.join(root, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')) },
  ];
  const apps = candidates.map(item => ({ name: item.name, installed: item.paths.find(fs.existsSync) || '' }));
  const totalMemory = os.totalmem();
  return { apps, cpu: os.cpus()[0]?.model || 'Unknown CPU', cores: os.cpus().length, memoryGb: +(totalMemory / 1073741824).toFixed(1), freeMemoryGb: +(os.freemem() / 1073741824).toFixed(1), arch: os.arch(), platform: os.platform(), sequentialConversion: true };
}

function sendTaskProgress(task) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task:progress', task);
}

function versionParts(value) { return String(value || '').replace(/^v/i, '').split(/[.+-]/).map(part => Number(part) || 0); }
function isNewerVersion(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return false;
}
async function checkForUpdates() {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'YTX-Studio-Updater' } });
    if (response.status === 404) return { ok: true, currentVersion: app.getVersion(), available: false, message: 'No GitHub release is published yet.' };
    if (!response.ok) return { error: `GitHub update check failed (${response.status}).` };
    const release = await response.json();
    const asset = (release.assets || []).find(item => /^YTX-Setup-.*\.exe$/i.test(item.name));
    const state = readUpdateState(), latestVersion = release.tag_name || '';
    const installed = state.installed && state.installed.version === latestVersion ? state.installed : null;
    return { ok: true, currentVersion: app.getVersion(), latestVersion, updated: Boolean(installed), message: installed ? `Successfully installed on ${new Date(state.installedAt || Date.now()).toLocaleString()}.` : '', available: !installed && isNewerVersion(latestVersion, app.getVersion()), name: release.name || latestVersion || 'YTX update', notes: release.body || 'No release notes provided.', url: release.html_url || `https://github.com/${GITHUB_REPOSITORY}/releases`, asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url, digest: asset.digest || '' } : null, publishedAt: release.published_at || '' };
  } catch (error) { return { error: `Could not reach GitHub: ${error.message}` }; }
}
async function downloadReleaseAsset(asset) {
  const expectedPrefix = `https://github.com/${GITHUB_REPOSITORY}/releases/download/`;
  if (!asset || !asset.url || !asset.url.startsWith(expectedPrefix) || !/^YTX-Setup-.*\.exe$/i.test(asset.name || '')) return { error: 'The release installer URL is invalid.' };
  const id = `update-${Date.now()}`, filePath = path.join(app.getPath('downloads'), path.basename(asset.name));
  try {
    const response = await fetch(asset.url, { headers: { 'User-Agent': 'YTX-Studio-Updater' }, redirect: 'follow' });
    if (!response.ok || !response.body) return { error: `Installer download failed (${response.status}).` };
    const total = Number(response.headers.get('content-length')) || Number(asset.size) || 0;
    let downloaded = 0;
    const hash = crypto.createHash('sha256');
    const tracker = new Transform({ transform(chunk, _encoding, callback) { downloaded += chunk.length; hash.update(chunk); sendTaskProgress({ id, type: 'update', progress: total ? Math.floor(downloaded / total * 100) : 0, downloaded, total, message: `Downloading ${asset.name}`, done: false }); callback(null, chunk); } });
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(Readable.fromWeb(response.body), tracker, fs.createWriteStream(filePath));
    if (asset.digest && asset.digest.startsWith('sha256:') && hash.digest('hex').toLowerCase() !== asset.digest.slice(7).toLowerCase()) { await fs.promises.rm(filePath, { force: true }); return { error: 'The installer checksum did not match GitHub release metadata; the file was removed.' }; }
    sendTaskProgress({ id, type: 'update', progress: 100, downloaded, total: total || downloaded, message: `Downloaded ${asset.name}`, done: true, path: filePath });
    if (process.platform !== 'win32') return { path: filePath, installing: false };
    const version = String(asset.latestVersion || '').replace(/^v/i, '');
    if (!version) return { path: filePath, installing: false };
    writeUpdateState({ ...readUpdateState(), pending: { version, notes: asset.notes || '', name: asset.name } });
    const installer = spawn(filePath, [], { detached: true, stdio: 'ignore', windowsHide: false });
    installer.once('error', error => { const state = readUpdateState(); delete state.pending; writeUpdateState(state); console.error('Unable to launch YTX installer:', error); });
    installer.unref();
    setTimeout(() => app.quit(), 500);
    return { path: filePath, installing: true };
  } catch (error) { sendTaskProgress({ id, type: 'update', progress: 0, message: `Could not download ${asset.name}`, done: true, error: error.message }); return { error: error.message }; }
}

function bridgeAppStatus(target) {
  const heartbeat = adobeHeartbeats.get(target);
  return { connected: Boolean(heartbeat && Date.now() - heartbeat.at < 4500), app: heartbeat ? heartbeat.host : '', project: heartbeat ? heartbeat.project : '', projectPath: heartbeat ? heartbeat.projectPath : '', lastSeen: heartbeat ? heartbeat.at : 0 };
}

function isProcessRunning(imageName) {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise(resolve => {
    const child = spawn('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.once('error', () => resolve(false));
    child.once('close', code => resolve(code === 0 && output.toLowerCase().includes(imageName.toLowerCase())));
  });
}

function startAdobeBridge() {
  if (adobeBridgeServer) return Promise.resolve();
  const sendJson = (res, value, status = 200) => {
    const body = Buffer.from(JSON.stringify(value));
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-YTX-Token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return sendJson(res, {});
    const parsed = new URL(req.url, 'http://127.0.0.1');
    if (parsed.pathname === '/bridge/health') return sendJson(res, { ok: true });
    if (req.headers['x-ytx-token'] !== adobeBridgeToken) return sendJson(res, { error: 'Unauthorized YTX bridge request.' }, 401);
      if (req.method === 'GET' && parsed.pathname === '/bridge/status') return sendJson(res, { premiere: bridgeAppStatus('premiere'), aftereffects: bridgeAppStatus('aftereffects') });
      if (req.method === 'GET' && parsed.pathname === '/bridge/project-media') {
        const target = parsed.searchParams.get('app');
        const status = bridgeAppStatus(target);
        return sendJson(res, status.connected ? listProjectMedia(status.projectPath) : { error: 'Open the YTX Bridge panel in a saved Adobe project first.' });
      }
    if (req.method === 'GET' && parsed.pathname === '/bridge/next') {
      const target = parsed.searchParams.get('app');
      if (!adobeCommands[target]) return sendJson(res, { error: 'Unsupported Adobe host.' }, 400);
      return sendJson(res, adobeCommands[target].shift() || {});
    }
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 200000) req.destroy(); });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return sendJson(res, { error: 'Invalid JSON.' }, 400); }
      const target = body.app;
      if (!['premiere', 'aftereffects'].includes(target)) return sendJson(res, { error: 'Unknown Adobe host.' }, 400);
      if (req.method === 'POST' && parsed.pathname === '/bridge/heartbeat') {
        adobeHeartbeats.set(target, { at: Date.now(), host: String(body.host || target), project: String(body.project || ''), projectPath: String(body.projectPath || '') });
        return sendJson(res, { connected: true });
      }
      if (req.method === 'POST' && parsed.pathname === '/bridge/complete') {
        const waiter = adobeWaiters.get(body.id);
        if (waiter) { clearTimeout(waiter.timer); adobeWaiters.delete(body.id); waiter.resolve(body); }
        return sendJson(res, { ok: true });
      }
      if (req.method === 'POST' && parsed.pathname === '/bridge/handoff') {
        const filePath = path.resolve(String(body.path || ''));
        if (!fs.existsSync(filePath)) return sendJson(res, { error: 'The selected Adobe media file could not be found.' }, 404);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('adobe:handoff', { path: filePath, url: pathToFileURL(filePath).href, source: target });
        return sendJson(res, { ok: true });
      }
      return sendJson(res, { error: 'Not found.' }, 404);
    });
  });
  adobeBridgeServer = server;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      adobeBridgePort = server.address().port;
      // Keep settings beside the installed CEP panel so every Adobe host can
      // read the same live port/token without depending on CEP's host-specific userData path.
      const configDir = path.join(app.getPath('appData'), 'Adobe', 'CEP', 'extensions', 'YTX-Bridge');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'bridge.json'), JSON.stringify({ port: adobeBridgePort, token: adobeBridgeToken }), 'utf8');
      resolve();
    });
  });
}

async function queueAdobeImport(target, mediaPath) {
  if (!['premiere', 'aftereffects'].includes(target)) return { error: 'Choose Premiere Pro or After Effects.' };
  const source = path.resolve(mediaPath || '');
  if (!fs.existsSync(source)) return { error: 'The exported media file could not be found.' };
  if (!bridgeAppStatus(target).connected) return { error: target === 'premiere' ? 'Premiere bridge is offline. Restart Premiere and open Window → Extensions (Legacy) → YTX Bridge.' : 'After Effects bridge is offline. Restart After Effects and open Window → Extensions (Legacy) → YTX Bridge.' };
  const status = bridgeAppStatus(target);
  const projectPath = String(status.projectPath || '');
  if (!projectPath || !fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) return { error: 'Save the Adobe project before importing. YTX stores managed media inside the project folder.' };
  let managed;
  try { managed = copyProjectAsset(source, projectPath, target); }
  catch (error) { return { error: `Could not place media in the project folder: ${error.message}` }; }
  const id = crypto.randomUUID();
  const request = { id, path: managed.path, operation: 'import-to-timeline' };
  adobeCommands[target].push(request);
  sendTaskProgress({ id, type: 'import', target, progress: 12, message: 'Waiting for the active Adobe timeline…' });
  const response = await new Promise(resolve => {
    const timer = setTimeout(() => { adobeWaiters.delete(id); resolve({ ok: false, message: 'Adobe did not respond to the import request. Keep YTX Bridge panel open and retry.' }); }, 30000);
    adobeWaiters.set(id, { resolve, timer });
  });
  sendTaskProgress({ id, type: 'import', target, progress: 100, message: response.message || (response.ok ? 'Imported into timeline.' : 'Import failed.'), done: true, error: response.ok ? '' : response.message });
  return response.ok ? { ok: true, message: response.message, path: managed.path } : { error: response.message };
}

function copyProjectAsset(source, projectDir, target) {
  const folder = path.join(projectDir, 'YTX Media');
  fs.mkdirSync(folder, { recursive: true });
  const base = path.basename(source);
  let destination = path.join(folder, base);
  if (fs.existsSync(destination)) destination = path.join(folder, `${path.parse(base).name}-${Date.now()}${path.extname(base)}`);
  fs.copyFileSync(source, destination);
  const metadataPath = path.join(folder, '.ytx-media.json');
  let metadata = { version: 1, host: target, assets: [] };
  try { metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')); } catch {}
  metadata.version = 1; metadata.host = target;
  metadata.assets = (metadata.assets || []).filter(item => fs.existsSync(path.join(folder, item.file)));
  metadata.assets.push({ file: path.basename(destination), originalPath: source, importedAt: new Date().toISOString(), size: fs.statSync(destination).size });
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  if (process.platform === 'win32') spawn('attrib.exe', ['+h', metadataPath], { windowsHide: true, stdio: 'ignore' });
  return { path: destination };
}

function listProjectMedia(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) return { items: [] };
  const folder = path.join(projectDir, 'YTX Media');
  if (!fs.existsSync(folder)) return { items: [], folder };
  let metadata = {};
  const metadataPath = path.join(folder, '.ytx-media.json');
  try { metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')); } catch {}
  const items = (metadata.assets || []).map(item => {
    const filePath = path.join(folder, item.file);
    try { const stat = fs.statSync(filePath); return { name: item.file, path: filePath, size: stat.size, importedAt: item.importedAt }; } catch { return null; }
  }).filter(Boolean);
  if (items.length !== (metadata.assets || []).length) {
    metadata.assets = items.map(item => ({ file: item.name, importedAt: item.importedAt, size: item.size }));
    try { fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8'); if (process.platform === 'win32') spawn('attrib.exe', ['+h', metadataPath], { windowsHide: true, stdio: 'ignore' }); } catch {}
  }
  return { items, folder };
}
async function getProjectMedia(target) {
  const status = bridgeAppStatus(target || 'premiere').connected ? bridgeAppStatus(target || 'premiere') : bridgeAppStatus('aftereffects');
  if (!status.connected) return { items: [], error: 'Open a saved Adobe project and the YTX Bridge panel to see its media.' };
  return listProjectMedia(status.projectPath);
}

async function ensureBackend() {
  if (backendProcess && backendPort) return;
  if (backendStartup) return backendStartup;
  backendStartup = new Promise((resolve, reject) => {
    const python = findPython();
    backendPort = null;
    const backendPath = app.isPackaged ? path.join(process.resourcesPath, 'backend.py') : path.join(__dirname, 'backend.py');
    backendProcess = spawn(python.command, [...python.prefixArgs, backendPath, '--server'], { windowsHide: true, env: { ...process.env, CLIPFORGE_FFMPEG: findFfmpeg() || '' } });
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Python bridge did not start within 15 seconds.')), 15000);
    backendProcess.stdout.on('data', chunk => {
      output += chunk.toString();
      const lines = output.split(/\r?\n/);
      output = lines.pop();
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.ready && message.port) {
            backendPort = message.port;
            clearTimeout(timeout);
            resolve();
          }
        } catch {}
      }
    });
    backendProcess.stderr.on('data', chunk => console.error('[Python bridge]', chunk.toString().trim()));
    backendProcess.on('error', error => { clearTimeout(timeout); backendStartup = null; reject(new Error(`Could not start Python: ${error.message}. Install Python 3 and yt-dlp.`)); });
    backendProcess.on('close', code => {
      const wasReady = Boolean(backendPort);
      backendPort = null;
      backendProcess = null;
      backendStartup = null;
      if (!wasReady) { clearTimeout(timeout); reject(new Error(`Python bridge exited during startup (code ${code}).`)); }
    });
  });
  try { await backendStartup; } finally { backendStartup = null; }
}

async function backendRequest(method, route, body) {
  try {
    await ensureBackend();
    const response = await fetch(`http://127.0.0.1:${backendPort}${route}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    return await response.json();
  } catch (error) {
    return { error: `Python bridge unavailable: ${error.message}` };
  }
}

function findPython() {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'python-venv', 'Scripts', 'python.exe');
    const userFallback = path.join(process.env.LOCALAPPDATA || '', 'YTX', 'python-venv', 'Scripts', 'python.exe');
    return { command: fs.existsSync(bundled) ? bundled : userFallback, prefixArgs: [] };
  }
  if (process.platform !== 'win32') return { command: 'python3', prefixArgs: [] };
  if (process.env.CLIPFORGE_PYTHON) return { command: process.env.CLIPFORGE_PYTHON, prefixArgs: [] };
  for (const root of [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python'), path.join(process.env.ProgramFiles || '', 'Python')]) {
    try {
      const folders = fs.readdirSync(root).filter(name => /^Python\d+/i.test(name)).sort().reverse();
      for (const folder of folders) {
        const executable = path.join(root, folder, 'python.exe');
        if (fs.existsSync(executable)) return { command: executable, prefixArgs: [] };
      }
    } catch {}
  }
  return { command: 'py', prefixArgs: ['-3'] };
}

function findFfmpeg() {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
    return fs.existsSync(bundled) ? bundled : null;
  }
  if (process.env.CLIPFORGE_FFMPEG) return process.env.CLIPFORGE_FFMPEG;
  try { return require('ffmpeg-static'); } catch { return null; }
}

