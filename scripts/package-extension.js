/*
 * Builds the self-hosted Chromium extension package used by YTX.
 *
 * The generated CRX3 is signed with a stable RSA key, which keeps the extension
 * ID the same across releases so browser policy-based installation/updates keep
 * working without asking users to enable Developer mode.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const extensionDir = path.join(root, 'build', 'resources', 'browser-extension');
const keyPath = path.join(root, 'build', 'keys', 'ytx-extension-key.pem');
const distDir = path.join(root, 'dist');
const updateUrl = process.env.YTX_EXTENSION_UPDATE_URL || 'https://github.com/pixelstoLogic/YTX/releases/latest/download/updates.xml';
const crxUrl = process.env.YTX_EXTENSION_CRX_URL || 'https://github.com/pixelstoLogic/YTX/releases/latest/download/ytx-extension.crx';

function crc32(buffer) {
  let crc = 0xffffffff;
  if (!crc32.table) {
    crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c >>> 0;
    }
  }
  for (let i = 0; i < buffer.length; i++) crc = crc32.table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime() {
  // Fixed timestamp keeps repeated builds byte-for-byte stable.
  return { time: 0, date: ((2026 - 1980) << 9) | (1 << 5) | 1 };
}

function walk(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath, base));
    else if (entry.isFile()) files.push({ fullPath, relative: path.relative(base, fullPath).replace(/\\/g, '/') });
  }
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function createZip(files) {
  const { time, date } = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.relative, 'utf8');
    const data = fs.readFileSync(file.fullPath);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function varint(value) {
  const bytes = [];
  let number = value;
  while (number > 0x7f) {
    bytes.push((number & 0x7f) | 0x80);
    number = Math.floor(number / 128);
  }
  bytes.push(number & 0x7f);
  return Buffer.from(bytes);
}

function protobufField(number, payload) {
  return Buffer.concat([varint((number << 3) | 2), varint(payload.length), payload]);
}

function extensionIdFromPublicKey(publicKey) {
  const digest = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 32);
  return digest.replace(/[0-9a-f]/g, character => String.fromCharCode(97 + parseInt(character, 16)));
}

function loadOrCreateKey() {
  if (process.env.YTX_EXTENSION_KEY) return process.env.YTX_EXTENSION_KEY.replace(/\\n/g, '\n');
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath, 'utf8');
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    throw new Error(
      'The extension signing key is missing. Add the contents of build/keys/ytx-extension-key.pem as the ' +
      'YTX_EXTENSION_KEY repository secret so CI signs with the same extension ID as released builds.'
    );
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  fs.writeFileSync(keyPath, pair.privateKey, { mode: 0o600 });
  console.log(`Generated a stable YTX extension signing key at ${keyPath}`);
  return pair.privateKey;
}

function createCrx3(zip, privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const crxId = crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16);
  const signedHeaderData = protobufField(1, crxId);
  const signatureInput = Buffer.concat([
    Buffer.from('CRX3 SignedData\0', 'binary'),
    Buffer.from([signedHeaderData.length & 0xff, (signedHeaderData.length >>> 8) & 0xff, 0, 0]),
    signedHeaderData,
    zip
  ]);
  const signature = crypto.sign('sha256', signatureInput, { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING });
  const proof = Buffer.concat([protobufField(1, publicKey), protobufField(2, signature)]);
  const header = Buffer.concat([protobufField(2, proof), protobufField(10000, signedHeaderData)]);
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'ascii');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return { crx: Buffer.concat([prefix, header, zip]), publicKey, extensionId: extensionIdFromPublicKey(publicKey) };
}

function packageExtension() {
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`Extension source is missing: ${extensionDir}`);
  const privateKey = loadOrCreateKey();
  const manifestPath = path.join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  manifest.key = publicKey.toString('base64');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const files = walk(extensionDir).filter(file => !/^(ytx-extension\.crx|updates\.xml|extension-id\.txt)$/i.test(file.relative));
  const zip = createZip(files);
  const { crx, extensionId } = createCrx3(zip, privateKey);

  fs.mkdirSync(distDir, { recursive: true });
  const crxPath = path.join(distDir, 'ytx-extension.crx');
  fs.writeFileSync(crxPath, crx);
  fs.writeFileSync(path.join(extensionDir, 'ytx-extension.crx'), crx);
  const updateManifest = `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">\n  <app appid="${extensionId}">\n    <updatecheck codebase="${crxUrl}" version="${manifest.version}" />\n  </app>\n</gupdate>\n`;
  fs.writeFileSync(path.join(distDir, 'updates.xml'), updateManifest, 'utf8');
  fs.writeFileSync(path.join(extensionDir, 'updates.xml'), updateManifest, 'utf8');
  fs.writeFileSync(path.join(extensionDir, 'extension-id.txt'), extensionId + '\n', 'utf8');
  fs.writeFileSync(path.join(distDir, 'extension-id.txt'), extensionId + '\n', 'utf8');
  console.log(`Browser extension ${manifest.version} packaged as CRX3 (${extensionId}).`);
  return { extensionId, version: manifest.version, crxPath, updateUrl, crxUrl, updateManifest };
}

if (require.main === module) {
  try { packageExtension(); }
  catch (error) { console.error(error); process.exitCode = 1; }
}

module.exports = { packageExtension, extensionIdFromPublicKey, crc32, createZip, createCrx3 };
