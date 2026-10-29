const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, globalShortcut, shell, nativeImage, screen } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const http = require('node:http');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform, Readable } = require('node:stream');
const { createIntegrationManager } = require('./integrations');

const GITHUB_REPOSITORY = 'pixelstoLogic/YTX';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
const GITHUB_RELEASES = `https://github.com/${GITHUB_REPOSITORY}/releases`;
const MEDIA_EXTENSIONS = {
  video: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'ts', 'mts', 'm2ts', 'mpg', 'mpeg', 'mxf', 'wmv', 'flv', '3gp', 'ogv'],
  audio: ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'ac3', 'wma', 'aiff', 'aif'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'tga']
};
const MEDIA_FILTER_EXTENSIONS = [...new Set(Object.values(MEDIA_EXTENSIONS).flat())];

let activeConversion = null;

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
const adobeBridgeTokenCreatedAt = Date.now();
const adobeHeartbeats = new Map();
const adobeCommands = { premiere: [], aftereffects: [] };
const adobeWaiters = new Map();
const preferencesPath = () => path.join(app.getPath('userData'), 'preferences.json');
const updateStatePath = () => path.join(app.getPath('userData'), 'update-state.json');
let integrations = null;
function integrationManager() {
  if (!integrations) {
    integrations = createIntegrationManager({
      resourcesRoot: app.isPackaged ? process.resourcesPath : path.join(__dirname, 'build', 'resources'),
      appData: app.getPath('appData'),
      localAppData: process.env.LOCALAPPDATA || app.getPath('appData'),
      appVersion: app.getVersion()
    });
  }
  return integrations;
}
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
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(720, Math.min(1500, workArea.width - 32));
  const height = Math.max(560, Math.min(960, workArea.height - 48));
  const win = new BrowserWindow({ width, height, minWidth: 720, minHeight: 560, backgroundColor: '#0d0f12', icon: iconPath, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
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
  integrationManager().startExtensionServer().catch(error => console.error('Browser extension service failed:', error.message));
  ensureAdobeBridgeOnStartup().catch(error => console.error('Adobe bridge repair failed:', error.message));
  createWindow(process.argv.includes('--hidden'));
  ensureBackend().catch(error => console.error('Python bridge failed to start:', error.message));
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(false); });
});
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); if (backendProcess && !backendProcess.killed) backendProcess.kill(); if (adobeBridgeServer) adobeBridgeServer.close(); try { integrationManager().stopExtensionServer(); } catch {} });
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
ipcMain.handle('media:pick-files', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Add media to the conversion queue',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video, audio, and image media', extensions: MEDIA_FILTER_EXTENSIONS }]
  });
  if (result.canceled) return { canceled: true, files: [] };
  return { files: result.filePaths.map(describeMediaFile).filter(Boolean) };
});
ipcMain.handle('media:describe-files', async (_event, filePaths) => {
  const files = Array.isArray(filePaths) ? filePaths.slice(0, 200) : [];
  return { files: files.map(describeMediaFile).filter(Boolean) };
});
ipcMain.handle('media:choose-output-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose a destination folder',
    defaultPath: path.join(app.getPath('downloads'), 'YTX Exports'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { path: result.filePaths[0] };
});
ipcMain.handle('media:default-output', async () => {
  const folder = path.join(app.getPath('downloads'), 'YTX Exports');
  fs.mkdirSync(folder, { recursive: true });
  return { path: folder };
});
ipcMain.handle('media:convert', async (_event, options) => {
  const files = Array.isArray(options?.files) ? options.files : [];
  if (!files.length) return { error: 'Add at least one media file to the queue.' };
  const outputDir = options.outputDir || path.join(app.getPath('downloads'), 'YTX Exports');
  fs.mkdirSync(outputDir, { recursive: true });
  const profile = performanceProfile();
  const payload = {
    files: files.map(file => ({ path: file.path, format: file.format })),
    outputDir,
    mode: options.mode === 'compress' ? 'compress' : 'convert',
    compression: options.mode === 'compress' ? (options.compression || profile.recommendedCompression) : '',
    videoCodec: options.videoCodec || 'h264',
    audioCodec: options.audioCodec || 'aac',
    colorProfile: options.colorProfile || 'preserve',
    videoQuality: options.videoQuality || 20,
    audioQuality: options.audioQuality || 192,
    workers: profile.workers,
    threads: profile.threads
  };
  const started = await backendRequest('POST', '/convert/start', payload);
  if (started.error) return started;
  activeConversion = { id: started.id, canceled: false, startedAt: Date.now() };
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 350));
    const job = await backendRequest('GET', `/jobs/${started.id}`);
    if (job.error && !job.id) {
      activeConversion = null;
      return job;
    }
    const jobFiles = (job.files || []).map(file => ({
      name: file.name,
      source: file.source,
      format: file.format,
      kind: file.kind,
      status: file.status,
      progress: file.progress || 0,
      error: file.error || '',
      path: file.output || ''
    }));
    const done = Boolean(job.done);
    sendTaskProgress({
      id: started.id,
      type: 'convert',
      progress: job.percent || 0,
      message: job.message || 'Converting media…',
      workers: job.workers || profile.workers,
      threads: job.threads || profile.threads,
      currentFile: (job.files || []).findIndex(file => file.status === 'converting') + 1,
      totalFiles: files.length,
      fileProgress: jobFiles,
      files: done ? (job.results || []).filter(file => file.path) : [],
      done,
      cancelled: job.status === 'cancelled',
      error: job.error || '',
      status: job.status || ''
    });
    if (done) {
      activeConversion = null;
      return {
        id: started.id,
        status: job.status,
        canceled: job.status === 'cancelled',
        files: job.results || [],
        error: job.error || '',
        workers: job.workers,
        threads: job.threads
      };
    }
  }
});
ipcMain.handle('media:cancel-convert', async () => {
  if (!activeConversion) return { error: 'No conversion is running.' };
  const result = await backendRequest('POST', `/jobs/${activeConversion.id}/cancel`, {});
  if (result.ok) activeConversion.canceled = true;
  return result;
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
ipcMain.handle('app:list-releases', async () => listReleases());
ipcMain.handle('app:download-update', async (_event, request) => downloadReleaseAsset(request));
ipcMain.handle('app:download-release', async (_event, request) => downloadReleaseAsset(request));
ipcMain.handle('integrations:detect', async () => ({ browsers: integrationManager().detectBrowsers(), adobe: integrationManager().detectAdobeHosts() }));
ipcMain.handle('integrations:status', async () => ({ browsers: integrationManager().getBrowserExtensionStatus(), adobe: integrationManager().getAdobeBridgeStatus() }));
ipcMain.handle('integrations:install-browser-extension', async (_event, request) => integrationManager().installBrowserExtension(request || {}));
ipcMain.handle('integrations:remove-browser-extension', async () => integrationManager().removeBrowserExtension());
ipcMain.handle('integrations:repair-adobe', async (_event, request) => {
  const manager = integrationManager();
  const result = manager.installAdobeBridge(request || {});
  if (adobeBridgePort && adobeBridgeToken) manager.writeBridgeConfig(adobeBridgePort, adobeBridgeToken);
  return result;
});
ipcMain.handle('integrations:diagnostics', async () => {
  const manager = integrationManager();
  return {
    version: app.getVersion(),
    adobeBridge: { port: adobeBridgePort, running: Boolean(adobeBridgeServer), status: { premiere: bridgeAppStatus('premiere'), aftereffects: bridgeAppStatus('aftereffects') }, ...manager.getAdobeBridgeStatus() },
    browsers: manager.getBrowserExtensionStatus()
  };
});
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
ipcMain.handle('app:performance', async () => performanceProfile());
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
  const manager = integrationManager();
  const adobe = manager.detectAdobeHosts();
  const browsers = manager.detectBrowsers();
  const firefox = roots.map(root => path.join(root, 'Mozilla Firefox', 'firefox.exe')).find(fs.existsSync) || '';
  const apps = [
    ...adobe.hosts.map(host => ({ name: host.name, installed: host.path, kind: 'adobe' })),
    ...browsers.map(browser => ({ name: browser.name, installed: browser.path, kind: 'browser', automatic: browser.automatic })),
    { name: 'Mozilla Firefox', installed: firefox, kind: 'browser', automatic: false }
  ];
  const totalMemory = os.totalmem();
  const profile = performanceProfile();
  return { apps, adobe, browsers, cpu: os.cpus()[0]?.model || 'Unknown CPU', cores: os.cpus().length, memoryGb: +(totalMemory / 1073741824).toFixed(1), freeMemoryGb: +(os.freemem() / 1073741824).toFixed(1), arch: os.arch(), platform: os.platform(), sequentialConversion: profile.workers === 1, performance: profile };
}

function sendTaskProgress(task) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task:progress', task);
}

