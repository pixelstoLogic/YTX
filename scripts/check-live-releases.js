/*
 * Offline check of the updater's release selection against the live GitHub API.
 * Mirrors fetchPublicReleases + findInstallerAsset from main.js without
 * launching Electron.
 */
const GITHUB_API = 'https://api.github.com/repos/pixelstoLogic/YTX';

function versionParts(value) { return String(value || '').replace(/^v/i, '').split(/[.+-]/).map(part => Number(part) || 0); }
function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) > (right[i] || 0) ? 1 : -1;
  }
  return 0;
}
function normalizeRelease(release) {
  return {
    version: String(release.tag_name || '').replace(/^v/i, ''),
    tag: release.tag_name || '',
    draft: Boolean(release.draft),
    prerelease: Boolean(release.prerelease),
    assets: (release.assets || []).map(item => ({ name: item.name, url: item.browser_download_url, digest: item.digest || '' }))
  };
}
function findInstallerAsset(release, version = release.version) {
  const exactName = `YTX-Setup-${version}.exe`.toLowerCase();
  return release.assets.find(item => item.name.toLowerCase() === exactName) || null;
}

(async () => {
  const response = await fetch(`${GITHUB_API}/releases?per_page=50`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'YTX-Studio-Updater' }
  });
  console.log('HTTP', response.status, '| rate limit remaining:', response.headers.get('x-ratelimit-remaining'));
  if (!response.ok) process.exit(1);
  const payload = await response.json();
  const releases = payload
    .map(normalizeRelease)
    .filter(release => !release.draft && !release.prerelease && /^\d+(\.\d+){1,3}$/.test(release.version))
    .sort((a, b) => compareVersions(b.version, a.version));

  console.log('\nStable releases, highest first:');
  for (const release of releases) {
    const asset = findInstallerAsset(release);
    console.log(`  ${release.version.padEnd(8)} tag=${release.tag.padEnd(8)} asset=${asset ? asset.name : 'MISSING/MISMATCHED'}`);
  }

  const latest = releases[0];
  const asset = latest && findInstallerAsset(latest);
  console.log('\nSelection result:');
  console.log('  latestVersion =', latest ? latest.version : '(none)');
  console.log('  installer     =', asset ? asset.name : '(none)');
  console.log('  digest        =', asset && asset.digest ? asset.digest : '(not published)');
  console.log('  decision      =', asset ? 'would offer this build' : 'would refuse to offer an installer');

  const mismatched = releases.filter(release => !findInstallerAsset(release));
  console.log('\nReleases rejected by exact asset matching:', mismatched.map(item => item.version).join(', ') || 'none');

  console.log('\nExtension assets on GitHub latest:');
  for (const name of ['updates.xml', 'ytx-extension.crx', 'SHA256SUMS.txt']) {
    const head = await fetch(`https://github.com/pixelstoLogic/YTX/releases/latest/download/${name}`, { method: 'HEAD', redirect: 'follow' });
    console.log(`  ${name.padEnd(18)} HTTP ${head.status}${head.status === 404 ? ' (not published yet)' : ''}`);
  }
})();
