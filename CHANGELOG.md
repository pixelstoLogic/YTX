# YTX Studio changelog

## 1.4.0 — 2026-10-29

- Expanded export and conversion to the full Adobe and broadcast codec set: Apple ProRes 422/LT/HQ/4444, Avid DNxHD/DNxHR (with proper MXF and QuickTime packaging), MPEG-2, MPEG-4 Part 2, Theora, Windows Media Video 8, H.263, and Sorenson Spark (FLV1), alongside H.264, H.265, AV1, VP9, and VP8.
- Added 15 output containers — MP4, MOV, MKV, WebM, AVI, M4V, MXF, M2TS (Blu-ray/AVCHD), MTS, MPEG-TS, MPEG Program Stream, WMV, FLV, 3GPP, and Ogg Theora — with per-container codec compatibility so impossible combinations cannot be selected.
- Added a wider color pipeline: Rec. 709, sRGB, Rec. 2020 SDR, Rec. 2020 HLG, Rec. 2020 PQ (HDR10), Display P3, DCI-P3, SMPTE 170M, BT.470 BG, SMPTE 240M, and linear light. HDR targets use bit-depth-preserving zscale so HLG and HDR10 exports keep correct 10-bit tagging.
- Added audio codecs ALAC, PCM 24/32-bit, AC-3, E-AC-3, MP2, and WMA v2, plus AIFF, ADTS AAC, and AC-3 containers and bitrates up to 640 kbps.
- Added image conversions also to BMP, TIFF with LZW, and TGA, and preview frame exports can now use every raster target.
- Rewrote the `colorspace` handling to read each source's incoming tags, so untagged SDR files no longer fail and color stays faithful through conversions.
- Fixed MPEG-2/DNx legacy formats: MXF audio is forced to 48 kHz, AIFF exports switch to big-endian PCM, and H.263 output is rescaled to a valid CIF picture size.
- Downloads now recover when YouTube offers no muxable "best" pair: video and highest-quality audio are fetched separately and merged transparently for trimmed and full segments, so export and Adobe handoff keep working.
- Fixed 4K sources showing as 1080p: the program monitor now reads the real source size and labels QHD/4K/SD8K correctly, and the sequence metadata follows the source resolution.
- Added preview sound with frame-accurate audio/video sync, drift correction, playback-rate following, and a mute/unmute button (or press M) whose state is remembered between sessions.
- Rebuilt the "Analyze this system" report as a real dialog with hardware, render-worker, and encoding-mode stats, detected Adobe apps and browsers, scan time, and a Repeat scan button; it now closes with the X button, Esc, or the backdrop and restores keyboard focus.
- Responsive refresh across editor and conversion: the shell now adapts from ultra-wide down to 720 px windows — export and source panels reflow to two columns beneath the monitor, panels stack with the preview first on narrow windows, the top bar collapses to icons, queue rows reflow, and the converter moves to a stacked layout with side-by-side settings. Window minimums dropped to 720×560 and large displays gain extra breathing room.
- Browser-extension installation now self-hosts: YTX serves the signed CRX from a local update service with the correct Chromium MIME type, and Chromium `ExtensionSettings` policies force-install from that service, so GitHub's attachment downloads no longer block installation.
- Setup no longer cancels when YTX Studio is still open: the installer closes a running app automatically before installing (and the uninstaller does the same), so the "already running" stop can no longer abort an update.
- The Adobe bridge panel auto-connects while YTX is running, converts CEP file paths to native ones, retries automatically, and refreshes its token without a manual reconnect.

## 1.3.0 — 2026-10-28

- Rebuilt the conversion workspace with drag-and-drop intake, a preview queue with thumbnails, per-file output format selection, and a hardware-aware performance readout.
- Added compression for video, audio, and images with Light, Balanced, and Maximum presets, plus batch progress, cancellation, and preservation of files that already finished.
- Added automatic performance tuning so worker and encoder-thread counts follow the computer's CPU and available memory.
- Refreshed the editing and conversion interface with production-focused copy, motion, loaders, and clearer empty, running, completed, and cancelled states.
- Moved browser-extension setup to a per-machine installer that writes Chrome, Edge, Brave, Opera, and Vivaldi policies in HKLM with read-back verification. The app keeps a UAC-approved repair path when policy keys are locked down.
- Expanded the Adobe bridge with project-scoped media, project-file linking, managed `YTX Media` folders, JSON asset metadata, Insert and Insert again actions, and connection-aware Send to Premiere and Send to After Effects controls.
- Added YouTube Shorts, youtu.be, and live URL support, with SPA navigation detection so the handoff button follows the current video.
- Improved cancellation reporting so stopped conversions are labelled accurately in the queue and transfer history.
- Hardened metadata and bridge handling against UTF-8 BOM files, stale project paths, and interrupted imports.