function mediaKindFor(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  for (const [kind, extensions] of Object.entries(MEDIA_EXTENSIONS)) {
    if (extensions.includes(extension)) return kind;
  }
  return 'other';
}

function describeMediaFile(filePath) {
  try {
    const resolved = path.resolve(String(filePath || ''));
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return null;
    const kind = mediaKindFor(resolved);
    if (kind === 'other') return null;
    return {
      path: resolved,
      name: path.basename(resolved),
      extension: path.extname(resolved).slice(1).toLowerCase(),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      kind,
      url: pathToFileURL(resolved).href
    };
  } catch { return null; }
}

function performanceProfile() {
  const cpus = os.cpus();
  const cores = Array.isArray(cpus) ? cpus.length : 4;
  const totalMemoryGb = +(os.totalmem() / 1073741824).toFixed(1);
  const freeMemoryGb = +(os.freemem() / 1073741824).toFixed(1);
  let workers = 1;
  if (cores >= 12 && totalMemoryGb >= 16 && freeMemoryGb >= 6) workers = 3;
  else if (cores >= 8 && totalMemoryGb >= 12 && freeMemoryGb >= 4) workers = 2;
  if (freeMemoryGb < 2) workers = 1;
  const threads = Math.max(2, Math.min(8, Math.floor(cores / Math.max(1, workers))));
  return {
    cpu: cpus?.[0]?.model || 'System processor',
    cores,
    totalMemoryGb,
    freeMemoryGb,
    workers,
    threads,
    label: workers >= 3 ? 'High throughput' : workers === 2 ? 'Balanced' : 'Low impact',
    recommendedCompression: cores >= 8 && totalMemoryGb >= 12 ? 'balanced' : 'light'
  };
}


