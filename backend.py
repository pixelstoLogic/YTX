import json
import os
import shutil
import subprocess
import sys
import threading
import uuid
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

JOBS = {}
JOBS_LOCK = threading.Lock()
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

def reply(value, code=0):
    print(json.dumps(value))
    raise SystemExit(code)

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
                if os.path.exists(candidate): filename = candidate
            reply({'path': filename, 'title': info.get('title', Path(filename).stem)})
    except Exception as exc:
        reply({'error': str(exc)}, 1)

def export(source, target, start, end, kind):
    ffmpeg = os.environ.get('CLIPFORGE_FFMPEG') or shutil.which('ffmpeg')
    if not ffmpeg:
        reply({'error': 'FFmpeg was not found. Install FFmpeg and add it to PATH.'}, 1)
    try:
        start, end = float(start), float(end)
        if start < 0 or end <= start: raise ValueError('The end time must be after the start time.')
        args = [ffmpeg, '-y', '-ss', str(start), '-i', source, '-t', str(end - start)]
        if kind == 'audio':
            ext = Path(target).suffix.lower()
            args += ['-vn']
            if ext == '.wav': args += ['-c:a', 'pcm_s16le']
            elif ext == '.m4a': args += ['-c:a', 'aac', '-b:a', '192k']
            else: args += ['-c:a', 'libmp3lame', '-b:a', '192k']
        else:
            args += ['-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart']
        args.append(target)
        result = subprocess.run(args, capture_output=True, text=True)
        if result.returncode: reply({'error': result.stderr[-1800:] or 'FFmpeg export failed.'}, 1)
        reply({'path': target})
    except Exception as exc:
        reply({'error': str(exc)}, 1)

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
            if not progress: return
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
        if not candidates: return {'error': 'yt-dlp completed but the trimmed source file was not found.'}
        source_path = candidates[0]
        result = transcode(str(source_path), str(target), transcode_options or {'kind': kind}, None, None)
        if result.get('error'): return result
        try: source_path.unlink()
        except OSError: pass
        return {'path': str(target)}
    except ImportError:
        return {'error': 'yt-dlp is missing. Run: python -m pip install -r requirements.txt'}
    except Exception as exc:
        return {'error': str(exc)}

def start_download_job(body):
    job_id = uuid.uuid4().hex
    with JOBS_LOCK: JOBS[job_id] = {'id': job_id, 'status': 'starting', 'percent': 0, 'downloaded': 0, 'total': 0}
    def progress(update):
        with JOBS_LOCK: JOBS[job_id].update(update)
    def run():
        with JOBS_LOCK: JOBS[job_id]['status'] = 'downloading'
        result = download_section(body['url'], body['target'], body['start'], body['end'], body.get('kind', 'video'), body.get('videoFormat'), body.get('audioFormat'), progress, body)
        with JOBS_LOCK:
            JOBS[job_id].update({'status': 'error' if result.get('error') else 'complete', 'percent': 100 if not result.get('error') else JOBS[job_id].get('percent', 0), 'result': result, 'done': True})
    threading.Thread(target=run, daemon=True).start()
    return {'id': job_id}

def transcode(source, target, options=None, start=None, end=None):
    ffmpeg = os.environ.get('CLIPFORGE_FFMPEG') or shutil.which('ffmpeg')
    if not ffmpeg: return {'error': 'FFmpeg was not found. Install FFmpeg and add it to PATH.'}
    options = options or {}
    try:
        ext = Path(target).suffix.lower().lstrip('.')
        if ext not in VIDEO_FORMATS | AUDIO_FORMATS:
            return {'error': f'Unsupported output container: .{ext}'}
        audio_only = ext in AUDIO_FORMATS or options.get('kind') == 'audio'
        video_codec = VIDEO_CODECS.get(str(options.get('videoCodec') or 'h264').lower())
        audio_codec = AUDIO_CODECS.get(str(options.get('audioCodec') or 'aac').lower())
        profile = COLOR_PROFILES.get(str(options.get('colorProfile') or 'preserve').lower(), 'invalid')
        if not video_codec or not audio_codec: return {'error': 'Choose a codec supported by the bundled FFmpeg.'}
        if profile == 'invalid': return {'error': 'Choose a supported color profile.'}
        if video_codec == 'copy' and profile: return {'error': 'A color profile cannot be converted while copying the original video stream.'}
        if start is not None or end is not None:
            start, end = float(start or 0), float(end or 0)
            if start < 0 or end <= start: return {'error': 'The end time must be after the start time.'}
        args = [ffmpeg, '-y', '-hide_banner', '-nostdin']
        if start is not None: args += ['-ss', str(start)]
        args += ['-i', str(source)]
        if end is not None: args += ['-t', str(end - start)]
        if audio_only:
            args += ['-vn', '-c:a', audio_codec]
            if audio_codec in ('aac', 'libmp3lame', 'libopus', 'libvorbis'):
                bitrate = int(options.get('audioQuality') or 192)
                if bitrate not in (64, 96, 128, 160, 192, 256, 320): bitrate = 192
                args += ['-b:a', f'{bitrate}k']
        else:
            args += ['-c:v', video_codec]
            if video_codec in ('libx264', 'libx265', 'libaom-av1', 'libvpx-vp9', 'mpeg4'):
                crf = int(options.get('videoQuality') or 20)
                if crf not in (18, 20, 23, 28): crf = 20
                args += ['-crf', str(crf)]
                if video_codec in ('libaom-av1', 'libvpx-vp9'): args += ['-b:v', '0']
            if video_codec in ('libx264', 'libx265'): args += ['-preset', 'fast']
            args += ['-c:a', audio_codec]
            if audio_codec in ('aac', 'libmp3lame'): args += ['-b:a', '192k']
            if profile:
                primaries, transfer, matrix, color_range = profile
                probe = subprocess.run([ffmpeg, '-hide_banner', '-i', str(source)], capture_output=True, text=True)
                probe_text = (probe.stderr or '') + (probe.stdout or '')
                known_color_tags = ('bt709', 'bt2020', 'smpte170m', 'smpte240m', 'bt470bg', 'bt470m', 'smpte432', 'smpte431')
                input_override = '' if any(tag in probe_text.lower() for tag in known_color_tags) else ':iall=bt709'
                args += ['-vf', f'colorspace=all={matrix}{input_override}', '-color_primaries', primaries, '-color_trc', transfer, '-colorspace', matrix, '-color_range', color_range]
            if ext in ('mp4', 'm4v', 'mov'): args += ['-movflags', '+faststart']
        args += ['-threads', '2']
        args.append(target)
        result = subprocess.run(args, capture_output=True, text=True,
                                creationflags=getattr(subprocess, 'BELOW_NORMAL_PRIORITY_CLASS', 0) if os.name == 'nt' else 0)
        if result.returncode: return {'error': result.stderr[-1800:] or 'FFmpeg export failed.'}
        return {'path': target}
    except Exception as exc:
        return {'error': str(exc)}

