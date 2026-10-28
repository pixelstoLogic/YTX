import json
import os
import re
import shutil
import subprocess
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

JOBS = {}
JOBS_LOCK = threading.Lock()
JOB_EVENTS = {}

VIDEO_CODECS = {'h264': 'libx264', 'hevc': 'libx265', 'av1': 'libaom-av1', 'vp9': 'libvpx-vp9', 'prores': 'prores_ks', 'mpeg4': 'mpeg4', 'copy': 'copy'}
AUDIO_CODECS = {'aac': 'aac', 'mp3': 'libmp3lame', 'opus': 'libopus', 'vorbis': 'libvorbis', 'flac': 'flac', 'pcm': 'pcm_s16le', 'copy': 'copy'}
COLOR_PROFILES = {
    'preserve': None,
    'bt709': ('bt709', 'bt709', 'bt709', 'tv'),
    'bt2020': ('bt2020', 'bt2020-10', 'bt2020nc', 'tv'),
    'smpte170m': ('smpte170m', 'smpte170m', 'smpte170m', 'tv'),
    'bt470bg': ('bt470bg', 'gamma28', 'bt470bg', 'tv'),
    'smpte240m': ('smpte240m', 'smpte240m', 'smpte240m', 'tv'),
}
VIDEO_FORMATS = {'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'ts'}
AUDIO_FORMATS = {'mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus'}
IMAGE_FORMATS = {'jpg', 'jpeg', 'png', 'webp'}
OUTPUT_FORMATS = VIDEO_FORMATS | AUDIO_FORMATS | IMAGE_FORMATS

VIDEO_INPUTS = {'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'ts', 'mts', 'm2ts', 'wmv', 'flv', '3gp', 'ogv'}
AUDIO_INPUTS = {'mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma', 'aiff', 'aif'}
IMAGE_INPUTS = {'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif'}

COMPRESSION_PRESETS = {
    'light': {'videoCrf': 21, 'maxHeight': 1080, 'preset': 'medium', 'audioBitrate': 160, 'imageQuality': 3},
    'balanced': {'videoCrf': 24, 'maxHeight': 1080, 'preset': 'fast', 'audioBitrate': 128, 'imageQuality': 6},
    'maximum': {'videoCrf': 28, 'maxHeight': 720, 'preset': 'fast', 'audioBitrate': 96, 'imageQuality': 10},
}

IMAGE_CODECS = {'jpg': 'mjpeg', 'jpeg': 'mjpeg', 'png': 'png', 'webp': 'libwebp'}

VIDEO_CODECS_BY_CONTAINER = {
    'mp4': ('h264', 'hevc', 'av1', 'mpeg4', 'copy'),
    'm4v': ('h264', 'hevc', 'mpeg4', 'copy'),
    'mov': ('h264', 'hevc', 'prores', 'mpeg4', 'copy'),
    'mkv': ('h264', 'hevc', 'av1', 'vp9', 'prores', 'mpeg4', 'copy'),
    'webm': ('av1', 'vp9', 'copy'),
    'avi': ('h264', 'mpeg4', 'copy'),
    'ts': ('h264', 'hevc', 'mpeg4', 'copy'),
}
AUDIO_CODECS_BY_CONTAINER = {
    'mp3': ('mp3', 'copy'),
    'm4a': ('aac', 'copy'),
    'wav': ('pcm', 'copy'),
    'flac': ('flac', 'copy'),
    'ogg': ('vorbis', 'opus', 'copy'),
    'opus': ('opus', 'copy'),
    'mp4': ('aac', 'mp3', 'copy'),
    'm4v': ('aac', 'mp3', 'copy'),
    'mov': ('aac', 'mp3', 'pcm', 'copy'),
    'mkv': ('aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm', 'copy'),
    'webm': ('opus', 'vorbis', 'copy'),
    'avi': ('mp3', 'pcm', 'copy'),
    'ts': ('aac', 'mp3', 'copy'),
}


def normalize_codecs(options, extension, audio_only):
    video_allowed = VIDEO_CODECS_BY_CONTAINER.get(extension, VIDEO_CODECS_BY_CONTAINER['mp4'])
    audio_allowed = AUDIO_CODECS_BY_CONTAINER.get(extension, AUDIO_CODECS_BY_CONTAINER['mp4'])
    video = str(options.get('videoCodec') or 'h264').lower()
    audio = str(options.get('audioCodec') or 'aac').lower()
    if video not in video_allowed:
        video = 'vp9' if extension == 'webm' else 'prores' if extension == 'mov' and options.get('compression') else 'h264'
    if audio not in audio_allowed:
        audio = 'opus' if extension == 'webm' else 'mp3' if extension in ('mp3', 'avi') else 'pcm' if extension == 'wav' else 'flac' if extension == 'flac' else 'aac'
    if audio_only:
        video = 'copy'
    return video, audio


def clean_error(lines):
    noise = re.compile(r'^(frame=|fps=|stream_|bitrate=|total_size=|out_time|dup_frames=|drop_frames=|speed=|progress=|size=)')
    kept = [line for line in lines if line and not noise.match(line)]
    return '\n'.join(kept[-12:]) or 'FFmpeg could not render this file.'


def reply(value, code=0):
    print(json.dumps(value))
    raise SystemExit(code)


def media_kind(path):
    extension = Path(path).suffix.lower().lstrip('.')
    if extension in VIDEO_INPUTS:
        return 'video'
    if extension in AUDIO_INPUTS:
        return 'audio'
    if extension in IMAGE_INPUTS:
        return 'image'
    return 'other'


def supported_formats_for(kind):
    if kind == 'video':
        return sorted(VIDEO_FORMATS | AUDIO_FORMATS)
    if kind == 'audio':
        return sorted(AUDIO_FORMATS)
    if kind == 'image':
        return sorted(IMAGE_FORMATS)
    return []


def unique_output(folder, stem, extension, suffix):
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', stem).strip() or 'media'
    candidate = folder / f'{safe}-{suffix}.{extension}'
    index = 1
    while candidate.exists():
        candidate = folder / f'{safe}-{suffix} ({index}).{extension}'
        index += 1
    return candidate


def download(url):
    try:
        import yt_dlp
    except ImportError:
        reply({'error': 'yt-dlp is missing. Run: python -m pip install -r requirements.txt'}, 1)
    try:
        folder = Path.home() / 'Videos' / 'YTX'
        folder.mkdir(parents=True, exist_ok=True)
        opts = {'format': 'bestvideo*+bestaudio/best', 'merge_output_format': 'mp4', 'outtmpl': str(folder / '%(title).160s [%(id)s].%(ext)s'), 'noplaylist': True, 'quiet': True, 'no_warnings': True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            if info.get('ext') != 'mp4':
                candidate = str(Path(filename).with_suffix('.mp4'))
                if os.path.exists(candidate):
                    filename = candidate
            reply({'path': filename, 'title': info.get('title', Path(filename).stem)})
    except Exception as exc:
        reply({'error': str(exc)}, 1)


def export(source, target, start, end, kind):
    result = transcode(source, target, {'kind': kind, 'videoCodec': 'h264', 'audioCodec': 'aac', 'videoQuality': 20}, start, end)
    if result.get('error'):
        reply(result, 1)
    reply({'path': target})


def resolve_preview(url):
    try:
        import yt_dlp
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc:
            return {'error': 'Enter a valid video URL.'}
        opts = {'noplaylist': True, 'quiet': True, 'no_warnings': True, 'skip_download': True}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        formats = info.get('formats') or []
        progressive = [f for f in formats if f.get('url') and f.get('vcodec') != 'none' and f.get('acodec') != 'none' and f.get('protocol') in ('https', 'http')]
        candidates = progressive or [f for f in formats if f.get('url') and f.get('vcodec') != 'none' and f.get('protocol') in ('https', 'http')]
        max_preview_height = 720
        lower_or_equal = [f for f in candidates if not f.get('height') or f.get('height') <= max_preview_height]
        selected = max(lower_or_equal or candidates, key=lambda f: (f.get('height') or 0, f.get('tbr') or 0), default=info)
        preview_url = selected.get('url') or info.get('url')
        if not preview_url:
            return {'error': 'This video has no directly playable preview format.'}
        video_formats = []
        audio_formats = []
        seen_video, seen_audio = set(), set()
        for item in formats:
            if not item.get('url'):
                continue
            if item.get('vcodec') != 'none' and item.get('height'):
                height = int(item['height'])
                if height not in seen_video:
                    seen_video.add(height)
                    video_formats.append({'id': item.get('format_id'), 'label': f"{height}p", 'height': height, 'tbr': item.get('tbr') or 0})
            elif item.get('acodec') != 'none' and item.get('vcodec') == 'none':
                abr = int(item.get('abr') or 0)
                if abr not in seen_audio:
                    seen_audio.add(abr)
                    audio_formats.append({'id': item.get('format_id'), 'label': f"{abr or 'Best'} kbps", 'abr': abr})
        video_formats.sort(key=lambda item: item['height'])
        audio_formats.sort(key=lambda item: item['abr'])
        return {'url': preview_url, 'title': info.get('title') or 'Online video', 'duration': info.get('duration') or 0,
                'width': selected.get('width') or info.get('width') or 0, 'height': selected.get('height') or info.get('height') or 0,
                'hasAudio': selected.get('acodec') not in (None, 'none'),
                'thumbnail': info.get('thumbnail') or '', 'videoFormats': video_formats, 'audioFormats': audio_formats}
    except ImportError:
        return {'error': 'yt-dlp is missing. Run: python -m pip install -r requirements.txt'}
    except Exception as exc:
        return {'error': str(exc)}


def download_section(url, target, start, end, kind, video_format=None, audio_format=None, progress=None, transcode_options=None):
    try:
        import yt_dlp
        from yt_dlp.utils import download_range_func
        start, end = float(start), float(end)
        if start < 0 or end <= start:
            return {'error': 'The end time must be after the start time.'}
        target = Path(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        output_template = str(target.parent / (target.stem + '.source.%(ext)s'))
        def hook(data):
            if not progress:
                return
            total = data.get('total_bytes') or data.get('total_bytes_estimate') or 0
            progress({'status': data.get('status', 'downloading'), 'downloaded': data.get('downloaded_bytes', 0), 'total': total,
                      'percent': (data.get('downloaded_bytes', 0) / total * 100) if total else 0,
                      'speed': data.get('speed') or 0, 'eta': data.get('eta'), 'filename': Path(data.get('filename') or '').name})
        options = {'noplaylist': True, 'quiet': True, 'no_warnings': True, 'no_progress': True, 'outtmpl': output_template,
                   'progress_hooks': [hook],
                   'download_ranges': download_range_func(None, [(start, end)]), 'force_keyframes_at_cuts': True}
        if kind == 'audio':
            audio_selector = f"bestaudio[abr<={int(audio_format)}]" if str(audio_format or '').isdigit() else 'bestaudio'
            options.update({'format': audio_selector + '/bestaudio'})
        else:
            selected = f"bestvideo[height<={int(video_format)}]" if str(video_format or '').isdigit() else 'bestvideo*'
            options.update({'format': selected + '+bestaudio/best', 'merge_output_format': target.suffix.lower().lstrip('.') or 'mp4'})
        with yt_dlp.YoutubeDL(options) as ydl:
            ydl.download([url])
        candidates = [p for p in target.parent.glob(target.stem + '.source.*') if p.is_file()]
        if not candidates:
            return {'error': 'yt-dlp completed but the trimmed source file was not found.'}
        source_path = candidates[0]
        result = transcode(str(source_path), str(target), transcode_options or {'kind': kind}, None, None)
        if result.get('error'):
            return result
        try:
            source_path.unlink()
        except OSError:
            pass
        return {'path': str(target)}
    except ImportError:
        return {'error': 'yt-dlp is missing. Run: python -m pip install -r requirements.txt'}
    except Exception as exc:
        return {'error': str(exc)}


def start_download_job(body):
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[job_id] = {'id': job_id, 'status': 'starting', 'percent': 0, 'downloaded': 0, 'total': 0}
    def progress(update):
        with JOBS_LOCK:
            JOBS[job_id].update(update)
    def run():
        with JOBS_LOCK:
            JOBS[job_id]['status'] = 'downloading'
        result = download_section(body['url'], body['target'], body['start'], body['end'], body.get('kind', 'video'), body.get('videoFormat'), body.get('audioFormat'), progress, body)
        with JOBS_LOCK:
            JOBS[job_id].update({'status': 'error' if result.get('error') else 'complete', 'percent': 100 if not result.get('error') else JOBS[job_id].get('percent', 0), 'result': result, 'done': True})
    threading.Thread(target=run, daemon=True).start()
    return {'id': job_id}


def probe_duration(source, ffmpeg):
    result = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-i', str(source)], capture_output=True, text=True)
    text = (result.stderr or '') + (result.stdout or '')
    match = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', text)
    if not match:
        return 0
    return int(match.group(1)) * 3600 + int(match.group(2)) * 60 + float(match.group(3))


def transcode(source, target, options=None, start=None, end=None, progress=None, cancel=None, process_callback=None):
    ffmpeg = os.environ.get('CLIPFORGE_FFMPEG') or shutil.which('ffmpeg')
    if not ffmpeg:
        return {'error': 'FFmpeg was not found. Install FFmpeg and add it to PATH.'}
    options = options or {}
    try:
        ext = Path(target).suffix.lower().lstrip('.')
        source_ext = Path(source).suffix.lower().lstrip('.')
        if ext not in OUTPUT_FORMATS:
            return {'error': f'Unsupported output format: .{ext}'}
        image_output = ext in IMAGE_FORMATS
        audio_only = not image_output and (ext in AUDIO_FORMATS or options.get('kind') == 'audio')
        if media_kind(source) == 'image' and not image_output:
            return {'error': 'Image sources support JPG, PNG, or WebP output.'}
        if media_kind(source) == 'audio' and not audio_only:
            return {'error': 'Audio sources support audio output only.'}
        video_codec = VIDEO_CODECS.get(str(options.get('videoCodec') or 'h264').lower())
        audio_codec = AUDIO_CODECS.get(str(options.get('audioCodec') or 'aac').lower())
        profile = COLOR_PROFILES.get(str(options.get('colorProfile') or 'preserve').lower(), 'invalid')
        if profile == 'invalid':
            return {'error': 'Choose a supported color profile.'}
        if not image_output:
            normalized_video, normalized_audio = normalize_codecs(options, ext, audio_only)
            if not audio_only:
                video_codec = VIDEO_CODECS.get(normalized_video)
            audio_codec = AUDIO_CODECS.get(normalized_audio)
        if not image_output and (not audio_codec or (not audio_only and not video_codec)):
            return {'error': 'Choose a codec supported by the bundled FFmpeg.'}
        if video_codec == 'copy' and profile and not audio_only and not image_output:
            return {'error': 'A color profile cannot be converted while copying the original video stream.'}
        if start is not None or end is not None:
            start, end = float(start or 0), float(end or 0)
            if start < 0 or end <= start:
                return {'error': 'The end time must be after the start time.'}

        compression_name = str(options.get('compression') or '').lower()
        preset = COMPRESSION_PRESETS.get(compression_name) if compression_name else None
        args = [ffmpeg, '-y', '-hide_banner', '-nostdin']
        if start is not None:
            args += ['-ss', str(start)]
        args += ['-i', str(source)]
        if end is not None:
            args += ['-t', str(end - start)]

        filters = []
        if image_output:
            quality = preset['imageQuality'] if preset else 3
            if ext in ('jpg', 'jpeg'):
                args += ['-frames:v', '1', '-c:v', 'mjpeg', '-q:v', str(quality), '-update', '1']
            elif ext == 'webp':
                args += ['-frames:v', '1', '-c:v', 'libwebp', '-quality', str(max(20, 100 - quality * 8)), '-update', '1']
            else:
                args += ['-frames:v', '1', '-c:v', 'png', '-compression_level', '6', '-update', '1']
            if preset:
                filters.append(f"scale='min({preset['maxHeight']},iw)':-2")
        elif audio_only:
            args += ['-vn', '-c:a', audio_codec]
            if audio_codec in ('aac', 'libmp3lame', 'libopus', 'libvorbis'):
                bitrate = preset['audioBitrate'] if preset else int(options.get('audioQuality') or 192)
                if bitrate not in (64, 96, 128, 160, 192, 256, 320):
                    bitrate = 192
                args += ['-b:a', f'{bitrate}k']
        else:
            args += ['-c:v', video_codec]
            if video_codec in ('libx264', 'libx265', 'libaom-av1', 'libvpx-vp9', 'mpeg4'):
                crf = preset['videoCrf'] if preset else int(options.get('videoQuality') or 20)
                if crf not in (18, 20, 21, 23, 24, 28):
                    crf = 20
                args += ['-crf', str(crf)]
                if video_codec in ('libaom-av1', 'libvpx-vp9'):
                    args += ['-b:v', '0']
            if video_codec in ('libx264', 'libx265'):
                args += ['-preset', preset['preset'] if preset else 'fast']
            args += ['-c:a', audio_codec]
            if audio_codec in ('aac', 'libmp3lame'):
                bitrate = preset['audioBitrate'] if preset else 192
                args += ['-b:a', f'{bitrate}k']
            if preset:
                filters.append(f"scale='-2:min({preset['maxHeight']},ih)'")
            if profile:
                primaries, transfer, matrix, color_range = profile
                probe = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-i', str(source)], capture_output=True, text=True)
                probe_text = (probe.stderr or '') + (probe.stdout or '')
                known_color_tags = ('bt709', 'bt2020', 'smpte170m', 'smpte240m', 'bt470bg', 'bt470m', 'smpte432', 'smpte431')
                input_override = '' if any(tag in probe_text.lower() for tag in known_color_tags) else ':iall=bt709'
                filters.append(f'colorspace=all={matrix}{input_override}')
                args += ['-color_primaries', primaries, '-color_trc', transfer, '-colorspace', matrix, '-color_range', color_range]
            if ext in ('mp4', 'm4v', 'mov'):
                args += ['-movflags', '+faststart']
        if filters:
            args += ['-vf', ','.join(filters)]
        threads = options.get('threads')
        try:
            threads = int(threads)
        except (TypeError, ValueError):
            threads = 0
        if threads > 0 and not image_output:
            args += ['-threads', str(max(1, min(16, threads)))]
        args += ['-progress', 'pipe:1', '-nostats']
        args.append(str(target))

        duration = probe_duration(source, ffmpeg)
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                   encoding='utf-8', errors='replace', bufsize=1,
                                   creationflags=getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0) if os.name == 'nt' else 0)
        if process_callback:
            process_callback(process)
        log_tail = []
        try:
            for line in process.stdout:
                line = line.strip()
                if line:
                    log_tail.append(line)
                    if len(log_tail) > 40:
                        log_tail.pop(0)
                if cancel is not None and cancel.is_set():
                    process.terminate()
                    break
                match = re.match(r'out_time_us=(\d+)', line)
                if match and progress and duration > 0:
                    percent = min(99, max(1, int(int(match.group(1)) / 1_000_000 / duration * 100)))
                    progress(percent)
            process.wait()
        finally:
            if process.stdout:
                process.stdout.close()
        if cancel is not None and cancel.is_set():
            try: os.remove(target)
            except OSError: pass
            return {'error': 'Cancelled.', 'cancelled': True}
        if process.returncode:
            try: os.remove(target)
            except OSError: pass
            return {'error': clean_error(log_tail)}
        if progress:
            progress(100)
        return {'path': str(target)}
    except Exception as exc:
        return {'error': str(exc)}


def export_result(source, target, start, end, kind, video_quality=None, audio_quality=None, video_codec='h264', audio_codec='aac', color_profile='preserve'):
    return transcode(source, target, {'kind': kind, 'videoQuality': video_quality, 'audioQuality': audio_quality, 'videoCodec': video_codec, 'audioCodec': audio_codec, 'colorProfile': color_profile}, start, end)


def normalize_convert_files(body):
    raw_files = body.get('files') or []
    normalized = []
    fallback_format = str(body.get('format') or '').lower().lstrip('.')
    for item in raw_files:
        if isinstance(item, str):
            item = {'path': item, 'format': fallback_format}
        if not isinstance(item, dict):
            continue
        source = Path(str(item.get('path') or ''))
        if not source.is_file():
            normalized.append({'error': f'Media not found: {source.name or source}'})
            continue
        kind = media_kind(source)
        if kind == 'other':
            normalized.append({'error': f'Unsupported media type: {source.name}'})
            continue
        extension = str(item.get('format') or fallback_format or '').lower().lstrip('.')
        allowed = supported_formats_for(kind)
        if extension not in allowed:
            extension = 'mp4' if kind == 'video' else 'mp3' if kind == 'audio' else 'jpg'
        normalized.append({'path': str(source), 'format': extension, 'kind': kind})
    return normalized


def start_convert_job(body):
    files = normalize_convert_files(body)
    if not files:
        return {'error': 'Add at least one media file.'}
    invalid = next((item for item in files if item.get('error')), None)
    if invalid:
        return {'error': invalid['error']}
    output_dir = Path(body.get('outputDir') or '')
    if not str(output_dir):
        output_dir = Path.home() / 'Downloads' / 'YTX Exports'
    output_dir.mkdir(parents=True, exist_ok=True)
    mode = str(body.get('mode') or 'convert').lower()
    compression = str(body.get('compression') or '').lower()
    if compression and compression not in COMPRESSION_PRESETS:
        compression = 'balanced'
    workers = body.get('workers')
    try:
        workers = max(1, min(4, int(workers or 1)))
    except (TypeError, ValueError):
        workers = 1
    threads = body.get('threads')
    try:
        threads = max(1, min(16, int(threads or 2)))
    except (TypeError, ValueError):
        threads = 2

    job_id = uuid.uuid4().hex
    cancel = threading.Event()
    job = {
        'id': job_id,
        'status': 'converting',
        'percent': 0,
        'done': False,
        'mode': mode,
        'workers': workers,
        'threads': threads,
        'message': f'Preparing {len(files)} file(s)…',
        'files': []
    }
    for index, item in enumerate(files):
        job['files'].append({
            'source': item['path'],
            'name': Path(item['path']).name,
            'format': item['format'],
            'kind': item['kind'],
            'status': 'queued',
            'progress': 0,
            'index': index
        })
    with JOBS_LOCK:
        JOBS[job_id] = job
        JOB_EVENTS[job_id] = cancel
    processes = set()
    process_lock = threading.Lock()

    def register_process(process):
        with process_lock:
            processes.add(process)
        if cancel.is_set():
            try:
                process.terminate()
            except OSError:
                pass

    def update_file(index, **values):
        with JOBS_LOCK:
            entry = job['files'][index]
            entry.update(values)
            completed = sum(entry_item.get('progress', 0) for entry_item in job['files'])
            job['percent'] = int(completed / max(1, len(job['files'])))
            active = next((item for item in job['files'] if item.get('status') == 'converting'), None)
            if active:
                job['message'] = f"{active.get('name', 'Media')} · {active.get('status_text', 'Converting')}"
            else:
                finished = sum(1 for item in job['files'] if item.get('status') in ('complete', 'failed', 'cancelled'))
                job['message'] = f"Rendered {finished} of {len(job['files'])} file(s)"

    def work(item, index):
        if cancel.is_set():
            update_file(index, status='cancelled', status_text='Cancelled')
            return {'source': item['path'], 'cancelled': True}
        update_file(index, status='converting', status_text='Converting')
        output = unique_output(output_dir, Path(item['path']).stem, item['format'], 'compressed' if mode == 'compress' else 'converted')
        options = {
            'kind': item['kind'],
            'format': item['format'],
            'compression': compression,
            'videoCodec': body.get('videoCodec') or ('copy' if mode == 'compress' and item['kind'] == 'video' else 'h264'),
            'audioCodec': body.get('audioCodec') or 'aac',
            'videoQuality': body.get('videoQuality') or 20,
            'audioQuality': body.get('audioQuality') or 192,
            'colorProfile': body.get('colorProfile') or 'preserve',
            'threads': threads
        }
        # The copy shortcut is incompatible with rescaling, color conversion,
        # and per-file format changes; fall back to H.264 for those cases.
        if options['videoCodec'] == 'copy' and (compression or item['format'] != Path(item['path']).suffix.lower().lstrip('.')):
            options['videoCodec'] = 'h264'
        if item['kind'] == 'image':
            options['videoCodec'] = 'h264'
        def on_progress(percent):
            update_file(index, progress=percent, status_text=f'Converting · {percent}%')
        result = transcode(item['path'], str(output), options, progress=on_progress, cancel=cancel, process_callback=register_process)
        if result.get('error'):
            if result.get('cancelled') or cancel.is_set():
                update_file(index, status='cancelled', status_text='Cancelled', progress=0, error='')
            else:
                update_file(index, status='failed', status_text='Failed', progress=0, error=result['error'])
            return {'source': item['path'], **result}
        update_file(index, status='complete', status_text='Complete', progress=100, output=str(output))
        return {'source': item['path'], 'path': str(output), 'format': item['format'], 'kind': item['kind']}

    def run():
        results = [None] * len(files)
        try:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(work, item, index): index for index, item in enumerate(files)}
                for future in futures:
                    index = futures[future]
                    try:
                        results[index] = future.result()
                    except Exception as exc:
                        results[index] = {'source': files[index]['path'], 'error': str(exc)}
            cancelled = cancel.is_set() or any(result and result.get('cancelled') for result in results)
            failures = [result for result in results if result and result.get('error')]
            with JOBS_LOCK:
                job['files'] = [dict(entry, result=results[entry['index']]) for entry in job['files']]
                job['results'] = results
                job['done'] = True
                if cancelled:
                    job.update({'status': 'cancelled', 'error': 'Conversion cancelled.', 'percent': job['percent']})
                elif failures and len(failures) == len(results):
                    job.update({'status': 'failed', 'error': failures[0].get('error') or 'Conversion failed.', 'percent': job['percent']})
                else:
                    job.update({'status': 'complete', 'percent': 100, 'message': f'Rendered {len(results) - len(failures)} of {len(results)} file(s).'})
        finally:
            with process_lock:
                processes.clear()
            with JOBS_LOCK:
                JOB_EVENTS.pop(job_id, None)

    threading.Thread(target=run, daemon=True).start()
    return {'id': job_id, 'workers': workers, 'threads': threads}


def cancel_convert_job(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        event = JOB_EVENTS.get(job_id)
        if not job:
            return {'error': 'Unknown conversion job.'}
        job['cancelling'] = True
    if event is not None:
        event.set()
    return {'ok': True}


class ApiHandler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        pass

    def _respond(self, result, status=200):
        data = json.dumps(result).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/health':
            try:
                import yt_dlp
                yt_dlp_available = True
                yt_dlp_version = yt_dlp.version.__version__
            except Exception:
                yt_dlp_available, yt_dlp_version = False, ''
            ffmpeg = os.environ.get('CLIPFORGE_FFMPEG') or shutil.which('ffmpeg')
            self._respond({'ok': True, 'ytDlp': yt_dlp_available, 'ytDlpVersion': yt_dlp_version, 'ffmpeg': bool(ffmpeg and Path(ffmpeg).exists()), 'formats': sorted(OUTPUT_FORMATS), 'videoFormats': sorted(VIDEO_FORMATS), 'audioFormats': sorted(AUDIO_FORMATS), 'imageFormats': sorted(IMAGE_FORMATS), 'videoCodecs': list(VIDEO_CODECS), 'audioCodecs': list(AUDIO_CODECS), 'colorProfiles': list(COLOR_PROFILES), 'compressionPresets': list(COMPRESSION_PRESETS)})
        elif self.path.startswith('/jobs/'):
            with JOBS_LOCK:
                result = JOBS.get(self.path.rsplit('/', 1)[-1])
            self._respond(result or {'error': 'Unknown job.'}, 404 if result is None else 200)
        else:
            self._respond({'error': 'Not found.'}, 404)

    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size > 2_000_000:
                return self._respond({'error': 'Request is too large.'}, 413)
            raw = self.rfile.read(size).decode('utf-8') if size else '{}'
            body = json.loads(raw or '{}')
            route = self.path
            if route == '/resolve':
                result = resolve_preview(body.get('url', ''))
            elif route == '/download-section':
                result = download_section(body['url'], body['target'], body['start'], body['end'], body.get('kind', 'video'))
            elif route == '/download/start':
                result = start_download_job(body)
            elif route == '/convert/start':
                result = start_convert_job(body)
            elif route.startswith('/jobs/') and route.endswith('/cancel'):
                result = cancel_convert_job(route.split('/')[2])
            elif route == '/export':
                result = export_result(body['source'], body['target'], body['start'], body['end'], body.get('kind', 'video'), body.get('videoQuality'), body.get('audioQuality'), body.get('videoCodec', 'h264'), body.get('audioCodec', 'aac'), body.get('colorProfile', 'preserve'))
            else:
                return self._respond({'error': 'Not found.'}, 404)
            self._respond(result, 400 if result.get('error') else 200)
        except Exception as exc:
            self._respond({'error': str(exc)}, 400)


def serve():
    server = ThreadingHTTPServer(('127.0.0.1', 0), ApiHandler)
    server.daemon_threads = True
    print(json.dumps({'ready': True, 'port': server.server_address[1]}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--server':
        serve()
    elif len(sys.argv) > 1 and sys.argv[1] == 'download' and len(sys.argv) >= 3:
        download(sys.argv[2])
    elif len(sys.argv) > 1 and sys.argv[1] == 'export' and len(sys.argv) >= 7:
        export(*sys.argv[2:7])
    else:
        reply({'error': 'Invalid backend command.'}, 2)