function versionParts(value) { return String(value || '').replace(/^v/i, '').split(/[.+-]/).map(part => Number(part) || 0); }
function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0) ? 1 : -1;
  }
  return 0;
}
function isNewerVersion(candidate, current) { return compareVersions(candidate, current) > 0; }

let releaseCache = { at: 0, releases: [] };
function normalizeRelease(release) {
  return {
    version: String(release.tag_name || '').replace(/^v/i, ''),
    tag: release.tag_name || '',
    name: release.name || release.tag_name || 'YTX release',
    notes: release.body || 'No release notes were published.',
    url: release.html_url || GITHUB_RELEASES,
    publishedAt: release.published_at || '',
    draft: Boolean(release.draft),
    prerelease: Boolean(release.prerelease),
    assets: (release.assets || []).map(item => ({
      name: item.name,
      size: Number(item.size) || 0,
      url: item.browser_download_url,
      digest: item.digest || ''
    }))
  };
}
async function fetchPublicReleases(force = false) {
  if (!force && releaseCache.releases.length && Date.now() - releaseCache.at < 120000) return releaseCache.releases;
  const response = await fetch(`${GITHUB_API}/releases?per_page=50`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'YTX-Studio-Updater' } });
  if (response.status === 404) return [];
  if (response.status === 403) throw new Error('GitHub API rate limit reached. Try again later.');
  if (!response.ok) throw new Error(`GitHub release check failed (${response.status}).`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error('GitHub returned an unexpected release list.');
  const releases = payload
    .map(normalizeRelease)
    .filter(release => !release.draft && !release.prerelease && /^\d+(\.\d+){1,3}$/.test(release.version))
    .sort((a, b) => compareVersions(b.version, a.version));
  releaseCache = { at: Date.now(), releases };
  return releases;
}
function findInstallerAsset(release, version = release.version) {
  // The asset name must exactly match the tag version. A release whose asset
  // name points at a different version must never be offered as an update.
  const exactName = `YTX-Setup-${version}.exe`.toLowerCase();
  return release.assets.find(item => item.name.toLowerCase() === exactName) || null;
}
function releaseSummary(release, currentVersion) {
  const asset = findInstallerAsset(release);
  return {
    version: release.version,
    tag: release.tag,
    name: release.name,
    notes: release.notes,
    url: release.url,
    publishedAt: release.publishedAt,
    available: isNewerVersion(release.version, currentVersion),
    current: compareVersions(release.version, currentVersion) === 0,
    asset: asset ? { name: asset.name, size: asset.size, url: asset.url, digest: asset.digest } : null
  };
}
async function listReleases() {
  try {
    const releases = await fetchPublicReleases();
    return {
      ok: true,
      currentVersion: app.getVersion(),
      latestVersion: releases[0]?.version || '',
      releases: releases.slice(0, 25).map(release => releaseSummary(release, app.getVersion()))
    };
  } catch (error) { return { error: `Could not reach GitHub: ${error.message}` }; }
}
async function checkForUpdates() {
  try {
    const releases = await fetchPublicReleases();
    if (!releases.length) return { ok: true, currentVersion: app.getVersion(), available: false, releases: [], message: 'No GitHub release is published yet.' };
    const latest = releases[0];
    const state = readUpdateState();
    const installed = state.installed && compareVersions(state.installed.version, latest.version) === 0 ? state.installed : null;
    const summary = releaseSummary(latest, app.getVersion());
    return {
      ok: true,
      currentVersion: app.getVersion(),
      latestVersion: latest.version,
      latestTag: latest.tag,
      updated: Boolean(installed),
      message: installed ? `Successfully installed on ${new Date(state.installedAt || Date.now()).toLocaleString()}.` : '',
      available: summary.available,
      name: latest.name,
      notes: latest.notes,
      url: latest.url,
      asset: summary.asset,
      publishedAt: latest.publishedAt,
      releases: releases.slice(0, 25).map(release => releaseSummary(release, app.getVersion()))
    };
  } catch (error) { return { error: `Could not reach GitHub: ${error.message}` }; }
}
function uniqueDownloadPath(folder, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(folder, fileName);
  for (let index = 1; fs.existsSync(candidate); index++) candidate = path.join(folder, `${parsed.name} (${index})${parsed.ext}`);
  return candidate;
}
async function downloadReleaseAsset(request = {}) {
  const requestedVersion = String(request.version || request.latestVersion || '').replace(/^v/i, '');
  let id = `update-${Date.now()}`;
  try {
    const releases = await fetchPublicReleases(true);
    if (!releases.length) return { error: 'No YTX release is published on GitHub yet.' };
    const release = requestedVersion
      ? releases.find(item => compareVersions(item.version, requestedVersion) === 0)
      : releases[0];
    if (!release) return { error: `YTX ${requestedVersion} was not found among the published releases.` };
    const asset = findInstallerAsset(release, release.version);
    if (!asset) return { error: `YTX ${release.version} does not include a Windows installer asset.` };
    const expectedPrefix = `https://github.com/${GITHUB_REPOSITORY}/releases/download/`;
    if (!asset.url || !asset.url.startsWith(expectedPrefix) || !/^YTX-Setup-.*\.exe$/i.test(asset.name)) return { error: 'The release installer URL is invalid.' };

    const filePath = uniqueDownloadPath(app.getPath('downloads'), path.basename(asset.name));
    id = `update-${release.version}-${Date.now()}`;
    const response = await fetch(asset.url, { headers: { 'User-Agent': 'YTX-Studio-Updater' }, redirect: 'follow' });
    if (!response.ok || !response.body) return { error: `Installer download failed (${response.status}).` };
    const finalUrl = new URL(response.url);
    if (!/(^|\.)github\.com$|(^|\.)githubusercontent\.com$/i.test(finalUrl.hostname)) return { error: 'The installer download was redirected to an unexpected host.' };
    const total = Number(response.headers.get('content-length')) || Number(asset.size) || 0;
    let downloaded = 0;
    const hash = crypto.createHash('sha256');
    const tracker = new Transform({ transform(chunk, _encoding, callback) { downloaded += chunk.length; hash.update(chunk); sendTaskProgress({ id, type: 'update', progress: total ? Math.floor(downloaded / total * 100) : 0, downloaded, total, message: `Downloading YTX ${release.version}`, done: false }); callback(null, chunk); } });
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(Readable.fromWeb(response.body), tracker, fs.createWriteStream(filePath));
    const actualDigest = hash.digest('hex').toLowerCase();
    let digestVerified = false;
    if (asset.digest && asset.digest.startsWith('sha256:')) {
      digestVerified = actualDigest === asset.digest.slice(7).toLowerCase();
      if (!digestVerified) { await fs.promises.rm(filePath, { force: true }); return { error: 'The installer checksum did not match GitHub release metadata; the file was removed.' }; }
    } else {
      const sumsAsset = release.assets.find(item => /^SHA256SUMS(\.txt)?$/i.test(item.name));
      if (sumsAsset) {
        try {
          const sums = await (await fetch(sumsAsset.url, { headers: { 'User-Agent': 'YTX-Studio-Updater' }, redirect: 'follow' })).text();
          const line = sums.split(/\r?\n/).find(row => row.toLowerCase().includes(path.basename(asset.name).toLowerCase()));
          if (line) {
            digestVerified = line.trim().split(/\s+/)[0].toLowerCase() === actualDigest;
            if (!digestVerified) { await fs.promises.rm(filePath, { force: true }); return { error: 'The installer checksum did not match SHA256SUMS.txt; the file was removed.' }; }
          }
        } catch {}
      }
    }
    sendTaskProgress({ id, type: 'update', progress: 100, downloaded, total: total || downloaded, message: `Downloaded YTX ${release.version}`, done: true, path: filePath });

    const install = process.platform === 'win32' && request.install !== false;
    if (!install) return { ok: true, version: release.version, path: filePath, installing: false, digestVerified, releaseUrl: release.url };
    writeUpdateState({ ...readUpdateState(), pending: { version: release.version, notes: release.notes || '', name: asset.name } });
    const installer = spawn(filePath, [], { detached: true, stdio: 'ignore', windowsHide: false });
    installer.once('error', error => { const state = readUpdateState(); delete state.pending; writeUpdateState(state); console.error('Unable to launch YTX installer:', error); });
    installer.unref();
    sendTaskProgress({ id, type: 'update', progress: 100, message: `Starting the YTX ${release.version} installer…`, done: true, path: filePath });
    setTimeout(() => app.quit(), 700);
    return { ok: true, version: release.version, path: filePath, installing: true, digestVerified, releaseUrl: release.url };
  } catch (error) {
    sendTaskProgress({ id, type: 'update', progress: 0, message: 'Could not download the YTX installer', done: true, error: error.message });
    return { error: error.message };
  }
}

