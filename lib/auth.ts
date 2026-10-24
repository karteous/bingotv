import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

// Session cookie 名称
export const SESSION_COOKIE_NAME = 'admin_session';
const SESSION_TOKEN_VERSION = 'v1';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

interface SessionTokenOptions {
  secret?: string;
  now?: number;
  maxAge?: number;
}

// 获取管理员密码（运行时动态读取环境变量，避免构建时被内联）
function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || 'admin123';
}

function getSessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || getAdminPassword();
}

// 纯 JS 实现 SHA256，兼容 Node.js 与 Edge Runtime，避免 Edge 中无法使用 node:crypto
function sha256Bytes(bytes: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const len = bytes.length;
  const bitLen = len * 8;
  const newLen = (((len + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(newLen);
  padded.set(bytes);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(newLen - 4, bitLen, false);
  view.setUint32(newLen - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < newLen; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(i + j * 4, false);
    }
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + w[j]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((val, idx) => outView.setUint32(idx * 4, val, false));
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signSessionPayload(payload: string, secret: string): string {
  const enc = new TextEncoder();
  const rawKey = enc.encode(secret);
  const data = enc.encode(payload);
  const blockSize = 64;

  const key = rawKey.length > blockSize ? sha256Bytes(rawKey) : rawKey;
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(key);

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }

  const inner = new Uint8Array(blockSize + data.length);
  inner.set(iKeyPad, 0);
  inner.set(data, blockSize);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(blockSize + 32);
  outer.set(oKeyPad, 0);
  outer.set(innerHash, blockSize);
  const outerHash = sha256Bytes(outer);

  return bytesToBase64Url(outerHash);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function getSessionCookieSecureFlag(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function createSessionToken(options: SessionTokenOptions = {}): string {
  const now = options.now ?? Date.now();
  const maxAge = options.maxAge ?? SESSION_MAX_AGE_SECONDS;
  const secret = options.secret ?? getSessionSecret();
  const expiresAt = now + maxAge * 1000;
  const payload = `${SESSION_TOKEN_VERSION}.${expiresAt}`;
  const signature = signSessionPayload(payload, secret);

  return `${payload}.${signature}`;
}

export function validateSessionToken(
  token: string | undefined | null,
  options: Omit<SessionTokenOptions, 'maxAge'> = {}
): boolean {
  if (!token) {
    return false;
  }

  const [version, expiresAtRaw, signature, ...rest] = token.split('.');

  if (rest.length > 0 || version !== SESSION_TOKEN_VERSION || !expiresAtRaw || !signature) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  const now = options.now ?? Date.now();

  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return false;
  }

  const secret = options.secret ?? getSessionSecret();
  const expectedSignature = signSessionPayload(`${version}.${expiresAtRaw}`, secret);

  return safeEqual(signature, expectedSignature);
}

export function validateRequestSession(
  request: Pick<NextRequest, 'cookies'> | undefined
): boolean {
  if (!request) {
    return false;
  }

  return validateSessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

// 创建会话
export async function createSession(): Promise<void> {
  const cookieStore = await cookies();
  // 设置session cookie，有效期7天
  cookieStore.set(SESSION_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: getSessionCookieSecureFlag(),
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/'
  });
}

// 删除会话
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

// 验证会话
export async function validateSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME);
  return validateSessionToken(session?.value);
}

// 验证密码（依据环境变量 ADMIN_PASSWORD）
export function validatePassword(password: string): boolean {
  const adminPassword = getAdminPassword();
  return Boolean(adminPassword && password === adminPassword);
}
