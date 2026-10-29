const $ = id => document.getElementById(id);
const video = $('video');
const previewAudio = $('previewAudio');
const FPS = 30;
const FRAME = 1 / FPS;
let mediaPath = '', remoteUrl = '', duration = 0, inPoint = 0, outPoint = 0, fullRange = false, format = 'video', zoom = 1;
let scrubbing = false, scrubPending = null, scrubFrame = 0, pendingSeek = null, availableFormats = { video: [], audio: [] };
let sourceWidth = 0, sourceHeight = 0, previewHasAudio = false;
let previewMuted = false;
try { previewMuted = localStorage.getItem('ytx.previewMuted') === '1'; } catch {}

function resolutionLabel(width, height) {
  if (!width || !height) return '—';
  const base = width + ' × ' + height;
  if (height >= 4320) return base + ' · 8K';
  if (height >= 2160) return base + ' · 4K';
  if (height >= 1440) return base + ' · QHD';
  return base;
}
function updateResolution() {
  $('resolution').textContent = resolutionLabel(sourceWidth, sourceHeight);
  if ($('sequenceMeta')) $('sequenceMeta').textContent = 'Sequence 01 · ' + (sourceWidth && sourceHeight ? sourceWidth + ' × ' + sourceHeight : '1920 × 1080');
}
const VOLUME_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/></svg>';
const MUTED_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6m0-6-5 6"/></svg>';
function applyMuteState() {
  video.muted = previewMuted;
  previewAudio.muted = previewMuted;
  const button = $('muteBtn');
  if (!button) return;
  button.innerHTML = previewMuted ? MUTED_ICON : VOLUME_ICON;
  button.title = previewMuted ? 'Unmute preview (M)' : 'Mute preview (M)';
  button.setAttribute('aria-label', previewMuted ? 'Unmute preview' : 'Mute preview');
  button.setAttribute('aria-pressed', String(previewMuted));
  button.classList.toggle('muted', previewMuted);
  try { localStorage.setItem('ytx.previewMuted', previewMuted ? '1' : '0'); } catch {}
}
function syncPreviewAudio(play) {
  if (!previewHasAudio || !previewAudio.src) return;
  if (Math.abs(previewAudio.currentTime - video.currentTime) > 0.3) previewAudio.currentTime = video.currentTime;
  previewAudio.playbackRate = video.playbackRate || 1;
  if (play) previewAudio.play().catch(() => {});
  else previewAudio.pause();
}
function playPreview() {
  const started = video.play();
  syncPreviewAudio(true);
  return started;
}
function pausePreview() {
  video.pause();
  previewAudio.pause();
}

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
  sourceWidth = 0; sourceHeight = 0; previewHasAudio = false;
  previewAudio.pause(); previewAudio.removeAttribute('src'); previewAudio.load();
  $('downloadQualityWrap').classList.add('hidden'); $('videoQuality').value = '20'; $('audioQuality').value = '192';
  video.crossOrigin = ''; video.src = file.url; $('viewer').classList.add('has-video'); $('videoLoading').classList.remove('hidden');
  $('sourceLabel').textContent = 'LOCAL FILE'; $('mediaItem').className = 'source-card loaded-media';
  const name = file.path.split(/[\\/]/).pop();
  $('mediaItem').innerHTML = '<div class="file-icon">▣</div><div class="loaded-info"><strong>' + escapeHtml(name) + '</strong><small>Ready to edit · Local media</small></div><span class="media-check">✓</span>';
  showTimeline(name); $('projectName').textContent = name; chooseFormat(format); updateResolution(); paint();
}
function loadOnline(info, sourceUrl) {
  mediaPath = ''; remoteUrl = sourceUrl; duration = Number(info.duration) || 0; inPoint = 0; outPoint = duration; fullRange = false;
  availableFormats = { video: info.videoFormats || [], audio: info.audioFormats || [] };
  sourceWidth = Number(info.sourceWidth) || Number(info.width) || 0;
  sourceHeight = Number(info.sourceHeight) || Number(info.height) || 0;
  previewHasAudio = Boolean(info.hasAudio);
  previewAudio.pause();
  if (info.audioUrl) { previewAudio.src = info.audioUrl; previewAudio.load(); }
  else { previewAudio.removeAttribute('src'); previewAudio.load(); }
  previewAudio.muted = previewMuted;
  fillQuality('downloadQuality', availableFormats.video, 'height'); $('downloadQualityWrap').classList.remove('hidden');
  video.crossOrigin = ''; video.src = info.url; $('viewer').classList.add('has-video'); $('videoLoading').classList.remove('hidden');
  $('sourceLabel').textContent = 'ONLINE PREVIEW'; $('mediaItem').className = 'source-card loaded-media';
  $('mediaItem').innerHTML = '<div class="youtube-icon">▶</div><div class="loaded-info"><strong>' + escapeHtml(info.title || 'Online video') + '</strong><small>Streaming preview · not downloaded</small></div><span class="media-check">↗</span>';
  showTimeline(info.title || 'Online video'); $('projectName').textContent = info.title || 'Online video';
  updateResolution();
  chooseFormat(format); paint(); playPreview().catch(() => {});
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
  if (!sourceWidth || !sourceHeight) { sourceWidth = video.videoWidth; sourceHeight = video.videoHeight; }
  $('videoLoading').classList.add('hidden'); updateResolution();
  if (pendingSeek !== null) { video.currentTime = Math.min(duration, pendingSeek); pendingSeek = null; } paint();
});
video.addEventListener('canplay', () => $('videoLoading').classList.add('hidden'));
video.addEventListener('waiting', () => $('videoLoading').classList.remove('hidden'));
video.addEventListener('error', () => $('videoLoading').classList.add('hidden'));
video.addEventListener('timeupdate', () => {
  paint();
  if (previewHasAudio && !video.paused && Math.abs(previewAudio.currentTime - video.currentTime) > 0.35) previewAudio.currentTime = video.currentTime;
  if (video.currentTime >= outPoint && !video.paused) { pausePreview(); video.currentTime = outPoint; }
});
function setPlayButton(playing) {
  $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('playBtn').title = playing ? 'Pause' : 'Play';
  $('playBtn').innerHTML = playing
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 12 7-12 7z"/></svg>';
}
video.addEventListener('play', () => { setPlayButton(true); syncPreviewAudio(true); });
video.addEventListener('pause', () => { setPlayButton(false); previewAudio.pause(); });
video.addEventListener('seeking', () => { if (previewHasAudio) previewAudio.currentTime = video.currentTime; });
video.addEventListener('ratechange', () => { previewAudio.playbackRate = video.playbackRate || 1; });
video.addEventListener('volumechange', () => { previewAudio.volume = video.volume; });
$('playBtn').onclick = () => video.paused ? playPreview() : pausePreview();
$('muteBtn').onclick = () => { previewMuted = !previewMuted; applyMuteState(); };
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() !== 'm' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  if (!$('systemScanModal').classList.contains('hidden') || !$('downloadCenter').classList.contains('hidden')) return;
  previewMuted = !previewMuted; applyMuteState();
});
applyMuteState();
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
const VIDEO_CODECS_BY_CONTAINER = {
  mp4: ['h264', 'hevc', 'av1', 'mpeg4', 'copy'],
  m4v: ['h264', 'hevc', 'mpeg4', 'copy'],
  mov: ['h264', 'hevc', 'prores', 'prores_lt', 'prores_hq', 'prores_4444', 'dnxhd', 'dnxhr', 'mpeg4', 'copy'],
  mkv: ['h264', 'hevc', 'av1', 'vp9', 'vp8', 'prores', 'prores_hq', 'prores_4444', 'dnxhd', 'dnxhr', 'mpeg2', 'mpeg4', 'theora', 'copy'],
  webm: ['av1', 'vp9', 'vp8', 'copy'],
  avi: ['h264', 'mpeg4', 'mpeg2', 'wmv2', 'copy'],
  ts: ['h264', 'hevc', 'mpeg2', 'mpeg4', 'copy'],
  m2ts: ['h264', 'hevc', 'mpeg2', 'copy'],
  mts: ['h264', 'hevc', 'mpeg2', 'copy'],
  mpg: ['mpeg2', 'mpeg4', 'copy'],
  mxf: ['dnxhd', 'dnxhr', 'prores', 'prores_hq', 'prores_4444', 'mpeg2', 'copy'],
  wmv: ['wmv2', 'copy'],
  flv: ['h264', 'flv1', 'copy'],
  '3gp': ['h264', 'h263', 'mpeg4', 'copy'],
  ogv: ['theora', 'vp8', 'copy']
};
const AUDIO_CODECS_BY_CONTAINER = {
  mp3: ['mp3', 'copy'],
  m4a: ['aac', 'alac', 'copy'],
  wav: ['pcm', 'pcm24', 'pcm32', 'copy'],
  flac: ['flac', 'copy'],
  ogg: ['vorbis', 'opus', 'flac', 'copy'],
  opus: ['opus', 'copy'],
  aac: ['aac', 'copy'],
  ac3: ['ac3', 'eac3', 'copy'],
  wma: ['wmav2', 'copy'],
  aiff: ['pcm', 'pcm24', 'pcm32', 'copy'],
  mp4: ['aac', 'mp3', 'alac', 'ac3', 'eac3', 'copy'],
  m4v: ['aac', 'mp3', 'alac', 'copy'],
  mov: ['aac', 'mp3', 'alac', 'pcm', 'pcm24', 'pcm32', 'ac3', 'eac3', 'copy'],
  mkv: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'alac', 'pcm', 'pcm24', 'pcm32', 'ac3', 'eac3', 'mp2', 'copy'],
  webm: ['opus', 'vorbis', 'copy'],
  avi: ['mp3', 'pcm', 'ac3', 'mp2', 'copy'],
  ts: ['aac', 'mp3', 'ac3', 'eac3', 'mp2', 'copy'],
  m2ts: ['aac', 'ac3', 'eac3', 'mp2', 'pcm', 'copy'],
  mts: ['aac', 'ac3', 'eac3', 'mp2', 'pcm', 'copy'],
  mpg: ['mp2', 'mp3', 'ac3', 'pcm', 'copy'],
  mxf: ['pcm', 'pcm24', 'pcm32', 'copy'],
  wmv: ['wmav2', 'mp3', 'copy'],
  flv: ['aac', 'mp3', 'copy'],
  '3gp': ['aac', 'copy'],
  ogv: ['vorbis', 'opus', 'flac', 'copy']
};
function syncCodecCompatibility() {
  function limit(id, allowed) {
    const select = $(id); for (const option of select.options) option.disabled = !allowed.includes(option.value);
    if (!allowed.includes(select.value)) select.value = allowed[0];
  }
  const container = $('videoContainer').value;
  limit('videoCodec', VIDEO_CODECS_BY_CONTAINER[container] || VIDEO_CODECS_BY_CONTAINER.mp4);
  const audioContainer = format === 'audio' ? $('audioContainer').value : container;
  limit('audioCodec', AUDIO_CODECS_BY_CONTAINER[audioContainer] || AUDIO_CODECS_BY_CONTAINER.mp4);
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
let exporting = false;
async function exportMedia(adobeTarget = '') {
  const status = $('exportStatus');
  if (!mediaPath && !remoteUrl) { status.textContent = 'Preview or open a video first.'; status.className = 'status error'; return; }
  const start = fullRange ? 0 : inPoint, end = fullRange ? duration : outPoint;
  if (end <= start) { status.textContent = 'Set a valid trim range.'; status.className = 'status error'; return; }
  status.textContent = remoteUrl ? 'Preparing the selected range…' : 'Rendering the selected range…';
  status.className = 'status'; $('exportBtn').classList.add('busy');
  exporting = true; refreshAdobe();
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
  finally { $('exportBtn').classList.remove('busy'); exporting = false; refreshAdobe(); }
}
$('exportBtn').onclick = () => exportMedia();
$('exportVideoTop').onclick = () => { chooseFormat('video'); exportMedia(); };
function showWorkspace(name) {
  const converter = name === 'converter';
  $('editorWorkspace').classList.toggle('hidden', converter);
  $('converterWorkspace').classList.toggle('hidden', !converter);
  $('editorModeBtn').classList.toggle('active', !converter);
  $('converterModeBtn').classList.toggle('active', converter);
  if (converter) { renderConversionQueue(); refreshConversionPerformance(); renderConversionTransfers(); }
}
$('editorModeBtn').onclick = $('backToEditorBtn').onclick = () => showWorkspace('editor');
$('converterModeBtn').onclick = () => showWorkspace('converter');
$('convertBatchBtn').onclick = () => showWorkspace('converter');
$('openTransferCenterBtn').onclick = () => openDownloadCenter('transfers');

/* Conversion workspace --------------------------------------------------- */
const FORMAT_LABELS = {
  mp4: 'MP4 · H.264', mov: 'MOV · QuickTime', mkv: 'MKV · Matroska', webm: 'WebM · VP9', avi: 'AVI', m4v: 'M4V', ts: 'MPEG-TS',
  m2ts: 'M2TS · Blu-ray', mts: 'MTS · AVCHD', mpg: 'MPG · MPEG-2', mxf: 'MXF · ProRes/DNx', wmv: 'WMV · Windows Media',
  flv: 'FLV · Flash', '3gp': '3GP · Mobile', ogv: 'OGV · Theora',
  mp3: 'MP3 · Audio', m4a: 'M4A · AAC', wav: 'WAV · PCM', flac: 'FLAC · Lossless', ogg: 'OGG · Vorbis', opus: 'Opus · Audio',
  aac: 'AAC · ADTS', ac3: 'AC-3 · Surround', wma: 'WMA · Windows', aiff: 'AIFF · PCM',
  jpg: 'JPG · Image', png: 'PNG · Image', webp: 'WebP · Image', bmp: 'BMP · Image', tif: 'TIFF · Image', tga: 'TGA · Image'
};
const VIDEO_TARGETS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'ts', 'm2ts', 'mts', 'mpg', 'mxf', 'wmv', 'flv', '3gp', 'ogv'];
const AUDIO_TARGETS = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'ac3', 'wma', 'aiff'];
const IMAGE_TARGETS = ['jpg', 'png', 'webp', 'bmp', 'tif', 'tga'];
const COMPRESSION_COPY = {
  light: 'Light compression keeps near-original detail and trims only the largest files.',
  balanced: 'Balanced reduces size while preserving visual quality for most projects.',
  maximum: 'Maximum compression creates the smallest delivery files and caps video at 720p.'
};
const conversionQueue = [];
let conversionMode = 'convert';
let compressionPreset = 'balanced';
let outputFolder = '';
let conversionRunning = false;
let conversionSequence = 0;
let performanceProfile = null;

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1073741824) return `${(value / 1073741824).toFixed(2)} GB`;
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}
function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  const minutes = Math.floor(value / 60), rest = Math.round(value % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
function targetFormats(kind) {
  if (kind === 'video') return [...VIDEO_TARGETS, ...AUDIO_TARGETS];
  if (kind === 'audio') return [...AUDIO_TARGETS];
  return [...IMAGE_TARGETS];
}
function defaultTarget(item) {
  const source = String(item.extension || '').toLowerCase();
  if (conversionMode === 'compress') {
    // Compression keeps an already efficient container, but lossless or
    // delivery-unfriendly sources move to a smaller format automatically.
    if (item.kind === 'video') return ['mp4', 'mov', 'mkv', 'webm'].includes(source) ? source : 'mp4';
    if (item.kind === 'audio') return ['mp3', 'm4a', 'ogg', 'opus'].includes(source) ? source : 'mp3';
    return ['jpg', 'jpeg', 'webp'].includes(source) ? (source === 'jpeg' ? 'jpg' : source) : 'jpg';
  }
  return item.kind === 'video' ? 'mp4' : item.kind === 'audio' ? 'mp3' : 'jpg';
}
function formatLabel(value) { return FORMAT_LABELS[value] || value.toUpperCase(); }
function mediaKindLabel(kind) { return kind === 'video' ? 'VIDEO' : kind === 'audio' ? 'AUDIO' : 'IMAGE'; }
function compactPath(value) {
  const path = String(value || '');
  if (path.length <= 48) return path;
  return `${path.slice(0, 20)}…${path.slice(-25)}`;
}
function queueItem(id) { return conversionQueue.find(item => item.id === id); }

function buildFormatSelect(item) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', `Output format for ${item.name}`);
  const groups = item.kind === 'video'
    ? [['Video output', VIDEO_TARGETS], ['Audio only', AUDIO_TARGETS]]
    : item.kind === 'audio'
      ? [['Audio output', AUDIO_TARGETS]]
      : [['Image output', IMAGE_TARGETS]];
  for (const [label, values] of groups) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = formatLabel(value);
      group.appendChild(option);
    }
    select.appendChild(group);
  }
  select.value = item.format;
  select.disabled = conversionRunning;
  select.addEventListener('change', () => { item.format = select.value; updateQueueSummary(); });
  return select;
}