async function ensureAdobeBridgeOnStartup() {
  const manager = integrationManager();
  const detected = manager.detectAdobeHosts();
  const status = manager.getAdobeBridgeStatus();
  if (!status.installed && !status.hosts.length) return;
  const hosts = status.hosts.length
    ? status.hosts
    : (detected.hosts.length ? [...new Set(detected.hosts.map(host => host.id))] : ['premiere', 'aftereffects']);
  manager.installAdobeBridge({ hosts });
  if (adobeBridgePort && adobeBridgeToken) manager.writeBridgeConfig(adobeBridgePort, adobeBridgeToken);
}

function bridgeAppStatus(target) {
  const heartbeat = adobeHeartbeats.get(target);
  return {
    connected: Boolean(heartbeat && Date.now() - heartbeat.at < 8000),
    app: heartbeat ? heartbeat.host : '',
    project: heartbeat ? heartbeat.project : '',
    projectName: heartbeat ? heartbeat.projectName : '',
    projectPath: heartbeat ? heartbeat.projectPath : '',
    projectFile: heartbeat ? heartbeat.projectFile : '',
    lastSeen: heartbeat ? heartbeat.at : 0,
    capabilities: heartbeat ? heartbeat.capabilities : []
  };
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
    if (parsed.pathname === '/bridge/health') return sendJson(res, { ok: true, app: 'YTX', version: app.getVersion(), bridge: 2 });
    if (req.headers['x-ytx-token'] !== adobeBridgeToken) return sendJson(res, { error: 'Unauthorized YTX bridge request.' }, 401);
    if (req.method === 'GET' && parsed.pathname === '/bridge/status') {
      return sendJson(res, {
        premiere: { ...bridgeAppStatus('premiere'), queued: adobeCommands.premiere.length },
        aftereffects: { ...bridgeAppStatus('aftereffects'), queued: adobeCommands.aftereffects.length },
        version: app.getVersion()
      });
    }
    if (req.method === 'GET' && parsed.pathname === '/bridge/diagnose') {
      return sendJson(res, {
        ok: true,
        version: app.getVersion(),
        bridge: 2,
        tokenAge: Date.now() - adobeBridgeTokenCreatedAt,
        hosts: { premiere: bridgeAppStatus('premiere'), aftereffects: bridgeAppStatus('aftereffects') },
        queued: { premiere: adobeCommands.premiere.length, aftereffects: adobeCommands.aftereffects.length },
        waiting: adobeWaiters.size
      });
    }
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
    if (req.method === 'POST') {
      let raw = '';
      let tooLarge = false;
      req.on('data', chunk => { raw += chunk; if (raw.length > 200000) { tooLarge = true; req.destroy(); } });
      req.on('end', () => {
        if (tooLarge) return;
        let body;
        try { body = JSON.parse(raw || '{}'); } catch { return sendJson(res, { error: 'Invalid JSON.' }, 400); }
        const target = body.app;
        if (!['premiere', 'aftereffects'].includes(target)) return sendJson(res, { error: 'Unknown Adobe host.' }, 400);
        if (parsed.pathname === '/bridge/heartbeat') {
          adobeHeartbeats.set(target, {
            at: Date.now(),
            host: String(body.host || target),
            project: String(body.project || ''),
            projectName: String(body.projectName || body.project || ''),
            projectPath: String(body.projectPath || ''),
            projectFile: String(body.projectFile || ''),
            capabilities: Array.isArray(body.capabilities) ? body.capabilities.map(String).slice(0, 20) : [],
            panelVersion: String(body.panelVersion || '')
          });
          return sendJson(res, { connected: true, serverVersion: app.getVersion(), queued: adobeCommands[target].length });
        }
        if (parsed.pathname === '/bridge/complete') {
          const waiter = adobeWaiters.get(body.id);
          if (waiter) { clearTimeout(waiter.timer); adobeWaiters.delete(body.id); waiter.resolve(body); }
          return sendJson(res, { ok: true });
        }
        if (parsed.pathname === '/bridge/handoff') {
          const filePath = path.resolve(String(body.path || ''));
          if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendJson(res, { error: 'The selected Adobe media file could not be found.' }, 404);
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('adobe:handoff', { path: filePath, url: pathToFileURL(filePath).href, source: target });
          return sendJson(res, { ok: true });
        }
        if (parsed.pathname === '/bridge/media-imported') {
          const status = bridgeAppStatus(target);
          const assetPath = path.resolve(String(body.path || ''));
          const mediaRoot = status.projectPath ? path.resolve(status.projectPath, 'YTX Media') : '';
          const relative = mediaRoot ? path.relative(mediaRoot, assetPath) : '';
          if (!status.connected || !mediaRoot || !relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            return sendJson(res, { error: 'The managed media path is not inside the active project.' }, 400);
          }
          markProjectAssetImported(assetPath, target);
          return sendJson(res, { ok: true });
        }
        return sendJson(res, { error: 'Not found.' }, 404);
      });
      return;
    }
    return sendJson(res, { error: 'Not found.' }, 404);
  });
  adobeBridgeServer = server;
  return new Promise((resolve, reject) => {
    server.once('error', error => { adobeBridgeServer = null; reject(error); });
    server.listen(0, '127.0.0.1', () => {
      adobeBridgePort = server.address().port;
      // Keep settings beside the installed CEP panel and in per-user YTX folders
      // so every Adobe host can find the live port/token.
      integrationManager().writeBridgeConfig(adobeBridgePort, adobeBridgeToken);
      resolve();
    });
  });
}