## 1.2.0 — 2026-10-28

- Added a tagged release pipeline that builds the installer, signs the browser extension into CRX3, publishes `updates.xml` and `SHA256SUMS.txt`, and only marks the highest version as GitHub's latest release.
- Kept the CRX signing key out of the public repository: releases require the `YTX_EXTENSION_KEY` Actions secret and fail with an explicit message when it is missing, so the extension ID can never silently change.
- Reworked the updater to read the published release list, install the highest stable version instead of trusting a renderer-supplied URL, verify SHA-256, and keep older installers downloadable for rollback.
- Added version history to Downloads & Updates with installed/latest badges and explicit download actions.
- Added automatic browser-extension installation through per-user Chromium extension policy, so Chrome, Edge, Brave, Vivaldi, and Opera no longer require Developer mode or Load unpacked.
- Fixed browser detection handing the policy writer an empty key, which could report a successful install without writing any policy; YTX now verifies every policy write and explains when Windows blocks it.
- Added an uninstall path that removes YTX browser policies and the local extension folder.
- Strengthened the Adobe bridge with startup self-repair, CEP 9–14 developer-mode support, host-specific manifests, a reconnecting panel, command timeouts, managed project media, and new Premiere/After Effects import checks.
- Added one-click browser-extension and Adobe bridge repair controls to the app.

## 1.1.9 — 2026-10-28

- Replaced repeated setup questions with one detected-app selection page showing colored app badges, names, and checkboxes.
- Made Adobe setup honor separate Premiere Pro and After Effects selections with host-specific CEP manifests.
- Fixed the CEP bridge settings path and Premiere playhead tick handling.
- Corrected Adobe CEP developer-mode registry values to the string type and added a visible opt-in checkbox.
- Added browser extension icons and support for bare and mobile YouTube URLs.
- Made setup open extension pages for every selected browser.

## 1.1.8 — 2026-10-28

- Fixed YTX Bridge startup in Premiere Pro and After Effects by using CEP's documented `userData` system path.
- Added separate setup choices for each detected Premiere Pro, After Effects, Chrome, Edge, Brave, Opera, and Vivaldi installation.
- Made Adobe panel installation conditional on the selected host apps.
- Clarified the one-time browser confirmation needed to load the local extension.
- Setup leaves Adobe CEP security settings unchanged; the installer explains when Adobe's developer mode may be needed.

## 1.1.7 — 2026-10-28

- Added a dedicated conversion workspace with conversion-only progress and results.
- Added live percentage and transfer details for update downloads; verified installers now launch automatically.
- Added post-install update confirmation and release notes in the Updates and Changelog views.
- Fixed tray icon loading with an ICO fallback.
- Added installer prompts for detected Adobe hosts and Chromium browsers, including Adobe CEP setup and browser extension instructions.
- Improved Adobe handoff errors so YTX explains when the bridge panel must be opened.

## 1.1.6.5 — 2026-10-28

- Test release: validates in-app update detection, changelog display, and installer handoff.

## 1.1.6 — 2026-10-28

- Added H.264, H.265, AV1, VP9, ProRes, and MPEG-4 export choices with container compatibility checks.
- Added color-profile conversion presets and support for untagged SDR sources.
- Added audio format, codec, and bitrate options plus batch conversion.
- Added a lightweight system scan, optional tray/startup behavior, and Ctrl+Alt+Y shortcut.
- Added the Chrome/Edge YouTube handoff helper and Adobe project media bridge.
- Improved the Python virtual-environment installer fallback and setup detail output.
- Refined the editor panel scrolling and export settings layout.
- Added Downloads Center and GitHub release update support.

Copyright © 2026 ARYAN ARYA.

