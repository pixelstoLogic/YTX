/* Temporary UI smoke test: drive the real Electron renderer over CDP. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = 9334;
const outDir = path.join(os.tmpdir(), 'opencode', 'ytx-ui-shots');
fs.mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
      const page = targets.find(target => target.type === 'page' && target.url.includes('index.html'));
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('renderer target not found');
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  return { ws, send };
}

async function main() {
  const target = await pageTarget();
  console.log('[smoke] renderer target', target.id);
  const { ws, send } = await connect(target);
  console.log('[smoke] connected');
  await send('Runtime.enable');
  await send('Page.enable');

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    return result.result?.value;
  }
  async function viewport(width, height = 900) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await sleep(180);
  }
  async function shot(name) {
    
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(outDir, name + '.png');
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    return file;
  }
  for (let i = 0; i < 80; i++) {
    const ready = await evaluate(`Boolean(window.studio) && !document.getElementById('splash').classList.contains('splash-hidden') === false`);
    if (ready) break;
    await sleep(250);
  }
  await sleep(600);
  console.log('[smoke] renderer ready');

  const report = { options: {}, responsive: [], converter: [], scan: {}, preview: {} };

  report.options = await evaluate(`(() => {
    const names = ['videoContainer','videoCodec','colorProfile','audioContainer','audioCodec','audioQuality'];
    const out = {};
    for (const id of names) {
      const select = document.getElementById(id);
      out[id] = [...select.options].filter(o => o.value).map(o => o.textContent.trim());
    }
    out.videoCodecDisabled = [...document.getElementById('videoCodec').options].filter(o => o.disabled).map(o => o.value);
    return out;
  })()`);

  for (const width of [1500, 1200, 1060, 900, 860, 780, 720]) {
    await viewport(width);
    console.log('[smoke] editor', width);
    const metrics = await evaluate(`(() => {
      const items = ['.left-panel','.center-column','.right-panel'].map(selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { selector, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
      });
      const workspace = document.querySelector('.workspace');
      const topbar = document.querySelector('.topbar');
      let overlaps = 0;
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 1 && oy > 1) overlaps++;
      }
      return { width: innerWidth, columns: getComputedStyle(workspace).gridTemplateColumns, items, overlaps,
        scrollWidth: document.documentElement.scrollWidth, topbarOverflow: topbar.scrollWidth > topbar.clientWidth + 1,
        workspaceScrollable: workspace.scrollHeight > workspace.clientHeight + 1 };
    })()`);
    report.responsive.push(metrics);
  }

  const testVideo = path.join(os.tmpdir(), 'opencode', 'ytx-ui-source-4k.mp4');
  if (!fs.existsSync(testVideo)) {
    const { execFileSync } = require('node:child_process');
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', testVideo]);
  }
  await evaluate(`loadMedia({ path: ${JSON.stringify(testVideo)} })`);
  console.log('[smoke] 4K preview loading');
  await sleep(2500);
  report.preview = await evaluate(`(() => ({
    resolution: document.getElementById('resolution').textContent,
    sequenceMeta: document.getElementById('sequenceMeta').textContent,
    audioUrl: document.getElementById('previewAudio').currentSrc || document.getElementById('previewAudio').src,
    hasAudio: previewHasAudio,
    muted: previewMuted,
    videoReady: document.getElementById('video').readyState,
    sourceWidth, sourceHeight
  }))()`);
  await evaluate(`document.getElementById('muteBtn').click()`);
  report.preview.afterMute = await evaluate(`(() => ({ muted: previewMuted, audioMuted: document.getElementById('previewAudio').muted, pressed: document.getElementById('muteBtn').getAttribute('aria-pressed'), className: document.getElementById('muteBtn').className }))()`);
  await evaluate(`document.getElementById('muteBtn').click()`);

  await viewport(900);
  await evaluate(`document.getElementById('scanSystemBtn').click()`);
  console.log('[smoke] scan modal opening');
  await sleep(1200);
  report.scan.open = await evaluate(`(() => {
    const modal = document.getElementById('systemScanModal');
    const dialog = document.querySelector('.scan-dialog').getBoundingClientRect();
    return { open: !modal.classList.contains('hidden'), width: Math.round(dialog.width), height: Math.round(dialog.height),
      stats: document.querySelectorAll('.scan-stat').length, apps: document.querySelectorAll('#systemApps li').length,
      scrollTop: document.getElementById('scanModalBody').scrollTop, focused: document.activeElement.id };
  })()`);
  await evaluate(`document.getElementById('scanModalBody').scrollTop = 600; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  report.scan.afterEscape = await evaluate(`document.getElementById('systemScanModal').classList.contains('hidden')`);
  await evaluate(`document.getElementById('scanSystemBtn').click()`);
  await sleep(500);
  report.scan.reopen = await evaluate(`(() => ({ open: !document.getElementById('systemScanModal').classList.contains('hidden'), scrollTop: document.getElementById('scanModalBody').scrollTop }))()`);
  
  await evaluate(`document.getElementById('scanModalClose').click()`);

  await evaluate(`document.getElementById('converterModeBtn').click()`);
  console.log('[smoke] converter workspace');
  await sleep(400);
  for (const width of [1500, 1366, 920, 860, 720]) {
    await viewport(width);
    const metrics = await evaluate(`(() => {
      const workspace = document.getElementById('converterWorkspace');
      const queue = document.querySelector('.converter-queue-panel').getBoundingClientRect();
      const side = document.querySelector('.converter-side').getBoundingClientRect();
      return { width: innerWidth, columns: getComputedStyle(document.querySelector('.converter-layout')).gridTemplateColumns,
        scrollWidth: document.documentElement.scrollWidth, scrollable: workspace.scrollHeight > workspace.clientHeight + 1,
        queue: { x: Math.round(queue.x), y: Math.round(queue.y), w: Math.round(queue.width), h: Math.round(queue.height) },
        side: { x: Math.round(side.x), y: Math.round(side.y), w: Math.round(side.width), h: Math.round(side.height) },
        overlap: Math.min(queue.x + queue.width, side.x + side.width) > Math.max(queue.x, side.x) && Math.min(queue.y + queue.height, side.y + side.height) > Math.max(queue.y, side.y) };
    })()`);
    report.converter.push(metrics);
  }

  await send('Emulation.clearDeviceMetricsOverride');
  ws.close();
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
