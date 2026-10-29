/*
 * Integration installer for YTX.
 *
 * Browser extensions are installed with Chromium enterprise policy
 * (ExtensionInstallForcelist), which is the supported way to install an
 * extension without interactive Developer mode steps. The per-machine
 * installer writes HKLM policies while elevated. When YTX runs without
 * elevation it first tries HKLM, then HKCU, and finally offers a single UAC
 * approval that applies the machine policy through reg.exe.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { execFile, execFileSync } = require('node:child_process');

const REPOSITORY = 'pixelstoLogic/YTX';
const EXTENSION_UPDATE_URL = `https://github.com/${REPOSITORY}/releases/latest/download/updates.xml`;
const EXTENSION_CRX_URL = `https://github.com/${REPOSITORY}/releases/latest/download/ytx-extension.crx`;
// Chromium force-install requires a real MIME type for the CRX. GitHub release
// assets are served as application/octet-stream with Content-Disposition:
// attachment, which Edge/Brave reject. YTX therefore serves the signed package
// from a fixed loopback port while it is running.
const EXTENSION_UPDATE_PORT = 62389;
const EXTENSION_LOCAL_UPDATE_URL = `http://127.0.0.1:${EXTENSION_UPDATE_PORT}/updates.xml`;
const POLICY_MARKER = 'Software\\YTX\\BrowserExtension';

const BROWSERS = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    policy: 'Software\\Policies\\Google\\Chrome',
    paths: ['Google\\Chrome\\Application\\chrome.exe', 'Google\\Chrome SxS\\Application\\chrome.exe'],
    appPath: 'chrome.exe'
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    policy: 'Software\\Policies\\Microsoft\\Edge',
    paths: ['Microsoft\\Edge\\Application\\msedge.exe'],
    appPath: 'msedge.exe'
  },
  {
    id: 'brave',
    name: 'Brave',
    policy: 'Software\\Policies\\BraveSoftware\\Brave',
    paths: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    appPath: 'brave.exe'
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    policy: 'Software\\Policies\\Vivaldi',
    paths: ['Vivaldi\\Application\\vivaldi.exe'],
    appPath: 'vivaldi.exe'
  },
  {
    id: 'opera',
    name: 'Opera',
    policy: 'Software\\Policies\\Opera Software\\Opera',
    paths: ['Programs\\Opera\\launcher.exe', 'Opera\\launcher.exe'],
    appPath: 'launcher.exe'
  }
];

function createIntegrationManager(options) {
  const resourcesRoot = options.resourcesRoot;
  const extensionSource = path.join(resourcesRoot, 'browser-extension');
  const adobeSource = path.join(resourcesRoot, 'adobe-bridge');
  const localAppData = options.localAppData;
  const appData = options.appData;
  const updateUrl = options.updateUrl || EXTENSION_LOCAL_UPDATE_URL;
  const crxUrl = options.crxUrl || EXTENSION_CRX_URL;
  const extensionTarget = path.join(localAppData, 'YTX', 'browser-extension');
  const bridgeTarget = path.join(appData, 'Adobe', 'CEP', 'extensions', 'YTX-Bridge');
  let updateServer = null;
  let updateServerReady = null;

  function roots() {
    return [
      process.env.LOCALAPPDATA,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.APPDATA
    ].filter(Boolean);
  }

  function regQuery(root, key, valueName) {
    try {
      const args = ['QUERY', `${root}\\${key}`];
      if (valueName === '') args.push('/ve');
      else args.push('/v', valueName);
      const output = execFileSync('reg.exe', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const match = output.match(/REG_\w+\s+(.*)\r?$/m);
      return match ? match[1].trim() : '';
    } catch { return ''; }
  }

  function regKeyExists(root, key) {
    try {
      execFileSync('reg.exe', ['QUERY', `${root}\\${key}`], { windowsHide: true, stdio: 'ignore' });
      return true;
    } catch { return false; }
  }

  function regSet(root, key, valueName, value) {
    try {
      execFileSync('reg.exe', ['ADD', `${root}\\${key}`, '/v', valueName, '/t', 'REG_SZ', '/d', String(value), '/f'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      const detail = String(error.stderr || '').replace(/^ERROR:\s*/i, '').split(/\r?\n/)[0].replace(/\.\s*$/, '').trim();
      throw new Error(detail ? `Windows blocked the registry write: ${detail.toLowerCase()}.` : 'Windows blocked the registry write.');
    }
  }

  function regDelete(root, key, valueName) {
    try { execFileSync('reg.exe', ['DELETE', `${root}\\${key}`, '/v', valueName, '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  }

  function regDeleteTree(root, key) {
    try { execFileSync('reg.exe', ['DELETE', `${root}\\${key}`, '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  }

  function findExecutable(appPath) {
    for (const root of roots()) {
      try {
        const output = execFileSync('reg.exe', ['QUERY', `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${appPath}`, '/ve'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const match = output.match(/REG_SZ\s+(.*)\r?$/m);
        if (match && fs.existsSync(match[1].trim())) return match[1].trim();
      } catch {}
      const direct = path.join(root, appPath === 'launcher.exe' ? 'Programs\\Opera\\launcher.exe' : appPath);
      if (fs.existsSync(direct)) return direct;
    }
    return '';
  }

  function detectBrowsers() {
    const detected = [];
    for (const browser of BROWSERS) {
      let executable = '';
      for (const root of roots()) {
        for (const relative of browser.paths) {
          const candidate = path.join(root, relative);
          if (fs.existsSync(candidate)) { executable = candidate; break; }
        }
        if (executable) break;
      }
      if (!executable && browser.appPath) executable = findExecutable(browser.appPath);
      detected.push({
        id: browser.id,
        name: browser.name,
        path: executable,
        installed: Boolean(executable),
        policy: browser.policy,
        policyPath: browser.policy,
        automatic: true
      });
    }
    return detected;
  }

  function extensionIdFromManifest(manifest) {
    if (manifest && manifest.key) {
      const publicKey = Buffer.from(manifest.key, 'base64');
      const digest = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 32);
      return digest.replace(/[0-9a-f]/g, character => String.fromCharCode(97 + parseInt(character, 16)));
    }
    return '';
  }

  function readExtensionInfo() {
    const manifestPath = path.join(extensionSource, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`The bundled browser extension is missing: ${manifestPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let extensionId = extensionIdFromManifest(manifest);
    if (!extensionId) {
      try { extensionId = fs.readFileSync(path.join(extensionSource, 'extension-id.txt'), 'utf8').trim(); } catch {}
    }
    return { manifest, extensionId, version: manifest.version || '', target: extensionTarget };
  }

  function extensionPackage() {
    for (const root of [extensionTarget, extensionSource]) {
      const manifestPath = path.join(root, 'manifest.json');
      const crxPath = path.join(root, 'ytx-extension.crx');
      if (!fs.existsSync(manifestPath) || !fs.existsSync(crxPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      let extensionId = extensionIdFromManifest(manifest);
      if (!extensionId) {
        try { extensionId = fs.readFileSync(path.join(root, 'extension-id.txt'), 'utf8').trim(); } catch {}
      }
      if (extensionId && manifest.version) {
        return { root, manifest, crxPath, extensionId, version: String(manifest.version) };
      }
    }
    throw new Error('The signed YTX browser extension is missing. Reinstall YTX Studio to restore it.');
  }

  function copyDirectory(source, target) {
    if (!fs.existsSync(source)) throw new Error(`Missing integration resources: ${source}`);
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
  }

  function updateManifestXml(pkg, origin) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n`
      + '<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n'
      + `  <app appid="${pkg.extensionId}">\n`
      + `    <updatecheck codebase="${origin}/ytx-extension.crx" version="${pkg.version}" />\n`
      + '  </app>\n'
      + '</gupdate>\n';
  }

  function extensionInstallPage(pkg) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
      + '<title>YTX browser helper</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#e9ecf1;font:15px/1.55 "Segoe UI",Arial,sans-serif}main{max-width:620px;padding:34px;border:1px solid #2a2e36;border-radius:16px;background:#12151a}h1{margin:0 0 6px;font-size:24px}p{color:#a9aeb9}a.button{display:inline-block;margin-top:12px;padding:11px 18px;border-radius:9px;background:#d4ff46;color:#15180d;font-weight:700;text-decoration:none}code{color:#d4ff46}small{color:#7d838e}</style></head><body><main>'
      + '<h1>YTX browser helper</h1>'
      + `<p>Version <code>${pkg.version}</code> is ready. Extension ID <code>${pkg.extensionId}</code>.</p>`
      + '<p>YTX has registered the helper with your Chromium browser. Close the browser completely, reopen it, and the YTX button appears on YouTube videos, Shorts, and live pages.</p>'
      + '<p>If the browser still does not show the helper, open its extensions page, enable Developer mode, and use <b>Load unpacked</b> with the folder below.</p>'
      + `<p><small>${extensionTarget.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</small></p>`
      + '<a class="button" href="/ytx-extension.crx">Download the signed helper</a>'
      + '</main></body></html>';
  }

  function probeExistingUpdateServer() {
    return new Promise(resolve => {
      const request = http.get({ host: '127.0.0.1', port: EXTENSION_UPDATE_PORT, path: '/health', timeout: 1500 }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data && data.app === 'ytx-extension-update') {
              resolve({ ok: true, external: true, url: updateUrl, port: EXTENSION_UPDATE_PORT, extensionId: data.extensionId, version: data.version });
              return;
            }
          } catch {}
          resolve({ ok: false });
        });
      });
      request.on('timeout', () => { request.destroy(); resolve({ ok: false }); });
      request.on('error', () => resolve({ ok: false }));
    });
  }

  function startExtensionServer() {
    if (updateServerReady) return updateServerReady;
    updateServerReady = new Promise(async resolve => {
      let pkg;
      try { pkg = extensionPackage(); }
      catch (error) { updateServerReady = null; resolve({ ok: false, error: error.message }); return; }

      const server = http.createServer((request, response) => {
        const pathname = new URL(request.url || '/', `http://127.0.0.1:${EXTENSION_UPDATE_PORT}`).pathname.toLowerCase();
        const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-YTX-Version': pkg.version };
        if (pathname === '/health') {
          const body = JSON.stringify({ app: 'ytx-extension-update', extensionId: pkg.extensionId, version: pkg.version });
          response.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
          response.end(body);
          return;
        }
        if (pathname === '/updates.xml' || pathname === '/updates') {
          const body = updateManifestXml(pkg, `http://127.0.0.1:${EXTENSION_UPDATE_PORT}`);
          response.writeHead(200, { ...headers, 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
          response.end(body);
          return;
        }
        if (pathname === '/ytx-extension.crx') {
          let size = 0;
          try { size = fs.statSync(pkg.crxPath).size; } catch {}
          if (!size) { response.writeHead(404, headers); response.end('Not found'); return; }
          response.writeHead(200, { ...headers, 'Content-Type': 'application/x-chrome-extension', 'Content-Length': size });
          const stream = fs.createReadStream(pkg.crxPath);
          stream.on('error', () => response.destroy());
          stream.pipe(response);
          return;
        }
        if (pathname === '/install' || pathname === '/') {
          const body = extensionInstallPage(pkg);
          response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
          response.end(body);
          return;
        }
        response.writeHead(404, headers);
        response.end('Not found');
      });

      server.once('error', async error => {
        if (error.code === 'EADDRINUSE') {
          const existing = await probeExistingUpdateServer();
          if (existing.ok) { updateServerReady = Promise.resolve(existing); resolve(existing); return; }
        }
        updateServerReady = null;
        resolve({ ok: false, error: `The local extension service could not start on port ${EXTENSION_UPDATE_PORT}: ${error.message}` });
      });

      server.listen(EXTENSION_UPDATE_PORT, '127.0.0.1', () => {
        updateServer = server;
        resolve({ ok: true, url: updateUrl, port: EXTENSION_UPDATE_PORT, extensionId: pkg.extensionId, version: pkg.version });
      });
    });
    return updateServerReady;
  }

  function stopExtensionServer() {
    if (updateServer) {
      try { updateServer.close(); } catch {}
      updateServer = null;
    }
    updateServerReady = null;
  }

  function findPolicySlot(root, policyKey, entry) {
    for (let slot = 1; slot <= 60; slot++) {
      const existing = regQuery(root, `${policyKey}\\ExtensionInstallForcelist`, String(slot));
      if (!existing) return { slot, existing: false };
      if (existing.toLowerCase() === entry.toLowerCase()) return { slot, existing: true };
    }
    return null;
  }

  function policyResult(browser, found, root) {
    return {
      ok: true,
      browser: browser.id,
      name: browser.name,
      slot: found.slot,
      existing: found.existing,
      scope: root === 'HKLM' ? 'machine' : 'user',
      message: found.existing ? 'Already installed.' : 'Extension policy installed.'
    };
  }

  function writePolicyMarker(root, browser, entry, slot) {
    try {
      regSet(root, `${POLICY_MARKER}\\Policies\\${browser.id}`, 'Key', browser.policy);
      regSet(root, `${POLICY_MARKER}\\Policies\\${browser.id}`, 'ValueName', String(slot));
      regSet(root, `${POLICY_MARKER}\\Policies\\${browser.id}`, 'Entry', entry);
    } catch {}
  }

  function installPolicy(browser, extensionId) {
    if (!browser.policy) return { ok: false, browser: browser.id, name: browser.name, message: 'This browser does not expose a managed policy key.' };
    const entry = `${extensionId};${updateUrl}`;
    const policyKey = `${browser.policy}\\ExtensionInstallForcelist`;
    const settingsKey = `${browser.policy}\\ExtensionSettings`;
    const settingsValue = JSON.stringify({
      [extensionId]: { installation_mode: 'force_installed', update_url: updateUrl, override_update_url: true }
    });
    const errors = [];

    function rememberSettings(root) {
      try {
        regSet(root, settingsKey, extensionId, settingsValue);
        return regQuery(root, settingsKey, extensionId).toLowerCase() === settingsValue.toLowerCase();
      } catch { return false; }
    }

    // Machine policy survives user changes and needs no Developer mode. It is
    // the primary path; a per-user policy is only a fallback on locked PCs.
    const machine = findPolicySlot('HKLM', browser.policy, entry);
    if (machine) {
      try {
        regSet('HKLM', policyKey, String(machine.slot), entry);
        if (regQuery('HKLM', policyKey, String(machine.slot)).toLowerCase() === entry.toLowerCase()) {
          const settings = rememberSettings('HKLM');
          writePolicyMarker('HKLM', browser, entry, machine.slot);
          return { ...policyResult(browser, machine, 'HKLM'), settings, settingsKey, settingsValue };
        }
        errors.push('Windows did not retain the machine policy.');
      } catch (error) { errors.push(error.message); }
    } else {
      errors.push('The machine policy list is full.');
    }

    const user = findPolicySlot('HKCU', browser.policy, entry);
    if (user) {
      try {
        regSet('HKCU', policyKey, String(user.slot), entry);
        if (regQuery('HKCU', policyKey, String(user.slot)).toLowerCase() === entry.toLowerCase()) {
          const settings = rememberSettings('HKCU');
          writePolicyMarker('HKCU', browser, entry, user.slot);
          return { ...policyResult(browser, user, 'HKCU'), scope: 'user', settings, settingsKey, settingsValue };
        }
        errors.push('Windows did not retain the user policy.');
      } catch (error) { errors.push(error.message); }
    } else {
      errors.push('The user policy list is full.');
    }

    if (!machine) {
      return { ok: false, browser: browser.id, name: browser.name, message: 'The browser policy list is full. Remove an unused policy and try again.' };
    }
    return {
      ok: false,
      browser: browser.id,
      name: browser.name,
      needsElevation: true,
      policyKey,
      settingsKey,
      settingsValue,
      slot: machine.slot,
      entry,
      message: errors[0] || 'Administrator approval is required to register this browser.'
    };
  }

  function escapeReg(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function runElevatedRegistry(regText) {
    const folder = path.join(os.tmpdir(), 'ytx-elevation');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `policies-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.reg`);
    fs.writeFileSync(file, regText, 'utf8');
    const command = [
      "$ErrorActionPreference='Stop'",
      'try {',
      `  $p = Start-Process -FilePath "$env:SystemRoot\\System32\\reg.exe" -ArgumentList @('import', '"${file.replace(/'/g, "''")}"') -Verb RunAs -Wait -PassThru -WindowStyle Hidden`,
      '  exit $p.ExitCode',
      '} catch { exit 1223 }'
    ].join('\n');
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        windowsHide: true,
        timeout: 180000,
        stdio: ['ignore', 'ignore', 'ignore']
      });
      return { ok: true, file };
    } catch (error) {
      return { ok: false, code: error.status || 1, file };
    } finally {
      try { fs.unlinkSync(file); } catch {}
    }
  }

  function applyPoliciesElevated(pending, extensionId) {
    if (!pending.length) return [];
    const lines = ['Windows Registry Editor Version 5.00', ''];
    const grouped = new Map();
    for (const item of pending) {
      if (!grouped.has(item.policyKey)) grouped.set(item.policyKey, []);
      grouped.get(item.policyKey).push(item);
    }
    for (const [policyKey, entries] of grouped) {
      lines.push(`[HKEY_LOCAL_MACHINE\\${policyKey}]`);
      for (const entry of entries) lines.push(`"${entry.slot}"="${escapeReg(entry.entry)}"`);
      lines.push('');
    }
    const settingsGroups = new Map();
    for (const item of pending) {
      if (!item.settingsKey || !item.settingsValue) continue;
      if (!settingsGroups.has(item.settingsKey)) settingsGroups.set(item.settingsKey, item.settingsValue);
    }
    for (const [settingsKey, settingsValue] of settingsGroups) {
      lines.push(`[HKEY_LOCAL_MACHINE\\${settingsKey}]`);
      lines.push(`"${extensionId}"="${escapeReg(settingsValue)}"`);
      lines.push('');
    }
    lines.push('[HKEY_LOCAL_MACHINE\\Software\\YTX\\BrowserExtension]');
    lines.push(`"ExtensionId"="${escapeReg(extensionId)}"`);
    lines.push(`"UpdateUrl"="${escapeReg(updateUrl)}"`);
    lines.push('"Scope"="machine"');
    lines.push(`"InstalledAt"="${new Date().toISOString()}"`);
    lines.push(`"Browsers"="${escapeReg(pending.map(item => item.browser).join(','))}"`);
    lines.push('');
    for (const item of pending) {
      lines.push(`[HKEY_LOCAL_MACHINE\\Software\\YTX\\BrowserExtension\\Policies\\${item.browser}]`);
      lines.push(`"Key"="${escapeReg(item.policyKey.replace(/\\ExtensionInstallForcelist$/i, ''))}"`);
      lines.push(`"ValueName"="${item.slot}"`);
      lines.push(`"Entry"="${escapeReg(item.entry)}"`);
      lines.push('');
    }

    const elevation = runElevatedRegistry(lines.join('\r\n'));
    if (!elevation.ok) {
      return pending.map(item => ({
        ok: false,
        browser: item.browser,
        name: item.name,
        needsElevation: true,
        message: elevation.code === 1223
          ? 'Administrator approval was not granted. The browser extension was not registered.'
          : 'Windows could not apply the machine browser policy. Try installing YTX again with administrator approval.'
      }));
    }

    return pending.map(item => {
      const verified = regQuery('HKLM', item.policyKey, String(item.slot));
      const settings = item.settingsKey
        ? regQuery('HKLM', item.settingsKey, extensionId).toLowerCase() === String(item.settingsValue || '').toLowerCase()
        : false;
      return verified.toLowerCase() === item.entry.toLowerCase()
        ? { ok: true, browser: item.browser, name: item.name, scope: 'machine', elevated: true, slot: item.slot, settings, message: 'Extension policy installed with administrator approval.' }
        : { ok: false, browser: item.browser, name: item.name, needsElevation: true, message: 'Windows accepted the request but the machine policy is not present.' };
    });
  }

  async function installBrowserExtension(request = {}) {
    try {
      const service = await startExtensionServer();
      if (!service.ok) return { error: service.error || 'The local browser-extension service could not start.' };
      const info = readExtensionInfo();
      if (!info.extensionId) return { error: 'The extension package has no signing key. Rebuild the YTX installer.' };
      copyDirectory(extensionSource, extensionTarget);
      fs.writeFileSync(path.join(extensionTarget, 'extension-id.txt'), info.extensionId + '\n', 'utf8');
      fs.writeFileSync(path.join(extensionTarget, 'updates.xml'), updateManifestXml(info, `http://127.0.0.1:${EXTENSION_UPDATE_PORT}`), 'utf8');

      const detected = detectBrowsers();
      const requested = Array.isArray(request.browserIds) && request.browserIds.length
        ? new Set(request.browserIds)
        : new Set(detected.filter(item => item.installed).map(item => item.id));
      let results = [];
      for (const browser of detected) {
        if (!requested.has(browser.id)) continue;
        if (!browser.installed) {
          results.push({ ok: false, browser: browser.id, name: browser.name, message: 'Browser not detected.' });
          continue;
        }
        try { results.push(installPolicy(browser, info.extensionId)); }
        catch (error) { results.push({ ok: false, browser: browser.id, name: browser.name, message: `Policy write failed: ${error.message}` }); }
      }

      let elevated = false;
      const pending = results.filter(item => item.needsElevation);
      if (pending.length && request.allowElevation !== false) {
        const elevatedResults = applyPoliciesElevated(pending, info.extensionId);
        elevated = elevatedResults.some(item => item.ok && item.elevated);
        results = results.map(item => {
          if (!item.needsElevation) return item;
          return elevatedResults.find(entry => entry.browser === item.browser) || item;
        });
      }

      const successful = results.filter(item => item.ok);
      const machineSuccess = successful.filter(item => item.scope === 'machine');
      const userSuccess = successful.filter(item => item.scope === 'user');
      if (machineSuccess.length) {
        try {
          regSet('HKLM', POLICY_MARKER, 'ExtensionId', info.extensionId);
          regSet('HKLM', POLICY_MARKER, 'UpdateUrl', updateUrl);
          regSet('HKLM', POLICY_MARKER, 'InstalledAt', new Date().toISOString());
          regSet('HKLM', POLICY_MARKER, 'Browsers', machineSuccess.map(item => item.browser).join(','));
          regSet('HKLM', POLICY_MARKER, 'Scope', 'machine');
        } catch {}
      }
      if (userSuccess.length) {
        try {
          regSet('HKCU', POLICY_MARKER, 'ExtensionId', info.extensionId);
          regSet('HKCU', POLICY_MARKER, 'UpdateUrl', updateUrl);
          regSet('HKCU', POLICY_MARKER, 'InstalledAt', new Date().toISOString());
          regSet('HKCU', POLICY_MARKER, 'Browsers', userSuccess.map(item => item.browser).join(','));
          regSet('HKCU', POLICY_MARKER, 'Scope', 'user');
        } catch {}
      }
      if (!successful.length) {
        if (!machineSuccess.length) regDeleteTree('HKCU', POLICY_MARKER);
      }
      const names = successful.map(item => item.name).join(', ');
      const blocked = results.filter(item => !item.ok);
      const needsElevation = blocked.some(item => item.needsElevation);
      return {
        ok: successful.length > 0,
        extensionId: info.extensionId,
        version: info.version,
        path: extensionTarget,
        updateUrl,
        serviceUrl: service.url || updateUrl,
        serviceRunning: true,
        scope: machineSuccess.length ? 'machine' : userSuccess.length ? 'user' : '',
        elevated,
        results,
        restartedBrowserRequired: successful.length > 0,
        needsElevation,
        message: successful.length
          ? `YTX ${info.version} is registered in ${names}. Close ${successful.length === 1 ? 'that browser' : 'those browsers'} completely and reopen ${successful.length === 1 ? 'it' : 'them'} to finish installation.`
          : needsElevation
            ? 'Windows requires administrator approval to register the browser extension. Select Authorize browser integration and approve the Windows prompt.'
            : 'No supported browser was found. Install Chrome, Edge, Brave, Vivaldi, or Opera and run the setup again.'
      };
    } catch (error) {
      return { error: `Could not install the browser extension: ${error.message}` };
    }
  }

  function collectPolicyValues(root, browser, extensionId) {
    const values = [];
    for (let slot = 1; slot <= 60; slot++) {
      const current = regQuery(root, `${browser.policy}\\ExtensionInstallForcelist`, String(slot));
      if (current && current.toLowerCase().includes(extensionId.toLowerCase())) values.push(slot);
    }
    return values;
  }

  function removeBrowserExtension() {
    const info = readExtensionInfo();
    const removed = [];
    const machineCleanup = [];
    for (const browser of BROWSERS) {
      for (const root of ['HKLM', 'HKCU']) {
        for (const slot of collectPolicyValues(root, browser, info.extensionId)) {
          if (root === 'HKLM') machineCleanup.push({ policyKey: `${browser.policy}\\ExtensionInstallForcelist`, slot });
          else {
            regDelete('HKCU', `${browser.policy}\\ExtensionInstallForcelist`, String(slot));
            regDelete('HKCU', `${browser.policy}\\ExtensionSettings`, info.extensionId);
          }
          removed.push({ browser: browser.id, scope: root === 'HKLM' ? 'machine' : 'user', slot });
        }
      }
    }
    if (machineCleanup.length) {
      const lines = ['Windows Registry Editor Version 5.00', ''];
      const grouped = new Map();
      for (const item of machineCleanup) {
        if (!grouped.has(item.policyKey)) grouped.set(item.policyKey, []);
        grouped.get(item.policyKey).push(item.slot);
      }
      for (const [policyKey, slots] of grouped) {
        lines.push(`[HKEY_LOCAL_MACHINE\\${policyKey}]`);
        for (const slot of slots) lines.push(`"${slot}"=-`);
        lines.push('');
      }
      for (const browser of BROWSERS) {
        lines.push(`[HKEY_LOCAL_MACHINE\\${browser.policy}\\ExtensionSettings]`);
        lines.push(`"${info.extensionId}"=-`);
        lines.push('');
      }
      lines.push('[HKEY_LOCAL_MACHINE\\Software\\YTX\\BrowserExtension]');
      lines.push('');
      const elevation = runElevatedRegistry(lines.join('\r\n'));
      if (!elevation.ok) return { ok: false, needsElevation: true, removed, message: 'Administrator approval is required to remove the machine browser policy.' };
    }
    regDeleteTree('HKCU', POLICY_MARKER);
    return { ok: true, removed, message: removed.length ? 'The YTX browser extension policy was removed.' : 'No YTX browser policy was present.' };
  }

  function detectAdobeHosts() {
    const found = { premiere: [], aftereffects: [] };
    for (const root of roots()) {
      const adobeRoot = path.join(root, 'Adobe');
      if (!fs.existsSync(adobeRoot)) continue;
      let entries = [];
      try { entries = fs.readdirSync(adobeRoot, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const match = entry.name.match(/^Adobe (Premiere Pro|After Effects) (\d{4})$/i);
        if (!match) continue;
        const id = /premiere/i.test(match[1]) ? 'premiere' : 'aftereffects';
        const executable = id === 'premiere'
          ? path.join(adobeRoot, entry.name, 'Adobe Premiere Pro.exe')
          : path.join(adobeRoot, entry.name, 'Support Files', 'AfterFX.exe');
        if (!fs.existsSync(executable)) continue;
        if (!found[id].some(item => item.path === executable)) found[id].push({ id, name: entry.name, version: match[2], path: executable });
      }
    }
    return { ...found, hosts: [...found.premiere, ...found.aftereffects] };
  }

  function writeBridgeConfig(port, token) {
    const payload = JSON.stringify({ port, token, version: 1, updatedAt: new Date().toISOString() }, null, 2);
    const folders = [bridgeTarget, path.join(appData, 'YTX'), path.join(localAppData, 'YTX')];
    for (const folder of folders) {
      try {
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'bridge.json'), payload, 'utf8');
      } catch {}
    }
    return payload;
  }

  function installAdobeBridge(request = {}) {
    const detected = detectAdobeHosts();
    const requestedHosts = Array.isArray(request.hosts) && request.hosts.length ? request.hosts : null;
    const hosts = requestedHosts || (detected.hosts.length ? [...new Set(detected.hosts.map(item => item.id))] : ['premiere', 'aftereffects']);
    const manifestName = hosts.includes('premiere') && hosts.includes('aftereffects')
      ? 'manifest.xml'
      : hosts.includes('aftereffects') ? 'manifest-aftereffects.xml' : 'manifest-premiere.xml';

    copyDirectory(path.join(adobeSource), bridgeTarget);
    for (const file of ['manifest.xml', 'manifest-premiere.xml', 'manifest-aftereffects.xml']) {
      try { fs.rmSync(path.join(bridgeTarget, 'CSXS', file), { force: true }); } catch {}
    }
    fs.mkdirSync(path.join(bridgeTarget, 'CSXS'), { recursive: true });
    fs.copyFileSync(path.join(adobeSource, 'CSXS', manifestName), path.join(bridgeTarget, 'CSXS', 'manifest.xml'));
    fs.writeFileSync(path.join(bridgeTarget, '.ytx-bridge.json'), JSON.stringify({ hosts, installedAt: new Date().toISOString(), version: options.appVersion || '' }, null, 2), 'utf8');

    const cepDebug = [];
    for (let version = 9; version <= 14; version++) {
      try {
        regSet('HKCU', `Software\\Adobe\\CSXS.${version}`, 'PlayerDebugMode', '1');
        cepDebug.push(version);
      } catch {}
    }
    if (request.port && request.token) writeBridgeConfig(request.port, request.token);
    return {
      ok: true,
      path: bridgeTarget,
      hosts,
      manifest: manifestName,
      cepDebug,
      detected: detected.hosts,
      message: hosts.length
        ? `YTX Bridge is installed for ${hosts.map(host => host === 'premiere' ? 'Premiere Pro' : 'After Effects').join(' and ')}. Restart Adobe, then open Window → Extensions (Legacy) → YTX Bridge.`
        : 'YTX Bridge was installed. Restart Adobe before opening the panel.'
    };
  }

  function readBridgeConfig() {
    for (const folder of [bridgeTarget, path.join(appData, 'YTX'), path.join(localAppData, 'YTX')]) {
      try {
        const config = JSON.parse(fs.readFileSync(path.join(folder, 'bridge.json'), 'utf8'));
        if (config && config.port && config.token) return { ...config, source: path.join(folder, 'bridge.json') };
      } catch {}
    }
    return null;
  }

  function getAdobeBridgeStatus() {
    const config = readBridgeConfig();
    const debug = {};
    for (let version = 9; version <= 14; version++) debug[`CSXS.${version}`] = regQuery('HKCU', `Software\\Adobe\\CSXS.${version}`, 'PlayerDebugMode');
    let marker = null;
    try { marker = JSON.parse(fs.readFileSync(path.join(bridgeTarget, '.ytx-bridge.json'), 'utf8')); } catch {}
    let hosts = marker && Array.isArray(marker.hosts) ? marker.hosts : [];
    if (!hosts.length) {
      try {
        const manifest = fs.readFileSync(path.join(bridgeTarget, 'CSXS', 'manifest.xml'), 'utf8');
        if (/Host Name="PPRO"/.test(manifest)) hosts.push('premiere');
        if (/Host Name="AEFT"/.test(manifest)) hosts.push('aftereffects');
      } catch {}
    }
    return {
      installed: fs.existsSync(path.join(bridgeTarget, 'panel.js')) && fs.existsSync(path.join(bridgeTarget, 'CSXS', 'manifest.xml')),
      path: bridgeTarget,
      config,
      hosts,
      installedAt: marker ? marker.installedAt : '',
      cepDebug: debug,
      detected: detectAdobeHosts().hosts
    };
  }

  function browserUserDataRoots(browser) {
    const local = process.env.LOCALAPPDATA || '';
    const roaming = process.env.APPDATA || '';
    const map = {
      chrome: [path.join(local, 'Google', 'Chrome', 'User Data')],
      edge: [path.join(local, 'Microsoft', 'Edge', 'User Data')],
      brave: [path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
      vivaldi: [path.join(local, 'Vivaldi', 'User Data')],
      opera: [path.join(roaming, 'Opera Software', 'Opera Stable'), path.join(roaming, 'Opera Software', 'Opera GX Stable')]
    };
    return (map[browser.id] || []).filter(folder => folder && fs.existsSync(folder));
  }

  function findInstalledExtension(browser, extensionId) {
    const profiles = [];
    for (const root of browserUserDataRoots(browser)) {
      let entries = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const profileRoot = path.join(root, entry.name);
        if (!fs.existsSync(path.join(profileRoot, 'Preferences')) && !fs.existsSync(path.join(profileRoot, 'Secure Preferences'))) continue;
        const versionRoot = path.join(profileRoot, 'Extensions', extensionId);
        if (!fs.existsSync(versionRoot)) continue;
        let versions = [];
        try { versions = fs.readdirSync(versionRoot).filter(version => fs.existsSync(path.join(versionRoot, version, 'manifest.json'))); } catch {}
        if (versions.length) {
          versions.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
          profiles.push({ profile: entry.name, version: versions[versions.length - 1] });
        }
      }
    }
    return { installed: profiles.length > 0, profiles };
  }

  function getBrowserExtensionStatus() {
    let info = null;
    try { info = readExtensionInfo(); } catch (error) { return { installed: false, error: error.message }; }
    const detected = detectBrowsers();
    const policies = [];
    for (const browser of BROWSERS) {
      let policyInstalled = false;
      let scope = '';
      let policyValue = '';
      for (const root of ['HKLM', 'HKCU']) {
        for (let slot = 1; slot <= 60; slot++) {
          const current = regQuery(root, `${browser.policy}\\ExtensionInstallForcelist`, String(slot));
          if (current.toLowerCase().includes(info.extensionId.toLowerCase())) {
            policyInstalled = true;
            scope = root === 'HKLM' ? 'machine' : 'user';
            policyValue = current;
            break;
          }
        }
        if (policyInstalled) break;
      }
      const profileState = findInstalledExtension(browser, info.extensionId);
      const browserInfo = detected.find(item => item.id === browser.id);
      policies.push({
        id: browser.id,
        name: browser.name,
        installed: policyInstalled,
        registered: policyInstalled,
        scope,
        updateUrl: policyValue.split(';').slice(1).join(';'),
        detected: Boolean(browserInfo && browserInfo.installed),
        extensionInstalled: profileState.installed,
        installedVersion: profileState.profiles.length ? profileState.profiles[0].version : '',
        profiles: profileState.profiles
      });
    }
    const machine = policies.filter(item => item.scope === 'machine');
    return {
      installed: fs.existsSync(path.join(extensionTarget, 'manifest.json')),
      path: extensionTarget,
      extensionId: info.extensionId,
      version: info.version,
      updateUrl,
      serviceUrl: updateUrl,
      policies,
      active: policies.filter(item => item.extensionInstalled).map(item => item.id),
      scope: machine.length ? 'machine' : policies.some(item => item.scope === 'user') ? 'user' : '',
      registered: policies.some(item => item.registered),
      totalInstalled: policies.filter(item => item.extensionInstalled).length
    };
  }

  async function isProcessRunning(imageName) {
    if (process.platform !== 'win32') return false;
    return new Promise(resolve => {
      execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${imageName}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout) => {
        resolve(!error && String(stdout).toLowerCase().includes(imageName.toLowerCase()));
      });
    });
  }

  return {
    detectBrowsers,
    installBrowserExtension,
    removeBrowserExtension,
    getBrowserExtensionStatus,
    startExtensionServer,
    stopExtensionServer,
    detectAdobeHosts,
    installAdobeBridge,
    getAdobeBridgeStatus,
    writeBridgeConfig,
    isProcessRunning,
    paths: { extensionSource, extensionTarget, adobeSource, bridgeTarget }
  };
}

module.exports = { createIntegrationManager, EXTENSION_UPDATE_URL, EXTENSION_CRX_URL, EXTENSION_LOCAL_UPDATE_URL, EXTENSION_UPDATE_PORT };
