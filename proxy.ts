import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, validateSessionToken } from '@/lib/auth';

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 1. 静态资源与系统探针放行
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/health') ||
    pathname === '/favicon.ico' ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|css|js|map)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  // 2. 检查会话有效性
  const session = request.cookies.get(SESSION_COOKIE_NAME);
  const isAuthenticated = validateSessionToken(session?.value);

  // 3. 登录/登出相关路径处理
  if (pathname === '/login') {
    // 已登录用户访问登录页，自动跳转到指定目标或首页
    if (isAuthenticated) {
      const redirectUrl = request.nextUrl.searchParams.get('redirect') || '/';
      const target =
        redirectUrl.startsWith('/') &&
        !redirectUrl.startsWith('//') &&
        !redirectUrl.startsWith('/login')
          ? redirectUrl
          : '/';
      return NextResponse.redirect(new URL(target, request.url));
    }
    return NextResponse.next();
  }

  if (pathname === '/api/auth/login' || pathname === '/api/auth/logout') {
    return NextResponse.next();
  }

  // 4. 未登录拦截：必须登录才能进入网站
  if (!isAuthenticated) {
    // API 请求返回 401 JSON
    if (pathname.startsWith('/api')) {
      return NextResponse.json(
        { code: 401, error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      );
    }

    // 页面请求重定向到 /login
    const loginUrl = new URL('/login', request.url);
    const redirectPath = `${pathname}${search}`;
    if (redirectPath !== '/' && !redirectPath.startsWith('/login')) {
      loginUrl.searchParams.set('redirect', redirectPath);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配除内部静态资源之外的所有请求
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
