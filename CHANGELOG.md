# YTX Studio changelog

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

