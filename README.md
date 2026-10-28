# YTX Studio

A small Electron desktop app for resolving and previewing an online video before downloading only a trimmed range. Electron starts a persistent local Python bridge when the app opens; yt-dlp resolves the online preview and downloads selected sections, while FFmpeg handles exports from local files.

## Run from source

Install Node.js and Python 3, then run `npm install` and `npm start`. In development, FFmpeg is provided by `ffmpeg-static`.

## Build the Windows installer

Run `npm install`, then `npm run installer`. The output is `dist/YTX-Setup-1.2.0.exe`. Run `npm run release:assets` afterwards to write `dist/SHA256SUMS.txt` and `dist/release-notes.md`, which is exactly what the release workflow publishes. It bundles the official Python 3.12.10 installer, an offline yt-dlp wheel, FFmpeg, and the signed browser extension. Setup installs Python and its isolated virtual environment in the app's resources when writable, and retries in `%LOCALAPPDATA%\YTX` if needed. The integrations page lists detected Premiere Pro, After Effects, Chrome, Edge, Brave, Opera, and Vivaldi with separate checkboxes. Selected Adobe hosts receive a host-specific YTX Bridge panel. The Adobe CEP developer-mode checkbox enables the unsigned local panel for this Windows user, and YTX repairs the panel on every launch. Selected Chromium browsers receive a per-user `ExtensionInstallForcelist` policy that points at the signed extension in the latest GitHub release, so no Developer mode or Load unpacked step is required; restart the browser once after setup. Managed browser policies can block this, in which case the extension folder remains available as a manual fallback. Users do not need a separate Python, yt-dlp, or FFmpeg installation.

Copyright © 2026 ARYAN ARYA.

The setup welcome page and application display `© 2026 ARYAN ARYA`. Third-party license notes are included in `THIRD_PARTY_NOTICES.txt`.

Paste a video URL and press the arrow to resolve an online preview without downloading the whole video. Use the timeline handles or mark in/out controls, then choose a stream quality and Download video or Download audio to save the selected range. Local video files can also be opened and exported through FFmpeg with quality settings.

Timeline in/out fields accept `HH:MM:SS:FF` timecode at 30 fps. The playhead can be dragged continuously to scrub. The installer places the YTX CEP panel in the per-user Adobe extensions folder. Restart Premiere Pro or After Effects, open **Window → Extensions (Legacy) → YTX Bridge**, then use YTX's Premiere/After Effects actions to render the selected range and insert it into the open timeline or composition. In the Adobe panel, **Send selected media to YTX** returns selected project footage to the editor. YTX reports a host as connected while its bridge panel is open and responding.

This is a compact first version. It does not include multitrack editing, effects, or project saving yet.

## Downloads and updates

The in-app Downloads Center tracks recent downloads, batch conversions, and update installer downloads. The Updates tab reads the public GitHub Releases feed for pixelstoLogic/YTX, sorts stable releases by semantic version, and installs the highest published version—not whichever asset a cached response happened to offer. The installer is re-resolved from GitHub at download time and its SHA-256 digest (or `SHA256SUMS.txt`) is verified before launch. Version history in the same tab lists older builds with explicit Download actions for rollback; those are saved without being launched automatically. Run `npm run check:releases` to print the same selection the app makes, including any release whose asset name does not match its tag.

## Versioned releases

1. Update `package.json`, `build/resources/browser-extension/manifest.json`, and `CHANGELOG.md` to the same version.
2. Commit and push `main`, then push a matching tag: `git tag v1.2.0 && git push origin v1.2.0`.
3. The `Build and publish YTX release` workflow checks out the tag, validates all three version fields, builds the installer, signs the extension as CRX3, writes `updates.xml` and `SHA256SUMS.txt`, and publishes them on the GitHub release.
4. A release is marked GitHub “latest” only when no higher stable version exists. The app always selects the highest stable release by semantic version and never installs a lower build unless the user explicitly chooses it from version history.
5. The extension signing key is **not** committed to this public repository; `build/keys/` is gitignored. Add the contents of `build/keys/ytx-extension-key.pem` as the `YTX_EXTENSION_KEY` repository secret so CI signs with extension ID `ibbnkdcefianlglmenklhmcoeiolpjjb`. Releases fail with an explicit message when that key is missing. CI may override the update URL with `YTX_EXTENSION_UPDATE_URL` / `YTX_EXTENSION_CRX_URL`.

## Adobe bridge

YTX Bridge 2.0 auto-repairs its CEP panel at startup, writes live port/token settings to the panel and per-user YTX folders, supports CEP 9–14, and exposes health and diagnostics endpoints on `127.0.0.1`. The panel reconnects automatically, times out stalled ExtendScript calls, reports import failures, and copies imported media into the project's managed `YTX Media` folder. Use **Repair Adobe bridge** in the app after installing or updating Adobe; restart the Adobe host, then open **Window → Extensions (Legacy) → YTX Bridge**.
