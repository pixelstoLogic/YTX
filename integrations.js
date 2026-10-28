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
    const errors = [];

    // Machine policy survives user changes and needs no Developer mode. It is
    // the primary path; a per-user policy is only a fallback on locked PCs.
    const machine = findPolicySlot('HKLM', browser.policy, entry);
    if (machine) {
      try {
        regSet('HKLM', policyKey, String(machine.slot), entry);
        if (regQuery('HKLM', policyKey, String(machine.slot)).toLowerCase() === entry.toLowerCase()) {
          writePolicyMarker('HKLM', browser, entry, machine.slot);
          return policyResult(browser, machine, 'HKLM');
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
          writePolicyMarker('HKCU', browser, entry, user.slot);
          return policyResult(browser, user, 'HKCU');
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
      return verified.toLowerCase() === item.entry.toLowerCase()
        ? { ok: true, browser: item.browser, name: item.name, scope: 'machine', elevated: true, slot: item.slot, message: 'Extension policy installed with administrator approval.' }
        : { ok: false, browser: item.browser, name: item.name, needsElevation: true, message: 'Windows accepted the request but the machine policy is not present.' };
    });
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
        scope: machineSuccess.length ? 'machine' : userSuccess.length ? 'user' : '',
        elevated,
        results,
        restartedBrowserRequired: successful.length > 0,
        needsElevation,
        message: successful.length
          ? `YTX ${info.version} is registered in ${names}. Restart ${successful.length === 1 ? 'that browser' : 'those browsers'} to finish installation.`
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
          else regDelete('HKCU', `${browser.policy}\\ExtensionInstallForcelist`, String(slot));
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

  function getBrowserExtensionStatus() {
    let info = null;
    try { info = readExtensionInfo(); } catch (error) { return { installed: false, error: error.message }; }
    const policies = [];
    for (const browser of BROWSERS) {
      let installed = false;
      let scope = '';
      for (const root of ['HKLM', 'HKCU']) {
        for (let slot = 1; slot <= 60; slot++) {
          const current = regQuery(root, `${browser.policy}\\ExtensionInstallForcelist`, String(slot));
          if (current.toLowerCase().includes(info.extensionId.toLowerCase())) { installed = true; scope = root === 'HKLM' ? 'machine' : 'user'; break; }
        }
        if (installed) break;
      }
      policies.push({ id: browser.id, name: browser.name, installed, scope });
    }
    const machine = policies.filter(item => item.scope === 'machine');
    return {
      installed: fs.existsSync(path.join(extensionTarget, 'manifest.json')),
      path: extensionTarget,
      extensionId: info.extensionId,
      version: info.version,
      updateUrl,
      policies,
      scope: machine.length ? 'machine' : policies.some(item => item.scope === 'user') ? 'user' : '',
      registered: policies.some(item => item.installed)
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
    detectAdobeHosts,
    installAdobeBridge,
    getAdobeBridgeStatus,
    writeBridgeConfig,
    isProcessRunning,
    paths: { extensionSource, extensionTarget, adobeSource, bridgeTarget }
  };
}

module.exports = { createIntegrationManager, EXTENSION_UPDATE_URL, EXTENSION_CRX_URL };
