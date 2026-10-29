# YTX Studio

YTX Studio is a local media workspace for trimming online video, converting and compressing batches, and handing finished media to Adobe editing projects. Electron starts a persistent local Python bridge when the app opens; yt-dlp resolves online previews and downloads selected ranges, while FFmpeg handles exports, conversion, and compression.

## Run from source

Install Node.js and Python 3, then run `npm install` and `npm start`. In development, FFmpeg is provided by `ffmpeg-static`.

## Build the Windows installer

Run `npm install`, then `npm run installer`. The output is `dist/YTX-Setup-1.4.0.exe`. Run `npm run release:assets` afterwards to write `dist/SHA256SUMS.txt` and `dist/release-notes.md`, which is exactly what the release workflow publishes.

Setup installs for every user on the PC and requests administrator approval once. It bundles the official Python 3.12.10 installer, an offline yt-dlp wheel, FFmpeg, and the signed browser extension. Python and its isolated virtual environment live in the app's resources when writable, with a `%LOCALAPPDATA%\YTX` retry if needed. The integrations page lists detected Premiere Pro, After Effects, Chrome, Edge, Brave, Opera, and Vivaldi with separate checkboxes. Selected Adobe hosts receive a host-specific YTX Bridge panel; the Adobe CEP developer-mode checkbox enables the unsigned local panel for this Windows user, and YTX repairs the panel on every launch.

Selected Chromium browsers receive machine-wide `ExtensionInstallForcelist` and `ExtensionSettings` policies under `HKLM`. While YTX is running, its local update service serves the signed CRX over `http://127.0.0.1:62389` with the correct Chromium MIME type, so force-installed extensions download reliably without Developer mode or Load unpacked steps; restart the browser once after setup. If an organization locks policy keys, YTX reports the policy scope and offers a UAC-approved repair. The extension folder also remains available as a manual fallback. Users do not need a separate Python, yt-dlp, or FFmpeg installation.

Copyright © 2026 ARYAN ARYA.

The setup welcome page and application display `© 2026 ARYAN ARYA`. Third-party license notes are included in `THIRD_PARTY_NOTICES.txt`.

Paste a video URL and press the arrow to resolve an online preview without downloading the whole video. Use the timeline handles or mark in/out controls, then choose a stream quality and Download video or Download audio to save the selected range. Local video files can also be opened and exported through FFmpeg with quality settings.

Timeline in/out fields accept `HH:MM:SS:FF` timecode at 30 fps. The playhead can be dragged continuously to scrub.

## Export formats, codecs, and color

Export goes far beyond MP4. Video targets include MP4, MOV, MKV, WebM, AVI, M4V, MXF, M2TS, MTS, MPEG-TS, MPEG-PS, WMV, FLV, 3GPP, and Ogg Theora, with H.264, H.265, AV1, VP9, VP8, Apple ProRes 422/LT/HQ/4444, Avid DNxHD/DNxHR, MPEG-2, MPEG-4 Part 2, Theora, WMV8, H.263, and Sorenson Spark, plus a passthrough copy mode. Audio can go to MP3, M4A, WAV, FLAC, OGG, Opus, ADTS AAC, AC-3, WMA, or AIFF with ALAC lossless and 16/24/32-bit PCM depth. Images export to JPG, PNG, WebP, BMP, TIFF, and TGA. Color can be preserved or converted to Rec. 709, sRGB, Rec. 2020 (SDR, HLG, or HDR10 PQ), Display P3, DCI-P3, SMPTE 170M/BG/240M, or linear light; HDR targets keep 10-bit metadata for HDR10 and HLG deliverables. The program monitor reports the true source size (QHD, 4K, and higher are labeled), preview plays with synced sound, and a mute button (or the M key) silences the monitor while keeping the export pipeline untouched.

## Conversion and compression