function queueStatusText(item) {
  if (item.status === 'converting') return `Converting · ${Math.round(item.progress || 0)}%`;
  if (item.status === 'complete') return 'Complete';
  if (item.status === 'failed') return item.error ? String(item.error).split('\n')[0].slice(0, 90) : 'Could not convert this file.';
  if (item.status === 'cancelled') return 'Cancelled';
  return 'Ready to convert';
}

function updateQueueRow(item) {
  const row = document.querySelector(`.queue-row[data-id="${item.id}"]`);
  if (!row) return;
  row.classList.toggle('converting', item.status === 'converting');
  row.classList.toggle('complete', item.status === 'complete');
  row.classList.toggle('failed', item.status === 'failed' || item.status === 'cancelled');
  const status = row.querySelector('.queue-status-line');
  if (status) {
    status.replaceChildren();
    const dot = document.createElement('span'); dot.className = 'dot';
    const text = document.createElement('span'); text.textContent = queueStatusText(item);
    status.append(dot, text);
  }
  const fill = row.querySelector('.queue-track i');
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, item.progress || 0))}%`;
  const overlay = row.querySelector('.thumb-state');
  if (overlay) {
    overlay.classList.toggle('hidden', item.status !== 'converting' && item.status !== 'queued');
    if (item.status === 'complete') {
      overlay.classList.add('hidden');
      const thumb = row.querySelector('.queue-thumb');
      if (thumb && !thumb.querySelector('.thumb-complete')) {
        const badge = document.createElement('span');
        badge.className = 'thumb-complete';
        badge.textContent = '✓';
        badge.style.cssText = 'position:absolute;right:4px;top:4px;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;background:#b9e95b;color:#171a0d;font-size:10px;font-weight:700;box-shadow:0 2px 8px #0008';
        thumb.appendChild(badge);
      }
    }
  }
  const remove = row.querySelector('.queue-remove');
  if (remove) remove.disabled = conversionRunning;
}

function createQueueRow(item) {
  const row = document.createElement('article');
  row.className = 'queue-row';
  row.dataset.id = item.id;
  if (item.status === 'converting') row.classList.add('converting');
  if (item.status === 'complete') row.classList.add('complete');
  if (item.status === 'failed' || item.status === 'cancelled') row.classList.add('failed');

  const thumb = document.createElement('div');
  thumb.className = `queue-thumb ${item.kind}`;
  if (item.thumbnail) {
    const image = document.createElement('img');
    image.alt = '';
    image.src = item.thumbnail;
    thumb.appendChild(image);
  } else {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('class', 'thumb-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', item.kind === 'audio'
      ? 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3h3m10-2a3 3 0 1 1-3-3h3'
      : item.kind === 'image'
        ? 'M4 5h16v14H4zM8 11l3 3 2.5-2.5L18 16M8.5 9h.01'
        : 'M4 6h16v12H4zM10 9.5l5 2.5-5 2.5z');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    icon.appendChild(path);
    thumb.appendChild(icon);
  }
  const kind = document.createElement('span');
  kind.className = 'queue-kind';
  kind.textContent = mediaKindLabel(item.kind);
  thumb.appendChild(kind);
  if (item.status === 'converting' || item.status === 'queued') {
    const overlay = document.createElement('div');
    overlay.className = `thumb-state${item.status === 'queued' ? ' hidden' : ''}`;
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    overlay.appendChild(spinner);
    thumb.appendChild(overlay);
  }

  const body = document.createElement('div');
  body.className = 'queue-body';
  const name = document.createElement('strong');
  name.className = 'queue-name';
  name.textContent = item.name;
  name.title = item.path;
  const meta = document.createElement('div');
  meta.className = 'queue-meta';
  const size = document.createElement('span'); size.textContent = formatBytes(item.size);
  meta.appendChild(size);
  if (item.duration) {
    const duration = document.createElement('span'); duration.textContent = formatDuration(item.duration); meta.appendChild(duration);
  }
  const source = document.createElement('span'); source.textContent = String(item.extension || '').toUpperCase() || 'MEDIA'; meta.appendChild(source);
  const statusLine = document.createElement('div');
  statusLine.className = 'queue-status-line';
  const dot = document.createElement('span'); dot.className = 'dot';
  const statusText = document.createElement('span'); statusText.textContent = queueStatusText(item);
  statusLine.append(dot, statusText);
  const track = document.createElement('div');
  track.className = 'queue-track';
  const fill = document.createElement('i'); fill.style.width = `${Math.max(0, Math.min(100, item.progress || 0))}%`;
  track.appendChild(fill);
  body.append(name, meta, statusLine, track);

  const format = document.createElement('div');
  format.className = 'queue-format';
  const label = document.createElement('label'); label.textContent = 'OUTPUT';
  format.append(label, buildFormatSelect(item));

  const remove = document.createElement('button');
  remove.className = 'queue-remove';
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = 'Remove from queue';
  remove.disabled = conversionRunning;
  remove.addEventListener('click', () => {
    if (conversionRunning) return;
    const index = conversionQueue.findIndex(entry => entry.id === item.id);
    if (index >= 0) conversionQueue.splice(index, 1);
    renderConversionQueue();
  });

  row.append(thumb, body, format, remove);
  return row;
}

function updateQueueSummary() {
  const count = conversionQueue.length;
  const total = conversionQueue.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  $('convertQueueCount').textContent = `${count} ${count === 1 ? 'FILE' : 'FILES'}`;
  const formatCount = new Set(conversionQueue.map(item => item.format)).size;
  $('convertQueueSummary').textContent = count ? `${formatBytes(total)} queued · ${formatCount} output format${formatCount === 1 ? '' : 's'}` : 'No media added';
  $('clearConversionQueue').disabled = !count || conversionRunning;
  $('startConversionBtn').disabled = !count || conversionRunning;
  $('startConversionBtn').textContent = conversionRunning ? 'Converting…' : 'Start conversion';
}

function renderConversionQueue() {
  const root = $('conversionQueue');
  root.replaceChildren();
  if (!conversionQueue.length) {
    const empty = document.createElement('div');
    empty.className = 'queue-empty';
    const mark = document.createElement('span'); mark.className = 'queue-empty-mark'; mark.textContent = '▧';
    const strong = document.createElement('strong'); strong.textContent = 'Your media appears here';
    const small = document.createElement('small'); small.textContent = 'Add files to preview them before conversion.';
    empty.append(mark, strong, small);
    root.appendChild(empty);
    updateQueueSummary();
    return;
  }
  for (const item of conversionQueue) root.appendChild(createQueueRow(item));
  updateQueueSummary();
}

function updateQueueThumbnail(item) {
  const row = document.querySelector(`.queue-row[data-id="${item.id}"]`);
  if (!row || !item.thumbnail) return;
  const thumb = row.querySelector('.queue-thumb');
  if (!thumb) return;
  const image = document.createElement('img');
  image.alt = '';
  image.src = item.thumbnail;
  const icon = thumb.querySelector('.thumb-icon');
  if (icon) icon.remove();
  thumb.insertBefore(image, thumb.firstChild);
}

function probeQueueItem(item) {
  if (!item.url || item.kind === 'image') return;
  const node = document.createElement(item.kind === 'audio' ? 'audio' : 'video');
  node.preload = 'metadata';
  node.muted = true;
  node.src = item.url;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (Number.isFinite(node.duration) && node.duration > 0) {
      item.duration = node.duration;
      const row = document.querySelector(`.queue-row[data-id="${item.id}"] .queue-meta`);
      if (row && !row.querySelector('.queue-duration')) {
        const span = document.createElement('span');
        span.className = 'queue-duration';
        span.textContent = formatDuration(item.duration);
        row.insertBefore(span, row.children[1] || null);
      }
    }
    try { node.removeAttribute('src'); node.load(); } catch {}
  };
  node.addEventListener('loadedmetadata', finish);
  node.addEventListener('error', finish);
  setTimeout(finish, 8000);
}
function captureVideoThumbnail(item) {
  if (item.kind !== 'video' || !item.url || item.thumbnail) return;
  const node = document.createElement('video');
  node.preload = 'metadata';
  node.muted = true;
  node.src = item.url;
  let drawn = false;
  const draw = () => {
    if (drawn) return;
    drawn = true;
    try {
      const canvas = document.createElement('canvas');
      const width = node.videoWidth || 320, height = node.videoHeight || 180;
      canvas.width = 240;
      canvas.height = Math.max(1, Math.round(240 * height / width));
      const context = canvas.getContext('2d');
      context.drawImage(node, 0, 0, canvas.width, canvas.height);
      item.thumbnail = canvas.toDataURL('image/jpeg', 0.72);
      updateQueueThumbnail(item);
    } catch {}
    try { node.removeAttribute('src'); node.load(); } catch {}
  };
  node.addEventListener('loadeddata', () => {
    try { node.currentTime = Math.min(1.2, Math.max(0.05, (node.duration || 2) * 0.12)); } catch { draw(); }
  });
  node.addEventListener('seeked', draw);
  node.addEventListener('error', () => { try { node.removeAttribute('src'); node.load(); } catch {} });
}

async function addConversionFiles(paths) {
  const unique = [...new Set((Array.isArray(paths) ? paths : []).filter(Boolean))];
  if (!unique.length) return;
  const available = unique.filter(path => !conversionQueue.some(item => item.path.toLowerCase() === path.toLowerCase()));
  if (!available.length) { $('converterStatus').textContent = 'Those files are already in the queue.'; $('converterStatus').className = 'status'; return; }
  try {
    const result = await window.studio.describeMediaFiles(available);
    if (result.error) throw Error(result.error);
    for (const file of result.files || []) {
      const item = { ...file, id: `q${++conversionSequence}`, format: '', status: 'queued', progress: 0, error: '' };
      item.format = defaultTarget(item);
      conversionQueue.push(item);
      if (file.kind === 'image') item.thumbnail = file.url;
      probeQueueItem(item);
      captureVideoThumbnail(item);
    }
    renderConversionQueue();
    if (result.files?.length) {
      $('converterStatus').textContent = `${result.files.length} file${result.files.length === 1 ? '' : 's'} added. Review the output formats, then start the conversion.`;
      $('converterStatus').className = 'status';
    }
  } catch (error) {
    $('converterStatus').textContent = error.message;
    $('converterStatus').className = 'status error';
  }
}

async function addFilesFromPicker() {
  const result = await window.studio.pickMediaFiles();
  if (!result || result.canceled) return;
  await addConversionFiles((result.files || []).map(file => file.path));
}
$('addFilesBtn').onclick = event => { event.stopPropagation(); addFilesFromPicker(); };
$('converterDropzone').addEventListener('click', event => {
  if (event.target.closest('button')) return;
  addFilesFromPicker();
});
$('converterDropzone').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); addFilesFromPicker(); }
});
$('convertFileInput').addEventListener('change', async event => {
  const paths = [...event.target.files].map(file => window.studio.pathForFile(file)).filter(Boolean);
  event.target.value = '';
  await addConversionFiles(paths);
});
for (const eventName of ['dragenter', 'dragover']) {
  $('converterDropzone').addEventListener(eventName, event => {
    event.preventDefault(); event.stopPropagation();
    $('converterDropzone').classList.add('drag-over');
  });
}
$('converterDropzone').addEventListener('dragleave', event => {
  if (!$('converterDropzone').contains(event.relatedTarget)) $('converterDropzone').classList.remove('drag-over');
});
$('converterDropzone').addEventListener('drop', async event => {
  event.preventDefault(); event.stopPropagation();
  $('converterDropzone').classList.remove('drag-over');
  const paths = [...(event.dataTransfer?.files || [])].map(file => window.studio.pathForFile(file)).filter(Boolean);
  await addConversionFiles(paths);
});
document.addEventListener('dragover', event => { if (!$('converterWorkspace').classList.contains('hidden')) event.preventDefault(); });
document.addEventListener('drop', event => { if (!$('converterWorkspace').classList.contains('hidden')) event.preventDefault(); });

function setConversionRunning(running) {
  conversionRunning = running;
  $('startConversionBtn').classList.toggle('busy', running);
  $('cancelConversionBtn').classList.toggle('hidden', !running);
  $('convertModeBtn').disabled = running;
  $('compressModeBtn').disabled = running;
  $('chooseOutputFolderBtn').disabled = running;
  for (const button of document.querySelectorAll('.compression-option')) button.disabled = running;
  for (const row of document.querySelectorAll('.queue-row')) {
    const remove = row.querySelector('.queue-remove');
    const select = row.querySelector('select');
    if (remove) remove.disabled = running;
    if (select) select.disabled = running;
  }
  updateQueueSummary();
}
function applyMode(mode) {
  if (conversionRunning) return;
  conversionMode = mode === 'compress' ? 'compress' : 'convert';
  $('convertModeBtn').classList.toggle('active', conversionMode === 'convert');
  $('compressModeBtn').classList.toggle('active', conversionMode === 'compress');
  $('compressionSection').classList.toggle('hidden', conversionMode !== 'compress');
  $('converterModeCopy').textContent = conversionMode === 'compress'
    ? 'Reduce file size with a tuned preset. Video is rescaled and re-encoded for efficient delivery.'
    : 'Change containers and codecs while keeping the original image and sound.';
  for (const item of conversionQueue) { item.format = defaultTarget(item); }
  renderConversionQueue();
}
$('convertModeBtn').onclick = () => applyMode('convert');
$('compressModeBtn').onclick = () => applyMode('compress');
for (const button of document.querySelectorAll('.compression-option')) {
  button.addEventListener('click', () => {
    if (conversionRunning) return;
    compressionPreset = button.dataset.compression;
    for (const option of document.querySelectorAll('.compression-option')) option.classList.toggle('active', option === button);
    $('compressionHint').textContent = COMPRESSION_COPY[compressionPreset] || '';
  });
}
$('clearConversionQueue').onclick = () => {
  if (conversionRunning) return;
  conversionQueue.length = 0;
  renderConversionQueue();
  $('converterStatus').textContent = 'Add media to begin.';
  $('converterStatus').className = 'status';
};
function setOutputFolder(path) {
  outputFolder = path || '';
  $('outputFolderPath').textContent = outputFolder ? compactPath(outputFolder) : 'Choose a destination folder';
  $('outputFolderPath').title = outputFolder;
}
$('chooseOutputFolderBtn').onclick = async () => {
  if (conversionRunning) return;
  const result = await window.studio.chooseOutputFolder();
  if (result && !result.canceled && result.path) setOutputFolder(result.path);
};
async function refreshConversionPerformance() {
  try {
    const profile = await window.studio.getPerformanceProfile();
    if (!profile || profile.error) return;
    performanceProfile = profile;
    $('performanceChip').querySelector('span').textContent = `${profile.label} · ${profile.cores} cores · ${profile.totalMemoryGb} GB RAM · ${profile.workers} file${profile.workers === 1 ? '' : 's'} at a time`;
    $('performanceLabel').textContent = `Automatic performance · ${profile.label}`;
    $('performanceDetail').textContent = `${profile.workers} parallel job${profile.workers === 1 ? '' : 's'} · ${profile.threads} encoding thread${profile.threads === 1 ? '' : 's'} each · ${profile.freeMemoryGb} GB free`;
    if (['light', 'balanced', 'maximum'].includes(profile.recommendedCompression) && compressionPreset === 'balanced') {
      compressionPreset = profile.recommendedCompression;
      for (const option of document.querySelectorAll('.compression-option')) option.classList.toggle('active', option.dataset.compression === compressionPreset);
      $('compressionHint').textContent = COMPRESSION_COPY[compressionPreset] || '';
    }
  } catch {}
}
function applyConversionResult(result) {
  const outputs = new Map((result.files || []).filter(file => file.path).map(file => [file.source, file.path]));
  for (const item of conversionQueue) {
    const output = outputs.get(item.path);
    if (result.canceled || item.status === 'cancelled') { item.status = 'cancelled'; continue; }
    if (output) {
      item.status = 'complete'; item.progress = 100; item.error = ''; item.output = output;
    } else if (item.status === 'converting') {
      item.status = 'failed'; item.error = result.error || 'The encoder did not finish this file.';
    }
  }
  for (const item of conversionQueue) updateQueueRow(item);
  renderConversionTransfers();
}
async function startConversion() {
  if (conversionRunning) return;
  if (!conversionQueue.length) {
    $('converterStatus').textContent = 'Add at least one media file to the queue.';
    $('converterStatus').className = 'status error';
    return;
  }
  if (!outputFolder) {
    try { const fallback = await window.studio.defaultOutput(); setOutputFolder(fallback.path); } catch {}
  }
  if (!outputFolder) {
    $('converterStatus').textContent = 'Choose an output folder before starting.';
    $('converterStatus').className = 'status error';
    return;
  }
  for (const item of conversionQueue) { item.status = 'queued'; item.progress = 0; item.error = ''; delete item.output; }
  renderConversionQueue();
  setConversionRunning(true);
  $('converterStatus').textContent = `Preparing ${conversionQueue.length} file${conversionQueue.length === 1 ? '' : 's'}…`;
  $('converterStatus').className = 'status';
  try {
    const result = await window.studio.convertMedia({
      files: conversionQueue.map(item => ({ path: item.path, format: item.format })),
      outputDir: outputFolder,
      mode: conversionMode,
      compression: compressionPreset,
      videoCodec: $('convertCodec').value || '',
      colorProfile: $('convertColor').value,
      videoQuality: $('convertQuality').value,
      audioQuality: $('convertAudioQuality').value
    });
    if (result.error && !result.canceled) throw Error(result.error);
    applyConversionResult(result);
    const completed = conversionQueue.filter(item => item.status === 'complete').length;
    if (result.canceled) {
      $('converterStatus').textContent = 'Conversion cancelled. Files that already finished were kept.';
      $('converterStatus').className = 'status';
    } else {
      $('converterStatus').textContent = `Finished ${completed} of ${conversionQueue.length} file${conversionQueue.length === 1 ? '' : 's'} in ${outputFolder}.`;
      $('converterStatus').className = 'status';
    }
  } catch (error) {
    $('converterStatus').textContent = error.message;
    $('converterStatus').className = 'status error';
  } finally {
    setConversionRunning(false);
    renderConversionQueue();
  }
}
$('startConversionBtn').onclick = startConversion;
$('cancelConversionBtn').onclick = async () => {
  if (!conversionRunning) return;
  $('converterStatus').textContent = 'Cancelling the remaining files…';
  $('converterStatus').className = 'status';
  try { await window.studio.cancelConvert(); } catch (error) { $('converterStatus').textContent = error.message; $('converterStatus').className = 'status error'; }
};
function handleConversionProgress(task) {
  if (!task || task.type !== 'convert') return;
  if (Array.isArray(task.fileProgress)) {
    for (const update of task.fileProgress) {
      const item = conversionQueue.find(entry => entry.path === update.source);
      if (!item) continue;
      item.status = update.status || item.status;
      item.progress = Number(update.progress) || 0;
      item.error = update.error || '';
      updateQueueRow(item);
    }
  }
  if (!task.done && task.message) {
    $('converterStatus').textContent = `${task.message} · ${Math.round(task.progress || 0)}%`;
    $('converterStatus').className = 'status';
  }
}
async function initializeConversionWorkspace() {
  try { const result = await window.studio.defaultOutput(); if (result?.path) setOutputFolder(result.path); } catch {}
  refreshConversionPerformance();
}
initializeConversionWorkspace();

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
    const detail = document.createElement('small'); detail.textContent = item.state === 'cancelled' ? 'Stopped by request' : item.error ? item.error : item.state === 'active' ? (item.message || 'Working…') : item.state === 'complete' ? (item.paths?.length ? item.paths.map(p => p.split(/[\\/]/).pop()).join(', ') : 'Completed') : 'Failed';
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
    const row = document.createElement('article');
    row.className = 'conversion-row' + (item.state === 'cancelled' ? ' cancelled' : item.state === 'failed' ? ' failed' : '');
    const head = document.createElement('div'); head.className = 'conversion-row-head';
    const title = document.createElement('strong'); title.textContent = item.state === 'active' ? (item.message || 'Converting files…') : item.state === 'complete' ? 'Conversion complete' : item.state === 'cancelled' ? 'Conversion cancelled' : 'Conversion failed';
    const percent = document.createElement('b'); percent.textContent = item.state === 'complete' ? '100%' : `${Math.round(item.progress || 0)}%`;
    head.append(title, percent); row.appendChild(head);
    const track = document.createElement('div'); track.className = 'conversion-track'; const fill = document.createElement('i'); fill.style.width = `${Math.max(3, item.progress || 0)}%`; track.appendChild(fill); row.appendChild(track);
    const detail = document.createElement('small'); detail.textContent = item.state === 'cancelled' ? 'Stopped by request. Finished files were kept.' : item.error || (item.paths?.length ? item.paths.map(p => p.split(/[\\/]/).pop()).join(', ') : item.state === 'active' ? (item.message || 'Preparing conversion…') : 'Finished'); row.appendChild(detail);
    root.appendChild(row);
  }
}
function recordTransfer(task) {
  let item = transferHistory.find(entry => entry.id === task.id);
  if (!item) { item = { id: task.id || `${Date.now()}`, type: task.type || 'download', title: task.message || '', state: 'active', progress: 0, paths: [], createdAt: Date.now() }; transferHistory.unshift(item); }
  item.type = task.type || item.type; item.title = item.type === 'update' ? 'YTX update installer' : item.type === 'convert' ? 'Batch conversion' : item.type === 'import' ? 'Adobe import' : (task.message || item.title); item.message = task.message || item.message; item.progress = task.progress ?? item.progress;
  if (task.path) item.paths = [task.path];
  if (task.files?.length) item.paths = task.files.map(file => file.path).filter(Boolean);
  if (task.done) {
    item.state = task.cancelled ? 'cancelled' : task.error ? 'failed' : 'complete';
    item.error = task.cancelled ? '' : task.error || '';
    item.progress = task.cancelled || task.error ? item.progress : 100;
  }
  while (transferHistory.length > 30) transferHistory.pop();
  saveTransferHistory(); renderTransfers(); renderConversionTransfers();
}
renderTransfers();
window.studio.onTaskProgress(task => {
  handleConversionProgress(task);
  recordTransfer(task);
  $('taskProgress').classList.remove('hidden'); $('taskMessage').textContent = task.message || 'Working…';
  $('taskPercent').textContent = `${task.progress || 0}%`; $('taskBar').style.width = `${Math.max(3, task.progress || 0)}%`;
  const mb = n => `${(n / 1048576).toFixed(1)} MB`;
  $('taskMeta').textContent = task.total ? `${mb(task.downloaded || 0)} / ${mb(task.total)}${task.speed ? ` · ${(task.speed / 1048576).toFixed(1)} MB/s` : ''}${task.eta ? ` · ${task.eta}s left` : ''}` : (task.done ? 'Complete' : 'Connecting to stream…');
  if (task.done) {
    $('taskMessage').textContent = task.cancelled ? 'Task cancelled' : task.error ? 'Task failed' : 'Task complete';
    if (task.cancelled) $('taskMeta').textContent = 'Stopped by request';
    else if (task.error) $('taskMeta').textContent = task.error;
  }
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
function updateAdobeButton(buttonId, host, label) {
  const button = $(buttonId);
  const connected = Boolean(host && host.connected);
  button.disabled = !connected || exporting;
  button.classList.toggle('unavailable', !connected);
  button.title = connected
    ? `Export and import into the open ${label} project`
    : `Open ${label} and the YTX Bridge panel to enable this action`;
}
async function refreshAdobe() {
  try {
    const state = await window.studio.getAdobeStatus();
    $('premiereState').classList.toggle('connected-dot', state.premiere.connected); $('premiereLabel').textContent = state.premiere.connected ? 'Connected' : (state.premiere.running ? 'Open YTX Bridge' : 'Not running');
    $('aeState').classList.toggle('connected-dot', state.aftereffects.connected); $('aeLabel').textContent = state.aftereffects.connected ? 'Connected' : (state.aftereffects.running ? 'Open YTX Bridge' : 'Not running');
    updateAdobeButton('sendPremiere', state.premiere, 'Premiere Pro');
    updateAdobeButton('sendAfterEffects', state.aftereffects, 'After Effects');
  } catch {
    updateAdobeButton('sendPremiere', { connected: false }, 'Premiere Pro');
    updateAdobeButton('sendAfterEffects', { connected: false }, 'After Effects');
  }
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
  $('systemSummary').textContent = 'Authorizing the YTX browser integration…';
  try {
    const result = await window.studio.installBrowserExtension({});
    if (result.error) throw Error(result.error);
    $('systemSummary').textContent = result.message || (result.ok ? 'Browser integration authorized. Restart the browser once.' : 'No supported browser was found.');
    if (!result.ok && result.path) $('systemSummary').textContent += ' Integration folder: ' + result.path;
  } catch (error) { $('systemSummary').textContent = `Browser authorization failed: ${error.message}`; }
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
const scanModal = $('systemScanModal');
let scanReturnFocus = null;
function scanStat(label, value, hint = '') {
  const card = document.createElement('div');
  card.className = 'scan-stat';
  const name = document.createElement('span'); name.textContent = label;
  const main = document.createElement('strong'); main.textContent = value;
  card.append(name, main);
  if (hint) { const note = document.createElement('small'); note.textContent = hint; card.appendChild(note); }
  return card;
}
function openSystemScan() {
  scanReturnFocus = document.activeElement;
  scanModal.classList.remove('hidden');
  document.body.classList.add('scan-open');
  $('scanModalBody').scrollTop = 0;
  $('scanModalClose').focus({ preventScroll: true });
}
function closeSystemScan() {
  scanModal.classList.add('hidden');
  document.body.classList.remove('scan-open');
  if (scanReturnFocus && typeof scanReturnFocus.focus === 'function') scanReturnFocus.focus({ preventScroll: true });
}
async function runSystemScan() {
  openSystemScan();
  $('scanModalSummary').textContent = 'Scanning installed apps and available system memory…';
  $('scanModalLead').textContent = 'Checking hardware, Adobe hosts, browsers, and render resources.';
  $('scanModalStats').replaceChildren();
  $('systemApps').replaceChildren();
  $('scanAppCount').textContent = '0';
  $('scanModalNote').textContent = 'Scanning…';
  $('scanAgainBtn').disabled = true;
  $('scanModalBody').scrollTop = 0;
  try {
    const result = await window.studio.scanSystem();
    $('systemSummary').textContent = `${result.cpu} · ${result.cores} cores · ${result.memoryGb} GB RAM (${result.freeMemoryGb} GB free)`;
    $('scanModalLead').textContent = result.cpu || 'System processor';
    $('scanModalSummary').textContent = `${String(result.arch || '').toUpperCase()} ${result.platform || ''} · ${result.cores} logical cores · ${result.memoryGb} GB RAM · ${result.freeMemoryGb} GB free`;
    const performance = result.performance || {};
    const recommended = String(performance.recommendedCompression || 'balanced');
    const stats = [
      ['PROCESSOR', result.cpu || 'Unknown CPU'],
      ['MEMORY', `${result.memoryGb} GB`, `${result.freeMemoryGb} GB free`],
      ['RENDER WORKERS', String(performance.workers ?? 1), performance.label || 'Automatic'],
      ['THREADS PER WORKER', String(performance.threads ?? '')],
      ['ENCODING MODE', result.sequentialConversion ? 'Sequential' : 'Parallel'],
      ['RECOMMENDED PRESET', recommended.charAt(0).toUpperCase() + recommended.slice(1)],
      ['PLATFORM', `${result.platform || ''} · ${result.arch || ''}`]
    ];
    const statFragment = document.createDocumentFragment();
    for (const [label, value, hint] of stats) statFragment.appendChild(scanStat(label, value, hint));
    $('scanModalStats').appendChild(statFragment);
    const apps = Array.isArray(result.apps) ? result.apps : [];
    for (const app of apps) {
      const row = document.createElement('li');
      const name = document.createElement('span'); name.textContent = app.name;
      const kind = document.createElement('small'); kind.textContent = app.kind === 'adobe' ? 'ADOBE' : 'BROWSER';
      const state = document.createElement('span'); state.className = `app-state ${app.installed ? 'found' : 'missing'}`; state.textContent = app.installed ? 'FOUND' : 'NOT FOUND';
      row.append(name, kind, state);
      $('systemApps').appendChild(row);
    }
    $('scanAppCount').textContent = `${apps.filter(app => app.installed).length} / ${apps.length}`;
    $('scanModalNote').textContent = `Scan completed at ${new Date().toLocaleTimeString()}. Results stay on this PC.`;
  } catch (error) {
    $('scanModalSummary').textContent = error.message || 'The system scan could not complete.';
    $('scanModalNote').textContent = 'Close this window and try again.';
  } finally {
    $('scanAgainBtn').disabled = false;
    $('scanModalBody').scrollTop = 0;
  }
}
$('scanSystemBtn').onclick = runSystemScan;
$('scanAgainBtn').onclick = runSystemScan;
$('scanModalClose').onclick = closeSystemScan;
document.querySelectorAll('[data-scan-close]').forEach(element => element.addEventListener('click', closeSystemScan));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !scanModal.classList.contains('hidden')) closeSystemScan(); });
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
