const $ = id => document.getElementById(id);
const video = $('video');
const FPS = 30;
const FRAME = 1 / FPS;
let mediaPath = '', remoteUrl = '', duration = 0, inPoint = 0, outPoint = 0, fullRange = false, format = 'video', zoom = 1;
let scrubbing = false, scrubPending = null, scrubFrame = 0, pendingSeek = null, availableFormats = { video: [], audio: [] };

function time(s, frames = false) {
  if (!Number.isFinite(s)) s = 0;
  if (frames) {
    const total = Math.max(0, Math.round(s * FPS));
    const h = Math.floor(total / (3600 * FPS));
    const m = Math.floor(total / (60 * FPS)) % 60;
    const sec = Math.floor(total / FPS) % 60;
    const f = total % FPS;
    return [h, m, sec, f].map(v => String(v).padStart(2, '0')).join(':');
  }
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60);
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
}
function parseTimecode(value) {
  const match = /^\s*(\d{1,4}):(\d{2}):(\d{2}):(\d{2})\s*$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]), s = Number(match[3]), f = Number(match[4]);
  if (m > 59 || s > 59 || f >= FPS) return null;
  return h * 3600 + m * 60 + s + f / FPS;
}
function pct(s) { return duration ? Math.max(0, Math.min(100, s / duration * 100)) : 0; }
function paint() {
  $('currentTime').textContent = time(video.currentTime, true);
  $('duration').textContent = time(duration, true);
  $('playhead').style.left = pct(scrubbing && scrubPending !== null ? scrubPending : video.currentTime) + '%';
  $('selection').style.left = pct(inPoint) + '%';
  $('selection').style.right = (100 - pct(outPoint)) + '%';
  if (document.activeElement !== $('inTc')) $('inTc').value = time(inPoint, true);
  if (document.activeElement !== $('outTc')) $('outTc').value = time(outPoint, true);
  $('selDuration').textContent = time(Math.max(0, outPoint - inPoint));
  $('exportIn').textContent = time(fullRange ? 0 : inPoint);
  $('exportOut').textContent = time(fullRange ? duration : outPoint);
}
function showTimeline(name) {
  $('clipName').textContent = name;
  $('clipBlock').style.display = 'block';
  $('selection').style.display = 'block';
  document.querySelector('.empty-track').style.display = 'none';
  $('mediaCount').textContent = '01';
}
function escapeHtml(v) { return v.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function loadMedia(file) {
  mediaPath = file.path; remoteUrl = ''; duration = 0; inPoint = 0; outPoint = 0; fullRange = false;
  availableFormats = { video: [], audio: [] };
  $('downloadQualityWrap').classList.add('hidden'); $('videoQuality').value = '20'; $('audioQuality').value = '192';
  video.crossOrigin = ''; video.src = file.url; $('viewer').classList.add('has-video'); $('videoLoading').classList.remove('hidden');
  $('sourceLabel').textContent = 'LOCAL FILE'; $('mediaItem').className = 'source-card loaded-media';
  const name = file.path.split(/[\\/]/).pop();
  $('mediaItem').innerHTML = '<div class="file-icon">▣</div><div class="loaded-info"><strong>' + escapeHtml(name) + '</strong><small>Ready to edit · Local media</small></div><span class="media-check">✓</span>';
  showTimeline(name); $('projectName').textContent = name; chooseFormat(format); paint();
}
function loadOnline(info, sourceUrl) {
  mediaPath = ''; remoteUrl = sourceUrl; duration = Number(info.duration) || 0; inPoint = 0; outPoint = duration; fullRange = false;
  availableFormats = { video: info.videoFormats || [], audio: info.audioFormats || [] };
  fillQuality('downloadQuality', availableFormats.video, 'height'); $('downloadQualityWrap').classList.remove('hidden');
  video.crossOrigin = ''; video.src = info.url; $('viewer').classList.add('has-video'); $('videoLoading').classList.remove('hidden');
  $('sourceLabel').textContent = 'ONLINE PREVIEW'; $('mediaItem').className = 'source-card loaded-media';
  $('mediaItem').innerHTML = '<div class="youtube-icon">▶</div><div class="loaded-info"><strong>' + escapeHtml(info.title || 'Online video') + '</strong><small>Streaming preview · not downloaded</small></div><span class="media-check">↗</span>';
  showTimeline(info.title || 'Online video'); $('projectName').textContent = info.title || 'Online video';
  $('resolution').textContent = info.width && info.height ? info.width + ' × ' + info.height : 'ONLINE';
  chooseFormat(format); paint(); video.play().catch(() => {});
}
function fillQuality(id, formats, prop) {
  const select = $(id), previous = select.value;
  select.innerHTML = '<option value="">Best available</option>';
  formats.forEach(item => { const option = document.createElement('option'); option.value = item[prop] || ''; option.textContent = item.label; select.appendChild(option); });
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}
function applyTimecode(which) {
  const input = which === 'in' ? $('inTc') : $('outTc');
  const parsed = parseTimecode(input.value);
  if (parsed === null) { input.classList.add('invalid'); return false; }
  input.classList.remove('invalid');
  const value = Math.max(0, duration ? Math.min(duration, parsed) : parsed);
  if (which === 'in') {
    inPoint = duration ? Math.min(value, Math.max(0, duration - FRAME)) : value;
    if (outPoint <= inPoint) outPoint = inPoint + FRAME;
  } else outPoint = Math.max(value, inPoint + FRAME);
  fullRange = false; paint(); return true;
}
for (const [id, which] of [['inTc', 'in'], ['outTc', 'out']]) {
  const input = $(id);
  input.addEventListener('change', () => { if (!applyTimecode(which)) input.value = time(which === 'in' ? inPoint : outPoint, true); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { applyTimecode(which); input.blur(); } });
  input.addEventListener('blur', () => { if (!applyTimecode(which)) input.value = time(which === 'in' ? inPoint : outPoint, true); });
}

video.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    duration = video.duration;
    inPoint = Math.min(inPoint, Math.max(0, duration - FRAME));
    outPoint = Math.min(outPoint || duration, duration);
  }
  $('videoLoading').classList.add('hidden'); $('resolution').textContent = video.videoWidth + ' × ' + video.videoHeight;
  if (pendingSeek !== null) { video.currentTime = Math.min(duration, pendingSeek); pendingSeek = null; } paint();
});
video.addEventListener('canplay', () => $('videoLoading').classList.add('hidden'));
video.addEventListener('waiting', () => $('videoLoading').classList.remove('hidden'));
video.addEventListener('error', () => $('videoLoading').classList.add('hidden'));
video.addEventListener('timeupdate', () => { paint(); if (video.currentTime >= outPoint && !video.paused) { video.pause(); video.currentTime = outPoint; } });
function setPlayButton(playing) {
  $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('playBtn').title = playing ? 'Pause' : 'Play';
  $('playBtn').innerHTML = playing
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 12 7-12 7z"/></svg>';
}
video.addEventListener('play', () => setPlayButton(true));
video.addEventListener('pause', () => setPlayButton(false));
$('playBtn').onclick = () => video.paused ? video.play() : video.pause();
$('backBtn').onclick = () => video.currentTime = Math.max(0, video.currentTime - 5);
$('forwardBtn').onclick = () => video.currentTime = Math.min(duration, video.currentTime + 5);
$('markIn').onclick = () => { inPoint = Math.min(video.currentTime, Math.max(0, outPoint - FRAME)); fullRange = false; paint(); };
$('markOut').onclick = () => { outPoint = Math.max(video.currentTime, Math.min(duration, inPoint + FRAME)); fullRange = false; paint(); };
$('fullscreenBtn').onclick = () => {
  const viewer = $('viewer');
  if (document.fullscreenElement) document.exitFullscreen?.();
  else viewer.requestFullscreen?.();
};

