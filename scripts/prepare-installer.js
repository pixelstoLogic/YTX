const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bootstrap = path.join(root, 'build', 'resources', 'bootstrap');
const wheels = path.join(bootstrap, 'python-wheels');
const pythonInstaller = path.join(bootstrap, 'python-installer', 'python-3.12.10-amd64.exe');
const ffmpeg = path.join(root, 'build', 'resources', 'ffmpeg', 'ffmpeg.exe');
const icon = path.join(root, 'build', 'ytx.ico');
const bridge = path.join(root, 'build', 'resources', 'adobe-bridge');

async function downloadFile(url, destination) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = destination + '.download';
  fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(temporary, destination);
}

async function ensureBuildResources() {
  fs.mkdirSync(wheels, { recursive: true });
  if (!fs.existsSync(pythonInstaller)) {
    console.log('Fetching the pinned official Python 3.12.10 Windows installer…');
    await downloadFile('https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe', pythonInstaller);
  }
  if (!fs.readdirSync(wheels).some(file => file.toLowerCase().startsWith('yt_dlp-') && file.endsWith('.whl'))) {
    console.log('Fetching the current yt-dlp wheel from PyPI…');
    const response = await fetch('https://pypi.org/pypi/yt-dlp/json');
    if (!response.ok) throw new Error(`Could not read yt-dlp metadata from PyPI (${response.status}).`);
    const metadata = await response.json();
    const wheel = (metadata.urls || []).find(file => file.filename.endsWith('-py3-none-any.whl'));
    if (!wheel) throw new Error('PyPI did not provide a platform-independent yt-dlp wheel.');
    await downloadFile(wheel.url, path.join(wheels, wheel.filename));
  }
  for (const required of [path.join(root, 'assets', 'ytx-mark.png'), path.join(bridge, 'CSXS', 'manifest.xml'), path.join(bridge, 'panel.js'), path.join(bridge, 'jsx', 'host.jsx'), path.join(root, 'build', 'resources', 'browser-extension', 'manifest.json'), path.join(root, 'build', 'resources', 'browser-extension', 'content.js'), path.join(root, 'build', 'resources', 'browser-extension', 'README.txt')]) {
    if (!fs.existsSync(required)) throw new Error(`Required source resource is missing: ${required}`);
  }
  fs.mkdirSync(path.dirname(ffmpeg), { recursive: true });
  fs.copyFileSync(require('ffmpeg-static'), ffmpeg);
}

async function main() {
await ensureBuildResources();
const ffmpegBin = require('ffmpeg-static');
const pngPath = path.join(root, 'build', 'ytx-256.png');
const image = require('node:child_process').spawnSync(ffmpegBin, ['-y', '-i', path.join(root, 'assets', 'ytx-mark.png'), '-vf', 'scale=256:256:force_original_aspect_ratio=decrease,pad=256:256:(ow-iw)/2:(oh-ih)/2:color=0x00000000', '-frames:v', '1', pngPath], { windowsHide: true, stdio: 'ignore' });
if (image.status !== 0 || !fs.existsSync(pngPath)) throw new Error('Could not generate YTX application icon from assets/ytx-mark.png.');
const png = fs.readFileSync(pngPath);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header.writeUInt8(0, 6); header.writeUInt8(0, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
fs.writeFileSync(icon, Buffer.concat([header, png]));
fs.rmSync(pngPath, { force: true });

// NSIS electron-builder suppresses extraction details in assisted installs. Enable
// file-level detail output so users can see each payload file as the progress bar advances.
const nsisTemplate = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates', 'nsis', 'installSection.nsh');
let nsisSource = fs.readFileSync(nsisTemplate, 'utf8');
if (nsisSource.includes('SetDetailsPrint none')) {
  nsisSource = nsisSource.replace('SetDetailsPrint none', 'SetDetailsPrint both');
  fs.writeFileSync(nsisTemplate, nsisSource);
} else if (!nsisSource.includes('SetDetailsPrint both')) {
  throw new Error('Could not enable file-level NSIS extraction details in the electron-builder template.');
}
console.log('Installer resources ready: bundled Python, yt-dlp, FFmpeg, Adobe CEP bridge, and Chromium browser extension.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

