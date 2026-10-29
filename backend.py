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

VIDEO_CODECS = {
    'h264': 'libx264', 'hevc': 'libx265', 'av1': 'libaom-av1',
    'vp9': 'libvpx-vp9', 'vp8': 'libvpx',
    'prores': 'prores_ks', 'prores_lt': 'prores_ks', 'prores_hq': 'prores_ks', 'prores_4444': 'prores_ks',
    'dnxhd': 'dnxhd', 'dnxhr': 'dnxhd',
    'mpeg2': 'mpeg2video', 'mpeg4': 'mpeg4',
    'theora': 'libtheora', 'wmv2': 'wmv2', 'h263': 'h263', 'flv1': 'flv1',
    'copy': 'copy'
}
AUDIO_CODECS = {
    'aac': 'aac', 'mp3': 'libmp3lame', 'opus': 'libopus', 'vorbis': 'libvorbis',
    'flac': 'flac', 'alac': 'alac', 'pcm': 'pcm_s16le', 'pcm24': 'pcm_s24le', 'pcm32': 'pcm_s32le',
    'ac3': 'ac3', 'eac3': 'eac3', 'mp2': 'mp2', 'wmav2': 'wmav2',
    'copy': 'copy'
}
COLOR_PROFILES = {
    'preserve': None,
    'bt709': ('bt709', 'bt709', 'bt709', 'tv'),
    'srgb': ('bt709', 'iec61966-2-1', 'bt709', 'tv'),
    'bt2020': ('bt2020', 'bt2020-10', 'bt2020nc', 'tv'),
    'bt2020_hlg': ('bt2020', 'arib-std-b67', 'bt2020nc', 'tv'),
    'bt2020_pq': ('bt2020', 'smpte2084', 'bt2020nc', 'tv'),
    'display_p3': ('smpte432', 'iec61966-2-1', 'bt709', 'tv'),
    'dci_p3': ('smpte431', 'bt709', 'bt709', 'tv'),
    'smpte170m': ('smpte170m', 'smpte170m', 'smpte170m', 'tv'),
    'bt470bg': ('bt470bg', 'gamma28', 'bt470bg', 'tv'),
    'smpte240m': ('smpte240m', 'smpte240m', 'smpte240m', 'tv'),
    'linear': ('bt709', 'linear', 'bt709', 'tv'),
}
VIDEO_FORMATS = {'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'ts', 'm2ts', 'mts', 'mpg', 'mxf', 'wmv', 'flv', '3gp', 'ogv'}
AUDIO_FORMATS = {'mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'ac3', 'wma', 'aiff'}
IMAGE_FORMATS = {'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'tga'}
OUTPUT_FORMATS = VIDEO_FORMATS | AUDIO_FORMATS | IMAGE_FORMATS

VIDEO_INPUTS = {'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'ts', 'mts', 'm2ts', 'mpg', 'mpeg', 'mxf', 'wmv', 'flv', '3gp', 'ogv'}
AUDIO_INPUTS = {'mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'ac3', 'wma', 'aiff', 'aif'}
IMAGE_INPUTS = {'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'tga'}

COMPRESSION_PRESETS = {
    'light': {'videoCrf': 21, 'maxHeight': 1080, 'preset': 'medium', 'audioBitrate': 160, 'imageQuality': 3},
    'balanced': {'videoCrf': 24, 'maxHeight': 1080, 'preset': 'fast', 'audioBitrate': 128, 'imageQuality': 6},
    'maximum': {'videoCrf': 28, 'maxHeight': 720, 'preset': 'fast', 'audioBitrate': 96, 'imageQuality': 10},
}

IMAGE_CODECS = {'jpg': 'mjpeg', 'jpeg': 'mjpeg', 'png': 'png', 'webp': 'libwebp', 'bmp': 'bmp', 'tif': 'tiff', 'tiff': 'tiff', 'tga': 'targa'}

VIDEO_CODECS_BY_CONTAINER = {
    'mp4': ('h264', 'hevc', 'av1', 'mpeg4', 'copy'),
    'm4v': ('h264', 'hevc', 'mpeg4', 'copy'),
    'mov': ('h264', 'hevc', 'prores', 'prores_lt', 'prores_hq', 'prores_4444', 'dnxhd', 'dnxhr', 'mpeg4', 'copy'),
    'mkv': ('h264', 'hevc', 'av1', 'vp9', 'vp8', 'prores', 'prores_hq', 'prores_4444', 'dnxhd', 'dnxhr', 'mpeg2', 'mpeg4', 'theora', 'copy'),
    'webm': ('av1', 'vp9', 'vp8', 'copy'),
    'avi': ('h264', 'mpeg4', 'mpeg2', 'wmv2', 'copy'),
    'ts': ('h264', 'hevc', 'mpeg2', 'mpeg4', 'copy'),
    'm2ts': ('h264', 'hevc', 'mpeg2', 'copy'),
    'mts': ('h264', 'hevc', 'mpeg2', 'copy'),
    'mpg': ('mpeg2', 'mpeg4', 'copy'),
    'mxf': ('dnxhd', 'dnxhr', 'prores', 'prores_hq', 'prores_4444', 'mpeg2', 'copy'),
    'wmv': ('wmv2', 'copy'),
    'flv': ('h264', 'flv1', 'copy'),
    '3gp': ('h264', 'h263', 'mpeg4', 'copy'),
    'ogv': ('theora', 'vp8', 'copy'),
}
AUDIO_CODECS_BY_CONTAINER = {
    'mp3': ('mp3', 'copy'),
    'm4a': ('aac', 'alac', 'copy'),
    'wav': ('pcm', 'pcm24', 'pcm32', 'copy'),
    'flac': ('flac', 'copy'),
    'ogg': ('vorbis', 'opus', 'flac', 'copy'),
    'opus': ('opus', 'copy'),
    'aac': ('aac', 'copy'),
    'ac3': ('ac3', 'eac3', 'copy'),
    'wma': ('wmav2', 'copy'),
    'aiff': ('pcm', 'pcm24', 'pcm32', 'copy'),
    'mp4': ('aac', 'mp3', 'alac', 'ac3', 'eac3', 'copy'),
    'm4v': ('aac', 'mp3', 'alac', 'copy'),
    'mov': ('aac', 'mp3', 'alac', 'pcm', 'pcm24', 'pcm32', 'ac3', 'eac3', 'copy'),
    'mkv': ('aac', 'mp3', 'opus', 'vorbis', 'flac', 'alac', 'pcm', 'pcm24', 'pcm32', 'ac3', 'eac3', 'mp2', 'copy'),
    'webm': ('opus', 'vorbis', 'copy'),
    'avi': ('mp3', 'pcm', 'ac3', 'mp2', 'copy'),
    'ts': ('aac', 'mp3', 'ac3', 'eac3', 'mp2', 'copy'),
    'm2ts': ('aac', 'ac3', 'eac3', 'mp2', 'pcm', 'copy'),
    'mts': ('aac', 'ac3', 'eac3', 'mp2', 'pcm', 'copy'),
    'mpg': ('mp2', 'mp3', 'ac3', 'pcm', 'copy'),
    'mxf': ('pcm', 'pcm24', 'pcm32', 'copy'),
    'wmv': ('wmav2', 'mp3', 'copy'),
    'flv': ('aac', 'mp3', 'copy'),
    '3gp': ('aac', 'copy'),
    'ogv': ('vorbis', 'opus', 'flac', 'copy'),
}


def normalize_codecs(options, extension, audio_only):
    video_allowed = VIDEO_CODECS_BY_CONTAINER.get(extension, VIDEO_CODECS_BY_CONTAINER['mp4'])
    audio_allowed = AUDIO_CODECS_BY_CONTAINER.get(extension, AUDIO_CODECS_BY_CONTAINER['mp4'])
    video = str(options.get('videoCodec') or 'h264').lower()
    audio = str(options.get('audioCodec') or 'aac').lower()
    if video not in video_allowed:
        defaults = {'webm': 'vp9', 'mxf': 'dnxhr', 'mpg': 'mpeg2', 'wmv': 'wmv2', 'flv': 'h264',
                    '3gp': 'h264', 'ogv': 'theora', 'm2ts': 'h264', 'mts': 'h264'}
        video = defaults.get(extension, 'h264')
        if extension == 'mov' and options.get('compression'):
            video = 'prores'
    if audio not in audio_allowed:
        defaults = {'webm': 'opus', 'mp3': 'mp3', 'avi': 'mp3', 'wav': 'pcm', 'flac': 'flac',
                    'ogg': 'vorbis', 'opus': 'opus', 'm4a': 'aac', 'aac': 'aac', 'ac3': 'ac3',
                    'wma': 'wmav2', 'aiff': 'pcm', 'mxf': 'pcm24'}
        audio = defaults.get(extension, 'aac')
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
        playable = [f for f in formats if f.get('url') and f.get('protocol') in ('https', 'http')]
        progressive = [f for f in playable if f.get('vcodec') != 'none' and f.get('acodec') != 'none']
        video_only = [f for f in playable if f.get('vcodec') != 'none']
        candidates = progressive or video_only
        max_preview_height = 720
        lower_or_equal = [f for f in candidates if not f.get('height') or f.get('height') <= max_preview_height]
        selected = max(lower_or_equal or candidates, key=lambda f: (f.get('height') or 0, f.get('tbr') or 0), default=info)
        preview_url = selected.get('url') or info.get('url')
        if not preview_url:
            return {'error': 'This video has no directly playable preview format.'}
        # A video-only preview needs a separate audio stream to stay in sync.
        audio_candidates = [f for f in playable if f.get('vcodec') == 'none' and f.get('acodec') not in (None, 'none')]
        best_audio = max(audio_candidates, key=lambda f: (f.get('abr') or 0, f.get('tbr') or 0), default=None)
        preview_audio_url = ''
        if selected.get('acodec') in (None, 'none') and best_audio:
            preview_audio_url = best_audio.get('url') or ''
        # Source dimensions come from the largest video stream, not the 720p preview.
        source_video = max((f for f in playable if f.get('vcodec') != 'none' and f.get('height')),
                           key=lambda f: (f.get('height') or 0, f.get('width') or 0, f.get('tbr') or 0), default=None)
        source_width = int((source_video or {}).get('width') or info.get('width') or 0)
        source_height = int((source_video or {}).get('height') or info.get('height') or 0)
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
                    label = f'{height}p'
                    if height >= 4320:
                        label += ' · 8K'
                    elif height >= 2160:
                        label += ' · 4K UHD'
                    elif height >= 1440:
                        label += ' · QHD'
                    video_formats.append({'id': item.get('format_id'), 'label': label, 'height': height, 'tbr': item.get('tbr') or 0})
            elif item.get('acodec') != 'none' and item.get('vcodec') == 'none':
                abr = int(item.get('abr') or 0)
                if abr not in seen_audio:
                    seen_audio.add(abr)
                    audio_formats.append({'id': item.get('format_id'), 'label': f"{abr or 'Best'} kbps", 'abr': abr})
        video_formats.sort(key=lambda item: item['height'])
        audio_formats.sort(key=lambda item: item['abr'])
        return {'url': preview_url, 'audioUrl': preview_audio_url, 'title': info.get('title') or 'Online video',
                'duration': info.get('duration') or 0,
                'width': selected.get('width') or source_width or 0, 'height': selected.get('height') or source_height or 0,
                'sourceWidth': source_width, 'sourceHeight': source_height,
                'hasAudio': selected.get('acodec') not in (None, 'none') or bool(preview_audio_url),
                'thumbnail': info.get('thumbnail') or '', 'videoFormats': video_formats, 'audioFormats': audio_formats}
    except ImportError:
        return {'error': 'yt-dlp is missing. Run: python -m pip install -r requirements.txt'}
    except Exception as exc:
        return {'error': str(exc)}


def ffmpeg_binary():
    return os.environ.get('CLIPFORGE_FFMPEG') or shutil.which('ffmpeg')


def probe_has_audio(path):
    ffmpeg = ffmpeg_binary()
    if not ffmpeg:
        return True
    try:
        probe = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-i', str(path)], capture_output=True, text=True)
        text = (probe.stderr or '') + (probe.stdout or '')
        return bool(re.search(r'Stream #\d+:\d+.*Audio:', text))
    except Exception:
        return True


def merge_video_audio(video_path, audio_path, output_path):
    ffmpeg = ffmpeg_binary()
    if not ffmpeg:
        return {'error': 'FFmpeg is required to merge the downloaded video and audio streams.'}
    attempts = [
        ['-map', '0:v:0', '-map', '1:a:0', '-c', 'copy'],
        ['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k'],
        ['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k']
    ]
    last_error = ''
    for codec_args in attempts:
        args = [ffmpeg, '-y', '-hide_banner', '-nostdin', '-i', str(video_path), '-i', str(audio_path)]
        args += codec_args + ['-shortest', str(output_path)]
        result = subprocess.run(args, capture_output=True, text=True)
        if result.returncode == 0 and Path(output_path).exists():
            return {'path': str(output_path)}
        last_error = clean_error((result.stderr or '').splitlines())
    return {'error': 'FFmpeg could not merge the downloaded video and audio streams.' + (f'\n{last_error}' if last_error else '')}


def download_section(url, target, start, end, kind, video_format=None, audio_format=None, progress=None, transcode_options=None):
    try:
        import yt_dlp
        from yt_dlp.utils import download_range_func
        start, end = float(start), float(end)
        if start < 0 or end <= start:
            return {'error': 'The end time must be after the start time.'}
        target = Path(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        def hook(data):
            if not progress:
                return
            total = data.get('total_bytes') or data.get('total_bytes_estimate') or 0
            progress({'status': data.get('status', 'downloading'), 'downloaded': data.get('downloaded_bytes', 0), 'total': total,
                      'percent': (data.get('downloaded_bytes', 0) / total * 100) if total else 0,
                      'speed': data.get('speed') or 0, 'eta': data.get('eta'), 'filename': Path(data.get('filename') or '').name})
        base_options = {'noplaylist': True, 'quiet': True, 'no_warnings': True, 'no_progress': True,
                        'progress_hooks': [hook], 'download_ranges': download_range_func(None, [(start, end)]),
                        'force_keyframes_at_cuts': True}

        def download_stream(selector, template, merge_format=''):
            options = dict(base_options)
            options.update({'format': selector, 'outtmpl': str(template)})
            if merge_format:
                options['merge_output_format'] = merge_format
            with yt_dlp.YoutubeDL(options) as ydl:
                ydl.download([url])

        def find_files(suffix):
            return sorted((p for p in target.parent.glob(target.stem + suffix) if p.is_file()),
                          key=lambda p: p.stat().st_mtime, reverse=True)

        source_path = None
        merge_candidates = []
        if kind == 'audio':
            audio_selector = f"bestaudio[abr<={int(audio_format)}]/bestaudio/best" if str(audio_format or '').isdigit() else 'bestaudio/best'
            download_stream(audio_selector, target.parent / (target.stem + '.source.%(ext)s'))
            candidates = find_files('.source.*')
            if not candidates:
                return {'error': 'yt-dlp completed but the downloaded audio file was not found.'}
            source_path = candidates[0]
        else:
            selected = f"bestvideo[height<={int(video_format)}]" if str(video_format or '').isdigit() else 'bestvideo*'
            merge_format = target.suffix.lower().lstrip('.') or 'mp4'
            primary_error = ''
            try:
                download_stream(selected + '+bestaudio/best', target.parent / (target.stem + '.source.%(ext)s'), merge_format)
                candidates = find_files('.source.*')
                if candidates:
                    source_path = candidates[0]
            except Exception as exc:
                primary_error = str(exc)

            # Some videos expose no muxable "best" pair. Download the best video
            # and best audio separately, then merge them explicitly, including
            # when only a lower-bitrate audio track exists.
            if source_path is None or not probe_has_audio(source_path):
                video_selector = f"bestvideo[height<={int(video_format)}]/bestvideo*" if str(video_format or '').isdigit() else 'bestvideo*'
                audio_selector = 'bestaudio/bestaudio*'
                try:
                    download_stream(video_selector, target.parent / (target.stem + '.video.%(ext)s'))
                    download_stream(audio_selector, target.parent / (target.stem + '.audio.%(ext)s'))
                except Exception as exc:
                    message = str(exc) or primary_error or 'yt-dlp could not download the selected video and audio streams.'
                    return {'error': message}
                videos = [p for p in find_files('.video.*') if p.suffix.lower() not in ('.part', '.ytdl')]
                audios = [p for p in find_files('.audio.*') if p.suffix.lower() not in ('.part', '.ytdl')]
                if not videos:
                    return {'error': primary_error or 'The selected video stream could not be downloaded.'}
                if not audios:
                    # No separate audio exists; keep the best progressive file if one was downloaded.
                    if source_path is None:
                        return {'error': 'This video has no downloadable audio track.'}
                else:
                    merged = target.parent / (target.stem + '.merged.mkv')
                    result = merge_video_audio(videos[0], audios[0], merged)
                    if result.get('error'):
                        return result
                    source_path = merged
                    merge_candidates.extend(videos + audios)
            if source_path is None:
                return {'error': primary_error or 'yt-dlp completed but the downloaded video file was not found.'}

        result = transcode(str(source_path), str(target), transcode_options or {'kind': kind}, None, None)
        if result.get('error'):
            return result
        for leftover in [source_path, *merge_candidates]:
            try:
                Path(leftover).unlink()
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


def probe_color_tags(ffmpeg, source):
    tags = {'space': 'bt709', 'primaries': 'bt709', 'trc': 'bt709', 'range': 'tv'}
    try:
        probe = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-i', str(source)], capture_output=True, text=True)
        text = (probe.stderr or '') + (probe.stdout or '')
        match = re.search(r'Video:.*?yuv\w*\(([^)]*)\)', text)
        if not match:
            return tags
        parts = [part.strip() for part in match.group(1).split(',')]
        for part in parts:
            if part in ('tv', 'mpeg'):
                tags['range'] = 'tv'
            elif part in ('pc', 'jpeg'):
                tags['range'] = 'pc'
        known = ('bt709', 'bt470m', 'bt470bg', 'smpte170m', 'smpte240m', 'film', 'smpte428',
                 'smpte431', 'smpte432', 'bt2020', 'bt2020nc', 'bt2020c', 'bt2020-10', 'bt2020-12',
                 'smpte2084', 'arib-std-b67', 'iec61966-2-1', 'iec61966-2-4', 'srgb', 'linear')
        colors = next((part for part in parts if '/' in part or part in known), '')
        if colors:
            combo = colors.split('/')
            if len(combo) >= 3:
                tags['space'], tags['primaries'], tags['trc'] = combo[0], combo[1], combo[2]
            elif len(combo) == 2:
                tags['space'], tags['primaries'] = combo[0], combo[1]
            else:
                tags['space'] = combo[0]
                tags['primaries'] = 'bt2020' if combo[0] == 'bt2020nc' else combo[0]
                tags['trc'] = 'bt2020-10' if combo[0] == 'bt2020nc' else combo[0]
    except Exception:
        pass
    return tags


def target_video_quality(options, preset):
    try:
        crf = int(preset['videoCrf'] if preset else (options.get('videoQuality') or 20))
    except (TypeError, ValueError):
        crf = 20
    return crf if crf in (18, 20, 21, 23, 24, 28) else 20


def target_audio_bitrate(options, preset, fallback=192):
    try:
        bitrate = int(preset['audioBitrate'] if preset else (options.get('audioQuality') or fallback))
    except (TypeError, ValueError):
        bitrate = fallback
    return max(64, min(640, bitrate))


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
        video_key = str(options.get('videoCodec') or 'h264').lower()
        audio_key = str(options.get('audioCodec') or 'aac').lower()
        video_codec = VIDEO_CODECS.get(video_key)
        audio_codec = AUDIO_CODECS.get(audio_key)
        profile = COLOR_PROFILES.get(str(options.get('colorProfile') or 'preserve').lower(), 'invalid')
        if profile == 'invalid':
            return {'error': 'Choose a supported color profile.'}
        if not image_output:
            video_key, audio_key = normalize_codecs(options, ext, audio_only)
            if not audio_only:
                video_codec = VIDEO_CODECS.get(video_key)
            audio_codec = AUDIO_CODECS.get(audio_key)
        if not image_output and (not audio_codec or (not audio_only and not video_codec)):
            return {'error': 'Choose a codec supported by the bundled FFmpeg.'}
        if ext == 'aiff' and audio_codec in ('pcm_s16le', 'pcm_s24le', 'pcm_s32le'):
            audio_codec = audio_codec.replace('le', 'be')
        if video_key == 'copy' and profile and not audio_only and not image_output:
            return {'error': 'A color profile cannot be converted while copying the original video stream.'}
        if start is not None or end is not None:
            start, end = float(start or 0), float(end or 0)
            if start < 0 or end <= start:
                return {'error': 'The end time must be after the start time.'}

        compression_name = str(options.get('compression') or '').lower()
        preset = COMPRESSION_PRESETS.get(compression_name) if compression_name else None
        if preset and video_key == 'copy' and not audio_only and not image_output:
            return {'error': 'Compression presets cannot be applied while copying the original video stream. Choose H.264, HEVC, AV1, or VP9.'}
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
            elif ext in ('tif', 'tiff'):
                args += ['-frames:v', '1', '-c:v', 'tiff', '-compression_algo', 'lzw', '-update', '1']
            elif ext == 'bmp':
                args += ['-frames:v', '1', '-c:v', 'bmp', '-update', '1']
            elif ext == 'tga':
                args += ['-frames:v', '1', '-c:v', 'targa', '-update', '1']
            else:
                args += ['-frames:v', '1', '-c:v', 'png', '-compression_level', '6', '-update', '1']
            if preset:
                filters.append(f"scale='-2:min({preset['maxHeight']},ih)'")
        elif audio_only:
            args += ['-vn', '-c:a', audio_codec]
            if audio_codec in ('aac', 'libmp3lame', 'libopus', 'libvorbis', 'ac3', 'eac3', 'mp2', 'wmav2'):
                args += ['-b:a', f'{target_audio_bitrate(options, preset)}k']
        else:
            quality = target_video_quality(options, preset)
            args += ['-c:v', video_codec]
            if video_codec in ('libx264', 'libx265', 'libaom-av1', 'libvpx-vp9', 'libvpx'):
                args += ['-crf', str(quality)]
                if video_codec in ('libaom-av1', 'libvpx-vp9', 'libvpx'):
                    args += ['-b:v', '0']
            if video_codec in ('libx264', 'libx265'):
                args += ['-preset', preset['preset'] if preset else 'fast']
            elif video_codec == 'libaom-av1':
                args += ['-cpu-used', '6', '-row-mt', '1']
            elif video_codec in ('libvpx-vp9', 'libvpx'):
                args += ['-row-mt', '1', '-deadline', 'good', '-cpu-used', '2']
            elif video_codec == 'prores_ks':
                profile_map = {'prores': '2', 'prores_lt': '1', 'prores_hq': '3', 'prores_4444': '4'}
                pix_fmt = 'yuv444p10le' if video_key == 'prores_4444' else 'yuv422p10le'
                args += ['-profile:v', profile_map.get(video_key, '2'), '-pix_fmt', pix_fmt, '-vendor', 'apl0']
            elif video_codec == 'dnxhd':
                if video_key == 'dnxhr':
                    args += ['-profile:v', 'dnxhr_hq', '-pix_fmt', 'yuv422p']
                else:
                    args += ['-pix_fmt', 'yuv422p']
            elif video_codec in ('mpeg2video', 'mpeg4'):
                args += ['-q:v', str({18: 2, 20: 3, 21: 4, 23: 5, 24: 6, 28: 9}.get(quality, 4)), '-pix_fmt', 'yuv420p']
            elif video_codec == 'libtheora':
                args += ['-q:v', str({18: 9, 20: 8, 21: 8, 23: 7, 24: 6, 28: 5}.get(quality, 7))]
            elif video_codec == 'h263':
                bitrate = {18: 8000, 20: 6000, 21: 5000, 23: 4000, 24: 3000, 28: 1500}.get(quality, 4000)
                args += ['-b:v', f'{bitrate}k', '-pix_fmt', 'yuv420p']
                filters.append('scale=352:288:force_original_aspect_ratio=decrease,pad=352:288:(ow-iw)/2:(oh-ih)/2')
            elif video_codec in ('wmv2', 'flv1'):
                bitrate = {18: 8000, 20: 6000, 21: 5000, 23: 4000, 24: 3000, 28: 1500}.get(quality, 4000)
                args += ['-b:v', f'{bitrate}k', '-pix_fmt', 'yuv420p']
            args += ['-c:a', audio_codec]
            if audio_codec in ('aac', 'libmp3lame', 'libopus', 'libvorbis', 'ac3', 'eac3', 'mp2', 'wmav2'):
                args += ['-b:a', f'{target_audio_bitrate(options, preset)}k']
            if preset:
                filters.append(f"scale='-2:min({preset['maxHeight']},ih)'")
            if profile:
                primaries, transfer, matrix, color_range = profile
                if transfer in ('smpte2084', 'arib-std-b67'):
                    source_tags = probe_color_tags(ffmpeg, source)
                    filters.append(
                        'zscale=matrixin={space}:primariesin={primaries}:transferin={trc}:rangein={range}'
                        ':matrix={out_matrix}:primaries={out_primaries}:transfer={out_trc}:range={out_range}:npl=100'.format(
                            space=source_tags['space'], primaries=source_tags['primaries'],
                            trc=source_tags['trc'], range=source_tags['range'],
                            out_matrix=matrix, out_primaries=primaries, out_trc=transfer,
                            out_range=color_range
                        )
                    )
                else:
                    probe_text = subprocess.run([ffmpeg, '-hide_banner', '-nostdin', '-i', str(source)],
                                                capture_output=True, text=True)
                    text = (probe_text.stderr or '') + (probe_text.stdout or '')
                    source_filter = '' if re.search(r'yuv\w*\([^)]*[/,]', text) else ':ispace=bt709:iprimaries=bt709:itrc=bt709:irange=tv'
                    filters.append(f'colorspace=space={matrix}:primaries={primaries}:trc={transfer}:range={color_range}{source_filter}')
                args += ['-color_primaries', primaries, '-color_trc', transfer, '-colorspace', matrix, '-color_range', color_range]
                if transfer in ('smpte2084', 'arib-std-b67') and video_codec in ('libx265', 'libaom-av1', 'libvpx-vp9'):
                    args += ['-pix_fmt', 'yuv420p10le']
            if ext in ('mp4', 'm4v', 'mov'):
                args += ['-movflags', '+faststart']
            if ext == 'mxf':
                args += ['-ar', '48000']
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