def export_result(source, target, start, end, kind, video_quality=None, audio_quality=None, video_codec='h264', audio_codec='aac', color_profile='preserve'):
    return transcode(source, target, {'kind': kind, 'videoQuality': video_quality, 'audioQuality': audio_quality, 'videoCodec': video_codec, 'audioCodec': audio_codec, 'colorProfile': color_profile}, start, end)

def start_convert_job(body):
    files = body.get('files') or []
    if not files: return {'error': 'Select at least one media file.'}
    ext = str(body.get('format') or '').lower().lstrip('.')
    if ext not in VIDEO_FORMATS | AUDIO_FORMATS: return {'error': 'Choose a supported output format.'}
    job_id = uuid.uuid4().hex
    with JOBS_LOCK: JOBS[job_id] = {'id': job_id, 'status': 'converting', 'percent': 0, 'done': False, 'files': []}
    def run():
        results = []
        for index, source in enumerate(files):
            source_path = Path(source)
            output_dir = Path(body.get('outputDir') or source_path.parent)
            output = output_dir / f'{source_path.stem}-converted.{ext}'
            with JOBS_LOCK: JOBS[job_id].update({'status': 'converting', 'message': f'Converting {source_path.name}', 'currentFile': index + 1, 'totalFiles': len(files), 'percent': round(index / len(files) * 100)})
            result = transcode(str(source_path), str(output), body)
            results.append({'source': str(source_path), **result})
            with JOBS_LOCK: JOBS[job_id]['files'] = results
            if result.get('error'):
                with JOBS_LOCK: JOBS[job_id].update({'status': 'failed', 'done': True, 'error': result['error'], 'percent': round((index + 1) / len(files) * 100)})
                return
        with JOBS_LOCK: JOBS[job_id].update({'status': 'complete', 'done': True, 'percent': 100, 'message': f'Converted {len(results)} file(s).', 'files': results})
    threading.Thread(target=run, daemon=True).start()
    return {'id': job_id}

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
            self._respond({'ok': True, 'ytDlp': yt_dlp_available, 'ytDlpVersion': yt_dlp_version, 'ffmpeg': bool(ffmpeg and Path(ffmpeg).exists()), 'formats': sorted(VIDEO_FORMATS | AUDIO_FORMATS), 'videoCodecs': list(VIDEO_CODECS), 'audioCodecs': list(AUDIO_CODECS), 'colorProfiles': list(COLOR_PROFILES)})
        elif self.path.startswith('/jobs/'):
            with JOBS_LOCK: result = JOBS.get(self.path.rsplit('/', 1)[-1])
            self._respond(result or {'error': 'Unknown job.'}, 404 if result is None else 200)
        else: self._respond({'error': 'Not found.'}, 404)

    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size > 2_000_000: return self._respond({'error': 'Request is too large.'}, 413)
            body = json.loads(self.rfile.read(size).decode('utf-8'))
            route = self.path
            if route == '/resolve': result = resolve_preview(body.get('url', ''))
            elif route == '/download-section': result = download_section(body['url'], body['target'], body['start'], body['end'], body.get('kind', 'video'))
            elif route == '/download/start': result = start_download_job(body)
            elif route == '/convert/start': result = start_convert_job(body)
            elif route == '/export': result = export_result(body['source'], body['target'], body['start'], body['end'], body.get('kind', 'video'), body.get('videoQuality'), body.get('audioQuality'), body.get('videoCodec', 'h264'), body.get('audioCodec', 'aac'), body.get('colorProfile', 'preserve'))
            else: return self._respond({'error': 'Not found.'}, 404)
            self._respond(result, 400 if result.get('error') else 200)
        except Exception as exc:
            self._respond({'error': str(exc)}, 400)

def serve():
    server = ThreadingHTTPServer(('127.0.0.1', 0), ApiHandler)
    server.daemon_threads = True
    print(json.dumps({'ready': True, 'port': server.server_address[1]}), flush=True)
    server.serve_forever()

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--server': serve()
    elif len(sys.argv) > 1 and sys.argv[1] == 'download' and len(sys.argv) >= 3: download(sys.argv[2])
    elif len(sys.argv) > 1 and sys.argv[1] == 'export' and len(sys.argv) >= 7: export(*sys.argv[2:7])
    else: reply({'error': 'Invalid backend command.'}, 2)