function scrubToPointer(event) {
  const rect = $('trackCanvas').getBoundingClientRect();
  if (!rect.width) return;
  if (!duration) { pendingSeek = 0; return; }
  scrubPending = Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration));
  paint();
  if (!scrubFrame) scrubFrame = requestAnimationFrame(() => { scrubFrame = 0; if (video.readyState >= 1) video.currentTime = scrubPending; else pendingSeek = scrubPending; });
}
const canvas = $('trackCanvas');
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('.handle')) return;
  event.preventDefault(); video.pause(); scrubbing = true;
  try { canvas.setPointerCapture(event.pointerId); } catch {}
  scrubToPointer(event);
});
canvas.addEventListener('pointermove', event => { if (scrubbing) scrubToPointer(event); });
function stopScrub(event) {
  if (!scrubbing) return;
  scrubbing = false;
  if (scrubFrame) { cancelAnimationFrame(scrubFrame); scrubFrame = 0; }
  if (scrubPending !== null) { if (video.readyState >= 1) video.currentTime = scrubPending; else pendingSeek = scrubPending; }
  scrubPending = null; paint();
  try { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } catch {}
}
canvas.addEventListener('pointerup', stopScrub);
canvas.addEventListener('pointercancel', stopScrub);

for (const handle of document.querySelectorAll('.handle')) {
  let moveHandler;
  const stop = event => {
    if (moveHandler) handle.removeEventListener('pointermove', moveHandler);
    moveHandler = null;
    try { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch {}
  };
  handle.addEventListener('pointerdown', event => {
    event.stopPropagation(); event.preventDefault(); video.pause();
    try { handle.setPointerCapture(event.pointerId); } catch {}
    moveHandler = ev => {
      const rect = canvas.getBoundingClientRect();
      const point = Math.max(0, Math.min(duration, (ev.clientX - rect.left) / rect.width * duration));
      if (handle.classList.contains('left')) inPoint = Math.min(point, outPoint - FRAME);
      else outPoint = Math.max(point, inPoint + FRAME);
      fullRange = false; paint();
    };
    handle.addEventListener('pointermove', moveHandler);
  });
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

$('rangeSelection').onclick = () => { fullRange = false; $('rangeSelection').classList.add('active'); $('rangeFull').classList.remove('active'); paint(); };
$('rangeFull').onclick = () => { fullRange = true; $('rangeFull').classList.add('active'); $('rangeSelection').classList.remove('active'); paint(); };
function chooseFormat(f) {
  format = f; $('videoFormat').classList.toggle('selected', f === 'video'); $('audioFormat').classList.toggle('selected', f === 'audio');
  $('exportBtn').innerHTML = (remoteUrl ? 'Download' : 'Export') + ' ' + (f === 'video' ? 'video' : 'audio') + ' <span>↗</span>';
  for (const id of ['videoContainer','videoCodec','colorProfile','videoQuality']) $(id).disabled = f !== 'video';
  $('audioContainer').disabled = f !== 'audio';
  $('audioQuality').disabled = f !== 'audio';
  $('audioCodec').disabled = false;
  $('downloadQuality').disabled = f !== 'video';
  syncCodecCompatibility();
}
function syncCodecCompatibility() {
  const videoAllowed = { mp4: ['h264','hevc','av1','mpeg4','copy'], mov: ['h264','hevc','prores','mpeg4','copy'], mkv: ['h264','hevc','av1','vp9','prores','mpeg4','copy'], webm: ['av1','vp9','copy'], avi: ['h264','mpeg4','copy'], m4v: ['h264','hevc','mpeg4','copy'], ts: ['h264','hevc','mpeg4','copy'] };
  const audioAllowed = { mp3: ['mp3','copy'], m4a: ['aac','copy'], wav: ['pcm','copy'], flac: ['flac','copy'], ogg: ['vorbis','opus','copy'], opus: ['opus','copy'] };
  const audioForVideo = { mp4: ['aac','mp3','copy'], mov: ['aac','mp3','pcm','copy'], mkv: ['aac','mp3','opus','vorbis','flac','pcm','copy'], webm: ['opus','vorbis','copy'], avi: ['mp3','pcm','copy'], m4v: ['aac','mp3','copy'], ts: ['aac','mp3','copy'] };
  function limit(id, allowed) {
    const select = $(id); for (const option of select.options) option.disabled = !allowed.includes(option.value);
    if (!allowed.includes(select.value)) select.value = allowed[0];
  }
  limit('videoCodec', videoAllowed[$('videoContainer').value] || videoAllowed.mp4);
  limit('audioCodec', format === 'audio' ? (audioAllowed[$('audioContainer').value] || audioAllowed.mp3) : (audioForVideo[$('videoContainer').value] || audioForVideo.mp4));
  if ($('videoCodec').value === 'copy') { $('colorProfile').value = 'preserve'; $('colorProfile').disabled = true; }
  else $('colorProfile').disabled = format !== 'video';
  $('videoFormat').querySelector('small').textContent = `${$('videoContainer').value.toUpperCase()} · ${$('videoCodec').selectedOptions[0].textContent} + ${$('audioCodec').selectedOptions[0].textContent}`;
  $('videoFormat').querySelector('.format-tag').textContent = `.${$('videoContainer').value.toUpperCase()}`;
  $('audioFormat').querySelector('small').textContent = `${$('audioContainer').value.toUpperCase()} · ${$('audioCodec').selectedOptions[0].textContent} · ${$('audioQuality').value} kbps`;
  $('audioFormat').querySelector('.format-tag').textContent = `.${$('audioContainer').value.toUpperCase()}`;
}
$('videoFormat').onclick = () => chooseFormat('video');
$('audioFormat').onclick = () => chooseFormat('audio');
$('videoContainer').addEventListener('change', syncCodecCompatibility);
$('audioContainer').addEventListener('change', syncCodecCompatibility);
$('videoCodec').addEventListener('change', syncCodecCompatibility);
$('audioCodec').addEventListener('change', syncCodecCompatibility);
$('audioQuality').addEventListener('change', syncCodecCompatibility);
$('zoomIn').onclick = () => { zoom = Math.min(2, zoom + .1); $('zoomThumb').style.left = (zoom - 1) * 80 + '%'; };
$('zoomOut').onclick = () => { zoom = Math.max(1, zoom - .1); $('zoomThumb').style.left = (zoom - 1) * 80 + '%'; };
$('downloadBtn').onclick = async () => {
  const url = $('urlInput').value.trim(), status = $('downloadStatus');
  if (!url) { status.textContent = 'Paste a video URL to preview it.'; status.className = 'status error'; return; }
  status.textContent = 'Connecting to Python bridge and resolving online preview…'; status.className = 'status'; $('downloadBtn').classList.add('busy');
  try { const result = await window.studio.resolveUrl(url); if (result.error) throw Error(result.error); loadOnline(result, url); status.textContent = 'Online preview ready. Set your range, then download the selected part.'; }
  catch (error) { status.textContent = error.message; status.className = 'status error'; }
  finally { $('downloadBtn').classList.remove('busy'); }
};
$('browseBtn').onclick = $('openBtn').onclick = async () => { const file = await window.studio.openMedia(); if (file) loadMedia(file); };
async function exportMedia(adobeTarget = '') {
  const status = $('exportStatus');
  if (!mediaPath && !remoteUrl) { status.textContent = 'Preview or open a video first.'; status.className = 'status error'; return; }
  const start = fullRange ? 0 : inPoint, end = fullRange ? duration : outPoint;
  if (end <= start) { status.textContent = 'Set a valid trim range.'; status.className = 'status error'; return; }
  status.textContent = remoteUrl ? 'Preparing selected range download…' : 'Exporting with FFmpeg…';
  status.className = 'status'; $('exportBtn').classList.add('busy');
  $('sendPremiere').disabled = $('sendAfterEffects').disabled = true;
  try {
    if (adobeTarget) {
      const bridge = await window.studio.getAdobeStatus();
      if (!bridge[adobeTarget]?.connected) throw Error(`${adobeTarget === 'premiere' ? 'Premiere Pro' : 'After Effects'} is not connected to YTX. Open a saved project, restart Adobe after installation if needed, then select Window → Extensions (Legacy) → YTX Bridge and retry.`);
    }
    const extension = format === 'video' ? $('videoContainer').value : $('audioContainer').value;
    const name = $('projectName').textContent || 'video';
    const options = { start, end, audio: format === 'audio', filename: name + '-trim.' + extension, format: extension, videoCodec: $('videoCodec').value, audioCodec: $('audioCodec').value, colorProfile: $('colorProfile').value, videoQuality: $('videoQuality').value, audioQuality: $('audioQuality').value };
    showProgress('Preparing export…');
    const result = remoteUrl ? await window.studio.downloadSection({ ...options, url: remoteUrl, title: name, videoFormat: $('downloadQuality').value, audioFormat: $('audioQuality').value }) : await window.studio.exportMedia({ ...options, input: mediaPath });
    if (result.canceled) { status.textContent = 'Export cancelled.'; return; }
    if (result.error) throw Error(result.error);
    if (!remoteUrl) { $('taskPercent').textContent = '100%'; $('taskBar').style.width = '100%'; $('taskMessage').textContent = 'Export complete'; $('taskMeta').textContent = 'FFmpeg finished rendering the selected range.'; }
    if (adobeTarget) {
      status.textContent = 'Opening ' + (adobeTarget === 'premiere' ? 'Premiere Pro' : 'After Effects') + ' and importing the exported media…';
      const imported = await window.studio.importToAdobe({ target: adobeTarget, path: result.path });
      if (imported.error) throw Error(imported.error);
      status.textContent = 'Sent to ' + (adobeTarget === 'premiere' ? 'Premiere Pro' : 'After Effects') + ': ' + result.path + (imported.note ? ' · ' + imported.note : '');
    } else status.textContent = (remoteUrl ? 'Selected part downloaded' : 'Export complete') + ': ' + result.path;
  } catch (error) { status.textContent = error.message; status.className = 'status error'; }
  finally { $('exportBtn').classList.remove('busy'); $('sendPremiere').disabled = $('sendAfterEffects').disabled = false; }
}
$('exportBtn').onclick = () => exportMedia();
$('exportVideoTop').onclick = () => { chooseFormat('video'); exportMedia(); };
function showWorkspace(name) {
  const converter = name === 'converter';
  $('editorWorkspace').classList.toggle('hidden', converter);
  $('converterWorkspace').classList.toggle('hidden', !converter);
  $('editorModeBtn').classList.toggle('active', !converter);
  $('converterModeBtn').classList.toggle('active', converter);
  if (converter) renderConversionTransfers();
}
$('editorModeBtn').onclick = $('backToEditorBtn').onclick = () => showWorkspace('editor');
$('converterModeBtn').onclick = () => showWorkspace('converter');
$('convertBatchBtn').onclick = () => showWorkspace('converter');
$('openTransferCenterBtn').onclick = () => openDownloadCenter('transfers');
async function startBatchConversion(options, statusNode, button) {
  statusNode.textContent = 'Choose one or more source files, then choose an output folder…'; statusNode.className = 'status';
  button.disabled = true;
  try {
    const result = await window.studio.convertBatch(options);
    if (result.canceled) { statusNode.textContent = 'Conversion cancelled.'; return; }
    if (result.error) throw Error(result.error);
    statusNode.textContent = `Converted ${result.files.length} file(s).`;
    renderConversionTransfers();
  } catch (error) { statusNode.textContent = error.message; statusNode.className = 'status error'; }
  finally { button.disabled = false; }
}
$('startConversionBtn').onclick = () => {
  const kind = $('convertKind').value, codec = $('convertCodec').value;
  const options = { kind, format: $('convertContainer').value, colorProfile: $('convertColor').value, videoCodec: kind === 'video' ? codec : $('videoCodec').value, audioCodec: kind === 'audio' ? codec : $('audioCodec').value, videoQuality: $('convertQuality').value, audioQuality: $('audioQuality').value };
  startBatchConversion(options, $('converterStatus'), $('startConversionBtn'));
};
$('sendPremiere').onclick = () => exportMedia('premiere');
$('sendAfterEffects').onclick = () => exportMedia('aftereffects');
paint();
window.studio.getBackendStatus().then(result => {
  const status = $('backendStatus'); status.textContent = result.ok ? 'running' : 'offline'; if (!result.ok) status.style.color = '#ff777f';
}).catch(() => { const status = $('backendStatus'); status.textContent = 'offline'; status.style.color = '#ff777f'; });

function showProgress(message) { $('taskProgress').classList.remove('hidden'); $('taskMessage').textContent = message; $('taskPercent').textContent = '0%'; $('taskBar').style.width = '3%'; $('taskMeta').textContent = ''; }
const transferHistory = (() => { try { return JSON.parse(localStorage.getItem('ytx-transfer-history') || '[]'); } catch { return []; } })();
for (const item of transferHistory) if (item.state === 'active') { item.state = 'failed'; item.error = 'Interrupted when YTX was closed.'; }
try { localStorage.setItem('ytx-transfer-history', JSON.stringify(transferHistory)); } catch {}
function saveTransferHistory() { try { localStorage.setItem('ytx-transfer-history', JSON.stringify(transferHistory.slice(0, 30))); } catch {} }
function renderTransfers() {
  const root = $('transferList'), active = transferHistory.filter(item => item.state === 'active').length;
  $('transferCount').textContent = String(active);
  $('downloadCenterBtn').dataset.active = String(active);
  root.replaceChildren();
  if (!transferHistory.length) { const empty = document.createElement('div'); empty.className = 'center-empty'; empty.textContent = 'Your downloads and conversions will appear here.'; root.appendChild(empty); return; }
  for (const item of transferHistory) {
    const row = document.createElement('article'); row.className = 'transfer-row';
    const icon = document.createElement('div'); icon.className = 'transfer-icon'; icon.textContent = item.type === 'update' ? '↻' : item.type === 'convert' ? '⇄' : '↓';
    const copy = document.createElement('div'); copy.className = 'transfer-copy';
    const title = document.createElement('strong'); title.textContent = item.title || (item.type === 'update' ? 'App update' : item.type === 'convert' ? 'Batch conversion' : 'Video download');
    const detail = document.createElement('small'); detail.textContent = item.error ? item.error : item.state === 'active' ? (item.message || 'Working…') : item.state === 'complete' ? (item.paths?.length ? item.paths.map(p => p.split(/[\\/]/).pop()).join(', ') : 'Completed') : 'Failed';
    copy.append(title, detail);
    if (item.state === 'active') { const track = document.createElement('div'); track.className = 'transfer-track'; const fill = document.createElement('i'); fill.style.width = `${Math.max(3, item.progress || 0)}%`; track.appendChild(fill); copy.appendChild(track); }
    const action = item.state === 'active' ? document.createElement('span') : document.createElement('button');
    if (action.tagName === 'BUTTON') { action.className = 'transfer-open'; action.textContent = item.state === 'complete' && item.paths?.length ? 'Show file' : 'Details'; action.disabled = !item.paths?.length; action.onclick = () => item.paths?.[0] && window.studio.revealFile(item.paths[0]); }
    else { action.className = 'transfer-percent'; action.textContent = `${Math.round(item.progress || 0)}%`; }
    row.append(icon, copy, action); root.appendChild(row);
  }
}
function renderConversionTransfers() {
  const root = $('conversionProgressList');
  if (!root) return;
  const items = transferHistory.filter(item => item.type === 'convert');
  root.replaceChildren();
  if (!items.length) { const empty = document.createElement('div'); empty.className = 'center-empty'; empty.textContent = 'Your conversions and progress will appear here.'; root.appendChild(empty); return; }
  for (const item of items) {
    const row = document.createElement('article'); row.className = 'conversion-row';
    const head = document.createElement('div'); head.className = 'conversion-row-head';
    const title = document.createElement('strong'); title.textContent = item.state === 'active' ? (item.message || 'Converting files…') : item.state === 'complete' ? 'Conversion complete' : 'Conversion failed';
    const percent = document.createElement('b'); percent.textContent = item.state === 'complete' ? '100%' : `${Math.round(item.progress || 0)}%`;
    head.append(title, percent); row.appendChild(head);
    const track = document.createElement('div'); track.className = 'conversion-track'; const fill = document.createElement('i'); fill.style.width = `${Math.max(3, item.progress || 0)}%`; track.appendChild(fill); row.appendChild(track);
    const detail = document.createElement('small'); detail.textContent = item.error || (item.paths?.length ? item.paths.map(p => p.split(/[\\/]/).pop()).join(', ') : item.state === 'active' ? (item.message || 'Preparing conversion…') : 'Finished'); row.appendChild(detail);
    root.appendChild(row);
  }
}
function recordTransfer(task) {
  let item = transferHistory.find(entry => entry.id === task.id);
  if (!item) { item = { id: task.id || `${Date.now()}`, type: task.type || 'download', title: task.message || '', state: 'active', progress: 0, paths: [], createdAt: Date.now() }; transferHistory.unshift(item); }
  item.type = task.type || item.type; item.title = item.type === 'update' ? 'YTX update installer' : item.type === 'convert' ? 'Batch conversion' : item.type === 'import' ? 'Adobe import' : (task.message || item.title); item.message = task.message || item.message; item.progress = task.progress ?? item.progress;
  if (task.path) item.paths = [task.path];
  if (task.files?.length) item.paths = task.files.map(file => file.path).filter(Boolean);
  if (task.done) { item.state = task.error ? 'failed' : 'complete'; item.error = task.error || ''; item.progress = task.error ? item.progress : 100; }
  while (transferHistory.length > 30) transferHistory.pop();
  saveTransferHistory(); renderTransfers(); renderConversionTransfers();
}
renderTransfers();
window.studio.onTaskProgress(task => {
  recordTransfer(task);
  $('taskProgress').classList.remove('hidden'); $('taskMessage').textContent = task.message || 'Working…';
  $('taskPercent').textContent = `${task.progress || 0}%`; $('taskBar').style.width = `${Math.max(3, task.progress || 0)}%`;
  const mb = n => `${(n / 1048576).toFixed(1)} MB`;
  $('taskMeta').textContent = task.total ? `${mb(task.downloaded || 0)} / ${mb(task.total)}${task.speed ? ` · ${(task.speed / 1048576).toFixed(1)} MB/s` : ''}${task.eta ? ` · ${task.eta}s left` : ''}` : (task.done ? 'Complete' : 'Connecting to stream…');
  if (task.done) { $('taskMessage').textContent = task.error ? 'Task failed' : 'Task complete'; if (task.error) $('taskMeta').textContent = task.error; }
  if (task.type === 'update') {
    const progress = $('updateDownloadProgress');
    progress.hidden = false;
    $('updateProgressFill').style.width = `${Math.max(3, task.progress || 0)}%`;
    $('updateProgressPercent').textContent = `${Math.round(task.progress || 0)}%`;
    const mb = n => `${(n / 1048576).toFixed(1)} MB`;
    $('updateProgressMeta').textContent = task.total ? `${mb(task.downloaded || 0)} / ${mb(task.total)}${task.speed ? ` · ${(task.speed / 1048576).toFixed(1)} MB/s` : ''}` : (task.error || task.message || 'Connecting to GitHub…');
    if (task.done && task.error) $('updateStatus').textContent = task.error;
  }
});
function openDownloadCenter(tab = 'transfers') { $('downloadCenter').classList.remove('hidden'); selectCenterTab(tab); }
function closeDownloadCenter() { $('downloadCenter').classList.add('hidden'); }
function selectCenterTab(name) {
  for (const tab of document.querySelectorAll('[data-center-tab]')) tab.classList.toggle('active', tab.dataset.centerTab === name);
  for (const pane of document.querySelectorAll('.center-pane')) pane.classList.toggle('hidden', pane.id !== `center${name[0].toUpperCase()}${name.slice(1)}`);
}
$('downloadCenterBtn').onclick = () => openDownloadCenter();
document.querySelectorAll('[data-center-close]').forEach(element => element.addEventListener('click', closeDownloadCenter));
document.querySelectorAll('[data-center-tab]').forEach(tab => tab.addEventListener('click', () => selectCenterTab(tab.dataset.centerTab)));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDownloadCenter(); });
$('clearTransfers').onclick = () => { for (let i = transferHistory.length - 1; i >= 0; i--) if (transferHistory[i].state !== 'active') transferHistory.splice(i, 1); saveTransferHistory(); renderTransfers(); };
let releaseInfo = null, installerPath = '';
function setUpdateBadge(show) { $('updateBadge').classList.toggle('hidden', !show); $('updateTabBadge').classList.toggle('hidden', !show); }
function renderReleaseHistory(releases) {
  const panel = $('releaseHistory'), list = $('releaseHistoryList');
  if (!Array.isArray(releases) || !releases.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden'); list.replaceChildren();
  for (const release of releases) {
    const row = document.createElement('div'); row.className = 'release-version' + (release.current ? ' current' : '');
    const meta = document.createElement('div'); meta.className = 'release-version-meta';
    const title = document.createElement('strong'); title.textContent = `YTX ${release.version}`;
    if (release.current) { const badge = document.createElement('span'); badge.className = 'release-badge'; badge.textContent = 'INSTALLED'; title.appendChild(badge); }
    else if (release.version === releaseInfo?.latestVersion) { const badge = document.createElement('span'); badge.className = 'release-badge'; badge.textContent = 'LATEST'; title.appendChild(badge); }
    const date = document.createElement('small'); date.textContent = release.publishedAt ? new Date(release.publishedAt).toLocaleDateString() : 'Release';
    meta.append(title, date);
    const action = document.createElement('button'); action.className = 'release-download';
    if (!release.asset) { action.textContent = 'No installer'; action.disabled = true; }
    else if (release.current) {
      action.textContent = 'Reinstall';
      action.addEventListener('click', () => downloadReleaseVersion(release, false));
    } else {
      const isLatest = release.version === releaseInfo?.latestVersion;
      action.textContent = isLatest ? 'Install latest' : 'Download';
      action.addEventListener('click', () => downloadReleaseVersion(release, isLatest));
    }
    row.append(meta, action);
    list.appendChild(row);
  }
}
async function downloadReleaseVersion(release, installLatest) {
  if (!release?.asset) return;
  $('updateDownloadProgress').hidden = false; $('updateProgressFill').style.width = '3%'; $('updateProgressPercent').textContent = '0%';
  $('updateStatus').textContent = `Downloading YTX ${release.version}…`;
  $('downloadUpdateBtn').disabled = true;
  try {
    const result = await window.studio.downloadRelease({ version: release.version, install: Boolean(installLatest) });
    if (result.error) throw Error(result.error);
    installerPath = result.path;
    $('updateStatus').textContent = result.installing
      ? `Download verified${result.digestVerified ? ' (SHA-256)' : ''}. Starting the YTX ${release.version} installer now—approve any Windows prompt to finish.`
      : `Verified YTX ${release.version} installer saved to ${installerPath}. Open it when you are ready to roll back or reinstall.`;
    if (!result.installing) $('openInstallerBtn').classList.remove('hidden');
  } catch (error) { $('updateStatus').textContent = error.message; }
  finally { $('downloadUpdateBtn').disabled = false; }
}
async function checkReleaseUpdate() {
  $('updateStatus').textContent = 'Checking GitHub releases…'; $('checkUpdatesBtn').disabled = true;
  try {
    releaseInfo = await window.studio.checkUpdates();
    if (releaseInfo.error) throw Error(releaseInfo.error);
    $('updateVersion').textContent = `Installed version ${releaseInfo.currentVersion || 'unknown'}`;
    $('updateTitle').textContent = releaseInfo.updated ? `YTX updated to ${releaseInfo.latestVersion}` : releaseInfo.available ? `YTX ${releaseInfo.latestVersion} is available` : 'You’re up to date';
    $('updateStatus').textContent = releaseInfo.updated ? `Update installed successfully. ${releaseInfo.message || ''}` : releaseInfo.available ? (releaseInfo.asset ? `${releaseInfo.asset.name} is the latest published build. YTX downloads that release, not a cached or older installer.` : 'This release has no YTX installer asset yet.') : releaseInfo.message || `Latest published version: ${releaseInfo.latestVersion || releaseInfo.currentVersion}.`;
    $('openReleaseBtn').classList.toggle('hidden', !releaseInfo.url);
    $('downloadUpdateBtn').classList.toggle('hidden', !(releaseInfo.available && releaseInfo.asset));
    $('updateNotes').textContent = releaseInfo.notes || 'No release notes were published.'; $('updateNotes').classList.remove('hidden');
    renderReleaseHistory(releaseInfo.releases);
    if (releaseInfo.updated) { $('changelogVersion').textContent = `YTX ${releaseInfo.latestVersion} · just installed`; $('changelogText').textContent = releaseInfo.notes || 'No release notes were published.'; }
    setUpdateBadge(Boolean(releaseInfo.available));
  } catch (error) { $('updateTitle').textContent = 'Update check unavailable'; $('updateStatus').textContent = error.message; setUpdateBadge(false); }
  finally { $('checkUpdatesBtn').disabled = false; }
}
$('checkUpdatesBtn').onclick = checkReleaseUpdate;
$('downloadUpdateBtn').onclick = () => {
  const latest = releaseInfo?.releases?.find(release => release.version === releaseInfo.latestVersion);
  if (latest?.asset) downloadReleaseVersion(latest, true);
};
$('openInstallerBtn').onclick = async () => { const result = await window.studio.openInstaller(installerPath); if (result.error) $('updateStatus').textContent = result.error; };
$('openReleaseBtn').onclick = () => releaseInfo?.url && window.studio.openRelease(releaseInfo.url);
window.studio.getChangelog().then(text => { $('changelogText').textContent = text; }).catch(() => { $('changelogText').textContent = 'Changelog is unavailable.'; });
checkReleaseUpdate();
window.studio.onAdobeHandoff(file => { loadMedia(file); $('downloadStatus').textContent = 'Received selected Adobe media from ' + (file.source || 'Adobe') + '.'; });
async function refreshAdobe() {
  try {
    const state = await window.studio.getAdobeStatus();
    $('premiereState').classList.toggle('connected-dot', state.premiere.connected); $('premiereLabel').textContent = state.premiere.connected ? 'Connected' : (state.premiere.running ? 'Active · open YTX Bridge' : 'Not running');
    $('aeState').classList.toggle('connected-dot', state.aftereffects.connected); $('aeLabel').textContent = state.aftereffects.connected ? 'Connected' : (state.aftereffects.running ? 'Active · open YTX Bridge' : 'Not running');
    $('sendPremiere').disabled = $('sendAfterEffects').disabled = false;
  } catch {}
}
setInterval(refreshAdobe, 1500); refreshAdobe();

function renderProjectMedia(result) {
  const list = $('projectMediaItems'); list.replaceChildren();
  const items = result && result.items || []; $('projectMediaCount').textContent = String(items.length);
  $('projectMediaEmpty').classList.toggle('hidden', items.length > 0);
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'project-media-item'; row.draggable = true; row.title = 'Drag into an Adobe project or click to open';
    const label = document.createElement('span'); label.textContent = item.name;
    const size = document.createElement('small'); size.textContent = `${(item.size / 1048576).toFixed(1)} MB`;
    row.append(label, size); row.addEventListener('click', async () => { const file = { path: item.path, url: 'file:///' + item.path.replace(/\\/g, '/') }; loadMedia(file); });
    row.addEventListener('dragstart', event => { event.preventDefault(); window.studio.startNativeDrag(item.path); });
    list.appendChild(row);
  }
}
async function refreshProjectMedia() { try { const result = await window.studio.getProjectMedia(); renderProjectMedia(result); } catch {} }
setInterval(refreshProjectMedia, 3000); refreshProjectMedia();
window.studio.onProtocolVideo(url => { $('urlInput').value = url; $('downloadBtn').click(); });
window.studio.getPreferences().then(prefs => { $('startupToggle').checked = Boolean(prefs.openAtLogin && prefs.keepInTray); }).catch(() => {});
$('startupToggle').addEventListener('change', async () => {
  const enabled = $('startupToggle').checked;
  await window.studio.setPreferences({ openAtLogin: enabled, keepInTray: enabled });
});
$('installBrowserExtensionBtn').onclick = async () => {
  $('installBrowserExtensionBtn').disabled = true;
  $('systemSummary').textContent = 'Registering the signed YTX extension in detected Chromium browsers…';
  try {
    const result = await window.studio.installBrowserExtension({});
    if (result.error) throw Error(result.error);
    $('systemSummary').textContent = result.message || (result.ok ? 'Browser extension registered. Restart the browser once.' : 'No supported browser was found.');
    if (!result.ok && result.path) $('systemSummary').textContent += ' Extension folder: ' + result.path;
  } catch (error) { $('systemSummary').textContent = `Automatic install failed: ${error.message}`; }
  finally { $('installBrowserExtensionBtn').disabled = false; }
};
$('repairAdobeBridgeBtn').onclick = async () => {
  $('repairAdobeBridgeBtn').disabled = true;
  $('systemSummary').textContent = 'Repairing the YTX Bridge panel and Adobe CEP connection…';
  try {
    const result = await window.studio.repairAdobeBridge({});
    if (result.error) throw Error(result.error);
    $('systemSummary').textContent = result.message || 'YTX Bridge repaired. Restart Adobe and reopen the panel.';
  } catch (error) { $('systemSummary').textContent = `Adobe bridge repair failed: ${error.message}`; }
  finally { $('repairAdobeBridgeBtn').disabled = false; }
};
$('openBrowserExtensionBtn').onclick = async () => {
  const result = await window.studio.openBrowserExtension();
  $('systemSummary').textContent = result.error ? `Could not open folder: ${result.error}` : `Fallback folder: ${result.path}`;
};
syncCodecCompatibility();
$('scanSystemBtn').onclick = async () => {
  $('systemSummary').textContent = 'Scanning installed apps and available system memory…';
  try {
    const result = await window.studio.scanSystem();
    $('systemSummary').textContent = `${result.cpu} · ${result.cores} cores · ${result.memoryGb} GB RAM (${result.freeMemoryGb} GB free)`;
    const list = $('systemApps'); list.replaceChildren();
    for (const app of result.apps) { const row = document.createElement('li'); row.textContent = app.name; const state = document.createElement('span'); state.className = 'app-state'; state.textContent = app.installed ? 'FOUND' : 'NOT FOUND'; row.appendChild(state); list.appendChild(row); }
    list.classList.remove('hidden');
  } catch (error) { $('systemSummary').textContent = error.message; }
};
async function startup() {
  const list = $('startupChecks'), items = [['python','Python runtime'],['ytDlp','yt-dlp downloader'],['ffmpeg','FFmpeg'],['adobeBridge','Adobe bridge']];
  try {
    const state = await window.studio.getSystemStatus(); let complete = 0;
    for (const [key, label] of items) {
      const ok = Boolean(state[key]); complete++;
      const row = document.createElement('li'); row.className = ok ? 'ok' : 'warn'; row.textContent = `${ok ? '✓' : '•'} ${label} ${ok ? 'ready' : 'checking'}`; list.appendChild(row);
      $('splashProgress').style.width = `${Math.round(complete / items.length * 100)}%`;
    }
    $('splashMessage').textContent = state.backend ? 'Workspace ready' : 'Starting the local Python bridge…';
    $('backendStatus').textContent = state.backend ? 'running' : 'starting…';
    setTimeout(() => $('splash').classList.add('splash-hidden'), state.backend ? 650 : 1700);
  } catch { $('splashMessage').textContent = 'YTX is starting…'; setTimeout(() => $('splash').classList.add('splash-hidden'), 1800); }
}
startup();