async function queueAdobeImport(target, mediaPath) {
  if (!['premiere', 'aftereffects'].includes(target)) return { error: 'Choose Premiere Pro or After Effects.' };
  const source = path.resolve(mediaPath || '');
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return { error: 'The exported media file could not be found.' };
  const status = bridgeAppStatus(target);
  if (!status.connected) return { error: target === 'premiere' ? 'Premiere bridge is offline. Restart Premiere and open Window → Extensions (Legacy) → YTX Bridge.' : 'After Effects bridge is offline. Restart After Effects and open Window → Extensions (Legacy) → YTX Bridge.' };
  const projectPath = String(status.projectPath || '');
  if (!projectPath || !fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) return { error: 'Save the Adobe project before importing. YTX stores managed media inside the project folder.' };
  const id = crypto.randomUUID();
  let managed;
  try {
    managed = copyProjectAsset(source, projectPath, target, id, {
      name: status.projectName || status.project || path.basename(projectPath),
      file: status.projectFile || ''
    });
  }
  catch (error) { return { error: `Could not place media in the project folder: ${error.message}` }; }
  const request = { id, path: managed.path, sourcePath: source, operation: 'import-to-timeline', requestedAt: Date.now(), attempts: 0 };
  adobeCommands[target].push(request);
  sendTaskProgress({ id, type: 'import', target, progress: 12, message: `Waiting for ${target === 'premiere' ? 'Premiere' : 'After Effects'} to accept the clip…` });

  let lastSeen = status.lastSeen;
  const keepAlive = setInterval(() => {
    const current = bridgeAppStatus(target);
    if (!current.connected) {
      sendTaskProgress({ id, type: 'import', target, progress: 18, message: 'Waiting for the Adobe bridge panel to reconnect…', done: false });
      return;
    }
    if (current.lastSeen !== lastSeen) {
      lastSeen = current.lastSeen;
      sendTaskProgress({ id, type: 'import', target, progress: 42, message: 'Adobe is importing the managed clip…', done: false });
    }
  }, 2500);

  const response = await new Promise(resolve => {
    const timer = setTimeout(() => {
      adobeWaiters.delete(id);
      const index = adobeCommands[target].indexOf(request);
      if (index >= 0) adobeCommands[target].splice(index, 1);
      resolve({ ok: false, message: 'Adobe did not respond to the import request. Keep YTX Bridge panel open and retry.' });
    }, 45000);
    adobeWaiters.set(id, { resolve, timer });
  });
  clearInterval(keepAlive);
  if (response.ok) markProjectAssetImported(managed.path, target);
  sendTaskProgress({ id, type: 'import', target, progress: 100, message: response.message || (response.ok ? 'Imported into timeline.' : 'Import failed.'), done: true, error: response.ok ? '' : response.message });
  return response.ok ? { ok: true, message: response.message, path: managed.path } : { error: response.message };
}

