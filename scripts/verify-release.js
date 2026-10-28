#!/usr/bin/env node
/* Keeps package.json, the extension manifest, CHANGELOG, and the git tag aligned. */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build', 'resources', 'browser-extension', 'manifest.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const tag = String(process.argv[2] || process.env.GITHUB_REF_NAME || '').replace(/^v/i, '');
const errors = [];

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version)) errors.push(`package.json version is not semver: ${pkg.version}`);
if (manifest.version !== pkg.version) errors.push(`extension manifest is ${manifest.version}, expected ${pkg.version}`);
if (!changelog.includes(`## ${pkg.version}`)) errors.push(`CHANGELOG.md has no "## ${pkg.version}" section`);
if (tag && tag !== pkg.version) errors.push(`git tag/release version is ${tag}, expected ${pkg.version}`);
const idPath = path.join(root, 'build', 'resources', 'browser-extension', 'extension-id.txt');
if (!fs.existsSync(idPath)) errors.push('The signed browser extension has not been packaged yet.');
else if (!/^[a-p]{32}$/.test(fs.readFileSync(idPath, 'utf8').trim())) errors.push('extension-id.txt does not contain a valid Chromium extension ID.');

if (errors.length) {
  console.error(errors.map(error => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Release metadata verified for YTX ${pkg.version}${tag ? ` (${tag})` : ''}.`);
}
