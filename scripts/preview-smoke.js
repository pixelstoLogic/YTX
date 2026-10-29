/* Temporary preview smoke: verify 4K label and online audio/mute over CDP. */
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const port = 9334;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tmp = process.env.TEMP + '\\opencode';
const clip = path.join(tmp, 'ytx-preview-clip.mp4');
const tone = path.join(tmp, 'ytx-preview-tone.mp3');

if (!require('node:fs').existsSync(clip)) {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', clip]);
}
if (!require('node:fs').existsSync(tone)) {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=550:duration=4', '-ar', '44100', '-ac', '2', tone]);
}

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
  const target = targets.find(t => t.type === 'page' && t.url.includes('index.html'));
  if (!target) throw new Error('no page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  const send = (method, params = {}) => new Promise(resolve => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    const value = result.result?.value ?? result.result?.result?.value;
    if (value === undefined) console.error('[smoke-eval] undefined response keys', Object.keys(result.result || {}), JSON.stringify(result.result?.result || '').slice(0, 200));
    return value;
  };

  const toUrl = value => 'file:///' + encodeURI(value.replace(/\\/g, '/')).replace(/#/g, '%23');
  // Local 4K load
  await evaluate(`loadMedia({ path: ${JSON.stringify(tmp + '\\ytx-ui-source-4k.mp4')}, url: ${JSON.stringify(toUrl(tmp + '\\ytx-ui-source-4k.mp4'))} })`);
  await sleep(2200);
  const fourK = await evaluate(`(() => ({ resolution: document.getElementById('resolution').textContent, meta: document.getElementById('sequenceMeta').textContent, w: sourceWidth, h: sourceHeight, ready: document.getElementById('video').readyState }))()`);
  // Online-style preview with external audio track
  await evaluate(`loadOnline({ title: 'Preview audio test', duration: 4, videoFormats: [], audioFormats: [], url: ${JSON.stringify(toUrl(clip))}, audioUrl: ${JSON.stringify(toUrl(tone))}, hasAudio: true, sourceWidth: 1920, sourceHeight: 1080 })`);
  await sleep(2600);
  const online = await evaluate(`(() => {
    const a = document.getElementById('previewAudio');
    return { videoPlaying: !document.getElementById('video').paused, audioHasSrc: Boolean(a.src), audioPaused: a.paused, audioTime: a.currentTime, audioMuted: a.muted, videoMuted: document.getElementById('video').muted, buttonHasIcon: document.getElementById('muteBtn').innerHTML.length > 40 };
  })()`);
  await evaluate(`document.getElementById('muteBtn').click()`);
  const muted = await evaluate(`(() => ({ muted: previewMuted, audioMuted: document.getElementById('previewAudio').muted, videoMuted: document.getElementById('video').muted, icon: document.getElementById('muteBtn').querySelector('svg path')?.getAttribute('d').slice(0, 12), pressed: document.getElementById('muteBtn').getAttribute('aria-pressed') }))()`);
  await evaluate(`document.getElementById('muteBtn').click()`);
  const unmuted = await evaluate(`(() => ({ muted: previewMuted, audioMuted: document.getElementById('previewAudio').muted, videoMuted: document.getElementById('video').muted }))()`);
  await evaluate(`pausePreview?.()`);
  console.log(JSON.stringify({ fourK, online, muted, unmuted }, null, 2));
  ws.close();
}

main().catch(error => { console.error(error); process.exit(1); });
