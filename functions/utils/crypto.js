/**
 * Lightweight stateless HMAC-SHA256 token signer and verifier for Cloudflare Workers / Pages
 */
const encoder = new TextEncoder();

async function getHmacKey(secret) {
  if (!secret) throw new Error('HMAC secret is required');
  return await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function createSessionToken(username, secret, ttlSeconds = 60 * 60 * 24 * 30) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = JSON.stringify({ u: username, exp: expiresAt });
  const base64Payload = btoa(payload);

  const key = await getHmacKey(secret);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const signatureHex = bufferToHex(signatureBuffer);

  return `${base64Payload}.${signatureHex}`;
}

export async function verifySessionToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [base64Payload, signatureHex] = parts;

  try {
    const payload = JSON.parse(atob(base64Payload));
    if (!payload.exp || Date.now() > payload.exp) {
      return false; // Expired
    }

    const key = await getHmacKey(secret);
    const expectedSig = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
    const expectedSigHex = bufferToHex(expectedSig);

    if (expectedSigHex !== signatureHex) {
      return false; // Invalid signature
    }

    return payload;
  } catch {
    return false;
  }
}

export function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}
