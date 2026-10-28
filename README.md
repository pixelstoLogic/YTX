# YTX Studio

A small Electron desktop app for resolving and previewing an online video before downloading only a trimmed range. Electron starts a persistent local Python bridge when the app opens; yt-dlp resolves the online preview and downloads selected sections, while FFmpeg handles exports from local files.

## Run from source

Install Node.js and Python 3, then run `npm install` and `npm start`. In development, FFmpeg is provided by `ffmpeg-static`.

## Build the Windows installer

Run `npm install`, then `npm run installer`. The output is `dist/YTX-Setup-1.1.8.exe`. It bundles the official Python 3.12.10 installer, an offline yt-dlp wheel, and FFmpeg. Setup installs Python and its isolated virtual environment in the app's resources when writable, and retries in `%LOCALAPPDATA%\YTX` if needed. Setup detects Premiere Pro and After Effects separately and asks which hosts should receive the YTX CEP bridge panel. It also asks whether to set up the extension in each detected Chrome, Edge, Brave, Opera, or Vivaldi installation. Chromium requires a one-time user confirmation: enable Developer mode and choose Load unpacked for the bundled YTX extension folder. Users do not need a separate Python, yt-dlp, or FFmpeg installation.

Copyright © 2026 ARYAN ARYA.

The setup welcome page and application display `© 2026 ARYAN ARYA`. Third-party license notes are included in `THIRD_PARTY_NOTICES.txt`.

Paste a video URL and press the arrow to resolve an online preview without downloading the whole video. Use the timeline handles or mark in/out controls, then choose a stream quality and Download video or Download audio to save the selected range. Local video files can also be opened and exported through FFmpeg with quality settings.

Timeline in/out fields accept `HH:MM:SS:FF` timecode at 30 fps. The playhead can be dragged continuously to scrub. The installer places the YTX CEP panel in the per-user Adobe extensions folder. Restart Premiere Pro or After Effects, open **Window → Extensions (Legacy) → YTX Bridge**, then use YTX's Premiere/After Effects actions to render the selected range and insert it into the open timeline or composition. In the Adobe panel, **Send selected media to YTX** returns selected project footage to the editor. YTX reports a host as connected while its bridge panel is open and responding.

This is a compact first version. It does not include multitrack editing, effects, or project saving yet.

## Downloads and updates

The in-app Downloads Center tracks recent downloads, batch conversions, and update installer downloads. The Updates tab checks the public GitHub Releases feed for pixelstoLogic/YTX and can download the latest YTX-Setup installer into your Downloads folder. The app shows release notes, verifies GitHub's published SHA-256 digest when present, and starts the installer after verification.

