import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import {
  createSessionToken,
  validatePassword,
  SESSION_COOKIE_NAME,
} from '@/lib/auth';

test('validatePassword validates correctly against process.env.ADMIN_PASSWORD', () => {
  const originalEnv = process.env.ADMIN_PASSWORD;
  try {
    process.env.ADMIN_PASSWORD = 'my-custom-env-password-2026';
    assert.equal(validatePassword('my-custom-env-password-2026'), true);
    assert.equal(validatePassword('wrong-password'), false);
    assert.equal(validatePassword('admin123'), false);
  } finally {
    if (originalEnv !== undefined) {
      process.env.ADMIN_PASSWORD = originalEnv;
    } else {
      delete process.env.ADMIN_PASSWORD;
    }
  }
});

test('unauthenticated user visiting root / is redirected to /login', () => {
  const req = new NextRequest('http://localhost:3000/');
  const res = proxy(req);

  assert.equal(res.status, 307);
  const location = res.headers.get('location');
  assert.equal(location, 'http://localhost:3000/login');
});

test('unauthenticated user visiting /movie/123 is redirected to /login with redirect param', () => {
  const req = new NextRequest('http://localhost:3000/movie/123?source=home');
  const res = proxy(req);

  assert.equal(res.status, 307);
  const location = new URL(res.headers.get('location')!);
  assert.equal(location.pathname, '/login');
  assert.equal(location.searchParams.get('redirect'), '/movie/123?source=home');
});

test('unauthenticated request to protected API returns 401 JSON', async () => {
  const req = new NextRequest('http://localhost:3000/api/drama/list');
  const res = proxy(req);

  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.code, 401);
  assert.equal(body.error, 'Unauthorized');
});

test('whitelist paths are allowed without authentication', () => {
  const whitelistUrls = [
    'http://localhost:3000/login',
    'http://localhost:3000/api/auth/login',
    'http://localhost:3000/api/auth/logout',
    'http://localhost:3000/api/health',
    'http://localhost:3000/_next/static/chunks/main.js',
    'http://localhost:3000/favicon.ico',
    'http://localhost:3000/images/banner.jpg',
    'http://localhost:3000/logo.svg',
  ];

  for (const url of whitelistUrls) {
    const req = new NextRequest(url);
    const res = proxy(req);
    // NextResponse.next() 状态码为 200，且不含 location 重定向头
    assert.equal(res.headers.get('location'), null, `Url ${url} should not redirect`);
    assert.notEqual(res.status, 401, `Url ${url} should not be 401`);
  }
});

test('authenticated user is allowed to access protected page and API', () => {
  const validToken = createSessionToken();

  const pageReq = new NextRequest('http://localhost:3000/browse/movies', {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
    },
  });
  const pageRes = proxy(pageReq);
  assert.equal(pageRes.headers.get('location'), null);

  const apiReq = new NextRequest('http://localhost:3000/api/drama/list', {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
    },
  });
  const apiRes = proxy(apiReq);
  assert.notEqual(apiRes.status, 401);
});

test('authenticated user visiting /login is redirected to home or redirect target', () => {
  const validToken = createSessionToken();

  const req1 = new NextRequest('http://localhost:3000/login', {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
    },
  });
  const res1 = proxy(req1);
  assert.equal(res1.status, 307);
  assert.equal(res1.headers.get('location'), 'http://localhost:3000/');

  const req2 = new NextRequest('http://localhost:3000/login?redirect=/admin/settings', {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${validToken}`,
    },
  });
  const res2 = proxy(req2);
  assert.equal(res2.status, 307);
  assert.equal(res2.headers.get('location'), 'http://localhost:3000/admin/settings');
});
