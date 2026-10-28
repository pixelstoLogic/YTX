/*
 * Per-user integration installer for YTX.
 *
 * Browser extension installation intentionally uses Chromium enterprise policy
 * (ExtensionInstallForcelist) instead of Chrome's Developer mode. This is the
 * only supported way to install an extension for a normal user without manual
 * confirmation. The policy points at the signed CRX/update manifest published
 * with every YTX GitHub release.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');

const REPOSITORY = 'pixelstoLogic/YTX';
const EXTENSION_UPDATE_URL = `https://github.com/${REPOSITORY}/releases/latest/download/updates.xml`;
const EXTENSION_CRX_URL = `https://github.com/${REPOSITORY}/releases/latest/download/ytx-extension.crx`;
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
  const updateUrl = options.updateUrl || EXTENSION_UPDATE_URL;
  const crxUrl = options.crxUrl || EXTENSION_CRX_URL;
  const extensionTarget = path.join(localAppData, 'YTX', 'browser-extension');
  const bridgeTarget = path.join(appData, 'Adobe', 'CEP', 'extensions', 'YTX-Bridge');

  function roots() {
    return [
      process.env.LOCALAPPDATA,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.APPDATA
    ].filter(Boolean);
  }

  function regQuery(key, valueName) {
    try {
      const args = ['QUERY', `HKCU\\${key}`];
      if (valueName === '') args.push('/ve');
      else args.push('/v', valueName);
      const output = execFileSync('reg.exe', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const match = output.match(/REG_\w+\s+(.*)\r?$/m);
      return match ? match[1].trim() : '';
    } catch { return ''; }
  }

  function regSet(key, valueName, value) {
    try {
      execFileSync('reg.exe', ['ADD', `HKCU\\${key}`, '/v', valueName, '/t', 'REG_SZ', '/d', String(value), '/f'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      const detail = String(error.stderr || '').replace(/^ERROR:\s*/i, '').split(/\r?\n/)[0].replace(/\.\s*$/, '').trim();
      throw new Error(detail ? `Windows blocked the registry write: ${detail.toLowerCase()}.` : 'Windows blocked the registry write.');
    }
  }

  function regDelete(key, valueName) {
    try { execFileSync('reg.exe', ['DELETE', `HKCU\\${key}`, '/v', valueName, '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  }

  function regDeleteTree(key) {
    try { execFileSync('reg.exe', ['DELETE', `HKCU\\${key}`, '/f'], { windowsHide: true, stdio: 'ignore' }); } catch {}
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

  function readExtensionInfo() {
    const manifestPath = path.join(extensionSource, 'manifest.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`The bundled browser extension is missing: ${manifestPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let extensionId = '';
    if (manifest.key) {
      const publicKey = Buffer.from(manifest.key, 'base64');
      const digest = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 32);
      extensionId = digest.replace(/[0-9a-f]/g, character => String.fromCharCode(97 + parseInt(character, 16)));
    }
    if (!extensionId) {
      try { extensionId = fs.readFileSync(path.join(extensionSource, 'extension-id.txt'), 'utf8').trim(); } catch {}
    }
    return { manifest, extensionId, version: manifest.version || '', target: extensionTarget };
  }

  function copyDirectory(source, target) {
    if (!fs.existsSync(source)) throw new Error(`Missing integration resources: ${source}`);
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
  }

  function findPolicySlot(policyKey, entry) {
    for (let slot = 1; slot <= 60; slot++) {
      const existing = regQuery(`${policyKey}\\ExtensionInstallForcelist`, String(slot));
      if (!existing) return { slot, existing: false };
      if (existing.toLowerCase() === entry.toLowerCase()) return { slot, existing: true };
    }
    return null;
  }

  function installPolicy(browser, extensionId) {
    if (!browser.policy) return { ok: false, browser: browser.id, name: browser.name, message: 'This browser does not expose a managed policy key.' };
    const entry = `${extensionId};${updateUrl}`;
    const policyKey = `${browser.policy}\\ExtensionInstallForcelist`;
    const found = findPolicySlot(browser.policy, entry);
    if (!found) return { ok: false, browser: browser.id, name: browser.name, message: 'The browser policy already contains 60 extension rules.' };
    regSet(policyKey, String(found.slot), entry);
    const verified = regQuery(policyKey, String(found.slot));
    if (verified.toLowerCase() !== entry.toLowerCase()) return { ok: false, browser: browser.id, name: browser.name, message: 'Windows could not write the browser policy.' };
    regSet(`${POLICY_MARKER}\\Policies\\${browser.id}`, 'Key', browser.policy);
    regSet(`${POLICY_MARKER}\\Policies\\${browser.id}`, 'ValueName', String(found.slot));
    regSet(`${POLICY_MARKER}\\Policies\\${browser.id}`, 'Entry', entry);
    return { ok: true, browser: browser.id, name: browser.name, slot: found.slot, existing: found.existing, message: found.existing ? 'Already installed by YTX.' : 'Extension policy installed.' };
  }

  function installBrowserExtension(request = {}) {
    try {
      const info = readExtensionInfo();
      if (!info.extensionId) return { error: 'The extension package has no signing key. Rebuild the YTX installer.' };
      copyDirectory(extensionSource, extensionTarget);
      fs.writeFileSync(path.join(extensionTarget, 'extension-id.txt'), info.extensionId + '\n', 'utf8');
      fs.writeFileSync(path.join(extensionTarget, 'updates.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n  <app appid="${info.extensionId}">\n    <updatecheck codebase="${crxUrl}" version="${info.version}" />\n  </app>\n</gupdate>\n`, 'utf8');

      const detected = detectBrowsers();
      const requested = Array.isArray(request.browserIds) && request.browserIds.length
        ? new Set(request.browserIds)
        : new Set(detected.filter(item => item.installed).map(item => item.id));
      const results = [];
      for (const browser of detected) {
        if (!requested.has(browser.id)) continue;
        if (!browser.installed) {
          results.push({ ok: false, browser: browser.id, name: browser.name, message: 'Browser not detected.' });
          continue;
        }
        try { results.push(installPolicy(browser, info.extensionId)); }
        catch (error) { results.push({ ok: false, browser: browser.id, name: browser.name, message: `Policy write failed: ${error.message}` }); }
      }

      const successful = results.filter(item => item.ok);
      if (successful.length) {
        try {
          regSet(POLICY_MARKER, 'ExtensionId', info.extensionId);
          regSet(POLICY_MARKER, 'UpdateUrl', updateUrl);
          regSet(POLICY_MARKER, 'InstalledAt', new Date().toISOString());
          regSet(POLICY_MARKER, 'Browsers', successful.map(item => item.browser).join(','));
        } catch {}
      } else {
        regDeleteTree(POLICY_MARKER);
      }
      return {
        ok: successful.length > 0,
        extensionId: info.extensionId,
        version: info.version,
        path: extensionTarget,
        updateUrl,
        results,
        restartedBrowserRequired: successful.length > 0,
        message: successful.length
          ? `YTX ${info.version} was registered in ${successful.map(item => item.name).join(', ')}. Restart those browsers; the extension opens automatically on YouTube.`
          : results.length
            ? 'Windows blocked automatic browser setup. Turn on Developer mode and use Load unpacked with the extension folder below, or re-run YTX setup as this user.'
            : 'No supported browser was found. Open the extension folder and use Load unpacked as a fallback.'
      };
    } catch (error) {
      return { error: `Could not install the browser extension: ${error.message}` };
    }
  }

  function removeBrowserExtension() {
    const info = readExtensionInfo();
    const policies = [];
    for (const browser of BROWSERS) {
      const storedKey = regQuery(`${POLICY_MARKER}\\Policies\\${browser.id}`, 'Key') || browser.policy;
      const storedSlot = regQuery(`${POLICY_MARKER}\\Policies\\${browser.id}`, 'ValueName');
      const entry = regQuery(`${POLICY_MARKER}\\Policies\\${browser.id}`, 'Entry') || `${info.extensionId};${updateUrl}`;
      if (storedSlot) {
        const current = regQuery(`${storedKey}\\ExtensionInstallForcelist`, storedSlot);
        if (!current || current.toLowerCase() === entry.toLowerCase()) regDelete(`${storedKey}\\ExtensionInstallForcelist`, storedSlot);
        policies.push({ browser: browser.id, removed: true });
      }
    }
    // Also clean values left by the NSIS installer or an older YTX build.
    for (const browser of BROWSERS) {
      for (let slot = 1; slot <= 60; slot++) {
        const current = regQuery(`${browser.policy}\\ExtensionInstallForcelist`, String(slot));
        if (!current) continue;
        if (current.toLowerCase().includes(info.extensionId.toLowerCase())) regDelete(`${browser.policy}\\ExtensionInstallForcelist`, String(slot));
      }
    }
    regDeleteTree(POLICY_MARKER);
    return { ok: true, policies };
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
        regSet(`Software\\Adobe\\CSXS.${version}`, 'PlayerDebugMode', '1');
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
    for (let version = 9; version <= 14; version++) debug[`CSXS.${version}`] = regQuery(`Software\\Adobe\\CSXS.${version}`, 'PlayerDebugMode');
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

  function getBrowserExtensionStatus() {
    let info = null;
    try { info = readExtensionInfo(); } catch (error) { return { installed: false, error: error.message }; }
    const policies = [];
    for (const browser of BROWSERS) {
      let installed = false;
      for (let slot = 1; slot <= 60; slot++) {
        const current = regQuery(`${browser.policy}\\ExtensionInstallForcelist`, String(slot));
        if (current.toLowerCase().includes(info.extensionId.toLowerCase())) { installed = true; break; }
      }
      policies.push({ id: browser.id, name: browser.name, installed });
    }
    return { installed: fs.existsSync(path.join(extensionTarget, 'manifest.json')), path: extensionTarget, extensionId: info.extensionId, version: info.version, updateUrl, policies };
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
    detectAdobeHosts,
    installAdobeBridge,
    getAdobeBridgeStatus,
    writeBridgeConfig,
    isProcessRunning,
    paths: { extensionSource, extensionTarget, adobeSource, bridgeTarget }
  };
}

module.exports = { createIntegrationManager, EXTENSION_UPDATE_URL, EXTENSION_CRX_URL };