Open **Conversion** to build a batch from video, audio, or image files. Drop media onto the workspace or use **Choose files**; each queue item shows a preview thumbnail and its own output format. **Convert** changes containers and codecs, while **Compress** applies Light, Balanced, or Maximum presets for smaller files. The engine tunes worker and encoder-thread counts to the computer's CPU and memory, renders the batch with live per-file progress, and keeps files that finished before a cancellation. Recent activity records completed, failed, and cancelled jobs separately.

## Adobe handoff

The installer places the YTX CEP panel in the per-user Adobe extensions folder. Restart Premiere Pro or After Effects, open **Window → Extensions (Legacy) → YTX Bridge**, then use YTX's Premiere/After Effects actions to render the selected range and insert it into the open timeline or composition. The panel lists media managed in the saved project's `YTX Media` folder, links that media to the project file, and writes `.ytx-media.json` metadata when assets are imported. **Insert** and **Insert again** place a managed asset on the active timeline or composition, while **Send selected media to YTX** returns selected project footage to the editor. YTX reports a host as connected only while its bridge panel is open and responding, and disables Send actions for hosts that are offline.

YTX focuses on single-clip trimming, batch conversion, and Adobe handoff. It does not include multitrack editing, effects, or project saving yet.

## Browser extension

The signed YouTube helper adds **Open in YTX** to watch pages, Shorts, live streams, and `youtu.be` links. It follows YouTube's SPA navigation, so moving between videos updates or removes the button without a reload. Choosing it hands the canonical `watch?v=` URL to YTX Studio for preview and trimming.

## Downloads and updates

The in-app Downloads Center tracks recent downloads, batch conversions, and update installer downloads. The Updates tab reads the public GitHub Releases feed for pixelstoLogic/YTX, sorts stable releases by semantic version, and installs the highest published version—not whichever asset a cached response happened to offer. The installer is re-resolved from GitHub at download time and its SHA-256 digest (or `SHA256SUMS.txt`) is verified before launch. Version history in the same tab lists older builds with explicit Download actions for rollback; those are saved without being launched automatically. Run `npm run check:releases` to print the same selection the app makes, including any release whose asset name does not match its tag.

## Versioned releases

1. Update `package.json`, `build/resources/browser-extension/manifest.json`, and `CHANGELOG.md` to the same version.
2. Commit and push `main`, then push a matching tag: `git tag v1.4.0 && git push origin v1.4.0`.
3. The `Build and publish YTX release` workflow checks out the tag, validates all three version fields, builds the installer, signs the extension as CRX3, writes `updates.xml` and `SHA256SUMS.txt`, and publishes them on the GitHub release.
4. A release is marked GitHub “latest” only when no higher stable version exists. The app always selects the highest stable release by semantic version and never installs a lower build unless the user explicitly chooses it from version history.
5. The extension signing key is **not** committed to this public repository; `build/keys/` is gitignored. Add the contents of `build/keys/ytx-extension-key.pem` as the `YTX_EXTENSION_KEY` repository secret so CI signs with extension ID `ibbnkdcefianlglmenklhmcoeiolpjjb`. Releases fail with an explicit message when that key is missing. CI may override the update URL with `YTX_EXTENSION_UPDATE_URL` / `YTX_EXTENSION_CRX_URL`.

## Adobe bridge

YTX Bridge 2.0 auto-repairs its CEP panel at startup, writes live port/token settings to the panel and per-user YTX folders, supports CEP 9–14, and exposes health and diagnostics endpoints on `127.0.0.1`. The panel reconnects automatically, times out stalled ExtendScript calls, reports import failures, and copies imported media into the project's managed `YTX Media` folder. Project media is scoped to the saved project, linked to its project file, and recorded in `.ytx-media.json` with import and insert timestamps so the panel can offer **Insert** or **Insert again** after a restart. Use **Repair Adobe bridge** in the app after installing or updating Adobe; restart the Adobe host, then open **Window → Extensions (Legacy) → YTX Bridge**.