function readProjectMetadata(projectDir) {
  const folder = path.join(projectDir, 'YTX Media');
  const metadataPath = path.join(folder, '.ytx-media.json');
  try { return { folder, metadataPath, metadata: JSON.parse(fs.readFileSync(metadataPath, 'utf8').replace(/^\uFEFF/, '')) }; }
  catch { return { folder, metadataPath, metadata: { version: 1, assets: [] } }; }
}

function writeProjectMetadata(projectDir, metadata) {
  const { folder, metadataPath } = readProjectMetadata(projectDir);
  fs.mkdirSync(folder, { recursive: true });
  metadata.version = 1;
  metadata.updatedAt = new Date().toISOString();
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  if (process.platform === 'win32') spawn('attrib.exe', ['+h', metadataPath], { windowsHide: true, stdio: 'ignore' });
}

function markProjectAssetImported(assetPath, target) {
  try {
    const folder = path.dirname(assetPath);
    const projectDir = path.dirname(folder);
    const { metadata } = readProjectMetadata(projectDir);
    const asset = (metadata.assets || []).find(item => item.file === path.basename(assetPath));
    if (!asset) return;
    asset.importedInto = target;
    asset.importedAt = asset.importedAt || new Date().toISOString();
    asset.insertedAt = new Date().toISOString();
    writeProjectMetadata(projectDir, metadata);
  } catch {}
}

