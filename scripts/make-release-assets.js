/*
 * Produces the extra files that belong on a GitHub release page:
 *
 *   dist/SHA256SUMS.txt    checksums the in-app updater verifies before launch
 *   dist/release-notes.md  the CHANGELOG section for this version
 *
 * Run it after `npm run installer` when publishing by hand. The release
 * workflow runs the same script, so local and CI releases stay identical.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const version = require(path.join(root, 'package.json')).version;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const installer = path.join(dist, `YTX-Setup-${version}.exe`);
for (const file of [installer, path.join(dist, 'ytx-extension.crx'), path.join(dist, 'updates.xml')]) {
  if (!fs.existsSync(file)) fail(`Missing release asset: ${path.relative(root, file)}. Run "npm run installer" first.`);
}

const assets = [installer, path.join(dist, 'ytx-extension.crx'), path.join(dist, 'updates.xml')];
const sums = assets.map(file => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return `${digest}  ${path.basename(file)}`;
});
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), sums.join('\n') + '\n', 'ascii');

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
const heading = changelog.findIndex(line => new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}(\\s|$)`).test(line));
if (heading === -1) fail(`CHANGELOG.md has no "## ${version}" section.`);
const next = changelog.findIndex((line, index) => index > heading && /^##\s+/.test(line));
const notes = changelog.slice(heading + 1, next === -1 ? changelog.length : next).join('\n').trim();
if (!notes) fail(`The CHANGELOG section for ${version} is empty.`);
fs.writeFileSync(path.join(dist, 'release-notes.md'), `${notes}\n`, 'utf8');

console.log(`Release assets ready for YTX ${version}:`);
for (const line of sums) console.log(`  ${line}`);
console.log('  release-notes.md');
