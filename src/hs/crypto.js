// crypto.js — request signing + payload encryption exactly as the HouseSigma web client does it.
//
// Signing (needSignApi paths):
//   ts = unix seconds (10 chars)
//   qs = top-level keys sorted DESCENDING, only string/number values, `urlenc(k)=urlenc(v)`, joined by '&', lowercased
//   signature = md5(qs + ts + apiSalt); body gets { signature, ts }
//
// Encryption (encryptPaths, when secret.is_encrypted === 1):
//   key     = secret_key.padEnd(16,'*').slice(0,16) as ASCII bytes  -> AES-128-CTR
//   counter = 16 random bytes (used as the initial CTR block, length 128)
//   enc     = AES-CTR(JSON({...body, hs_request_timestamp: ts}))
//   ctr     = RSA-OAEP(SHA-1, bundle public key) over counter
//   body    = { ctr: b64(ctr), et_payload: b64(enc) }, header Hs-Request-Timestamp: ts
//   response.data = b64(AES-CTR(gzip(JSON))) with the same key + counter -> decrypt, gunzip, parse
'use strict';
const crypto = require('crypto');
const zlib = require('zlib');

function ts10() { return String(Date.now()).slice(0, 10); }

function sign(body, ts, salt) {
  const qs = Object.keys(body).sort().reverse().map(k => {
    const v = body[k];
    if (typeof v === 'number' && Number.isNaN(v)) return null;
    if (typeof v === 'string' || typeof v === 'number') return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    return null;
  }).filter(Boolean).join('&').toLowerCase();
  return crypto.createHash('md5').update(qs + ts + salt).digest('hex');
}

function aesKey(secretKey) {
  return Buffer.from(String(secretKey).padEnd(16, '*').slice(0, 16), 'utf8');
}

function encryptBody(body, secretKey, pem) {
  const key = aesKey(secretKey);
  const counter = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-ctr', key, counter);
  const plain = Buffer.from(JSON.stringify(body), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const ctr = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
    counter,
  );
  return { payload: { ctr: ctr.toString('base64'), et_payload: enc.toString('base64') }, counter, key };
}

function inflateAny(buf) {
  const tries = [zlib.gunzipSync, zlib.inflateSync, zlib.inflateRawSync, zlib.brotliDecompressSync];
  for (const fn of tries) { try { return fn(buf); } catch { /* next */ } }
  return buf; // maybe it was never compressed
}

function decryptData(b64, key, counter) {
  const enc = Buffer.from(b64, 'base64');
  const decipher = crypto.createDecipheriv('aes-128-ctr', key, counter);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  const text = inflateAny(dec).toString('utf8');
  return JSON.parse(text);
}

module.exports = { ts10, sign, encryptBody, decryptData, aesKey };