function copyProjectAsset(source, projectDir, target, requestId = crypto.randomUUID(), project = {}) {
  const folder = path.join(projectDir, 'YTX Media');
  fs.mkdirSync(folder, { recursive: true });
  const rawBase = path.basename(source).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'media';
  const extension = path.extname(rawBase);
  const stem = path.basename(rawBase, extension) || 'media';
  let destination = path.join(folder, rawBase);
  if (fs.existsSync(destination)) destination = path.join(folder, `${stem}-${requestId.slice(0, 8)}${extension}`);
  fs.copyFileSync(source, destination);
  const { metadata } = readProjectMetadata(projectDir);
  metadata.host = target;
  metadata.project = {
    name: project.name || path.basename(projectDir),
    file: project.file || '',
    folder: projectDir
  };
  metadata.assets = (metadata.assets || []).filter(item => fs.existsSync(path.join(folder, item.file)));
  metadata.assets.push({
    file: path.basename(destination),
    originalPath: source,
    importedAt: new Date().toISOString(),
    size: fs.statSync(destination).size,
    importedInto: target
  });
  writeProjectMetadata(projectDir, metadata);
  return { path: destination };
}

function listProjectMedia(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) return { items: [], project: null };
  const folder = path.join(projectDir, 'YTX Media');
  if (!fs.existsSync(folder)) return { items: [], folder, project: { name: path.basename(projectDir), folder: projectDir } };
  const { metadata, metadataPath } = readProjectMetadata(projectDir);
  const items = (metadata.assets || []).map(item => {
    const filePath = path.join(folder, item.file);
    try {
      const stat = fs.statSync(filePath);
      return { name: item.file, path: filePath, size: stat.size, importedAt: item.importedAt, insertedAt: item.insertedAt || '', importedInto: item.importedInto || '' };
    } catch { return null; }
  }).filter(Boolean);
  if (items.length !== (metadata.assets || []).length) {
    const known = new Set(items.map(item => item.name));
    metadata.assets = (metadata.assets || []).filter(item => known.has(item.file));
    try { writeProjectMetadata(projectDir, metadata); } catch {}
  }
  return {
    items,
    folder,
    metadataPath,
    project: metadata.project || { name: path.basename(projectDir), folder: projectDir }
  };
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
    const sharedFallback = path.join(process.env.ProgramData || 'C:\\ProgramData', 'YTX', 'python-venv', 'Scripts', 'python.exe');
    const installRootFallback = path.join(path.dirname(process.execPath), 'resources', 'python-venv', 'Scripts', 'python.exe');
    const command = [bundled, installRootFallback, sharedFallback, userFallback].find(candidate => fs.existsSync(candidate));
    return { command: command || userFallback, prefixArgs: [] };
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
