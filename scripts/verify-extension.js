#!/usr/bin/env node
/* Verifies the signed CRX3 produced by scripts/package-extension.js. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function readVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor++];
    value += (byte & 0x7f) * Math.pow(2, shift);
    if (!(byte & 0x80)) return { value, offset: cursor };
    shift += 7;
  }
  throw new Error('Truncated protobuf varint.');
}

function parseFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value & 7;
    if (wireType !== 2) throw new Error(`Unsupported protobuf wire type ${wireType}.`);
    const length = readVarint(buffer, offset);
    offset = length.offset;
    fields.push({ fieldNumber, payload: buffer.subarray(offset, offset + length.value) });
    offset += length.value;
  }
  return fields;
}

function verify(crxPath) {
  const crx = fs.readFileSync(crxPath);
  if (crx.subarray(0, 4).toString('ascii') !== 'Cr24') throw new Error('Not a CRX file.');
  if (crx.readUInt32LE(4) !== 3) throw new Error('Not a CRX3 file.');
  const headerLength = crx.readUInt32LE(8);
  const header = crx.subarray(12, 12 + headerLength);
  const zip = crx.subarray(12 + headerLength);
  if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error('The CRX payload is not a ZIP archive.');
  const fields = parseFields(header);
  const proofPayload = fields.find(field => field.fieldNumber === 2)?.payload;
  const signedHeaderData = fields.find(field => field.fieldNumber === 10000)?.payload;
  if (!proofPayload || !signedHeaderData) throw new Error('CRX3 header is missing its proof or signed data.');
  const proof = parseFields(proofPayload);
  const publicKey = proof.find(field => field.fieldNumber === 1)?.payload;
  const signature = proof.find(field => field.fieldNumber === 2)?.payload;
  if (!publicKey || !signature) throw new Error('CRX3 proof is incomplete.');
  const expectedId = crypto.createHash('sha256').update(publicKey).digest().subarray(0, 16);
  const signedId = parseFields(signedHeaderData).find(field => field.fieldNumber === 1)?.payload;
  if (!signedId || !signedId.equals(expectedId)) throw new Error('CRX3 crx_id does not match the public key.');
  const signatureInput = Buffer.concat([
    Buffer.from('CRX3 SignedData\0', 'binary'),
    Buffer.from([signedHeaderData.length & 0xff, (signedHeaderData.length >>> 8) & 0xff, 0, 0]),
    signedHeaderData,
    zip
  ]);
  const key = crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
  if (!crypto.verify('sha256', signatureInput, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, signature)) throw new Error('CRX3 signature is invalid.');
  const id = expectedId.toString('hex').replace(/[0-9a-f]/g, character => String.fromCharCode(97 + parseInt(character, 16)));
  return { id };
}

if (require.main === module) {
  try {
    const crxPath = process.argv[2] || path.join(__dirname, '..', 'dist', 'ytx-extension.crx');
    const result = verify(crxPath);
    console.log(`Verified CRX3 signature and extension ID ${result.id}: ${crxPath}`);
  } catch (error) {
    console.error(`CRX verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verify };
