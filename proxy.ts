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
    // 如果是页面请求，重定向到 /login
    if (!pathname.startsWith('/api')) {
      const loginUrl = new URL('/login', request.url);
      const redirectPath = `${pathname}${search}`;
      if (redirectPath !== '/' && !redirectPath.startsWith('/login')) {
        loginUrl.searchParams.set('redirect', redirectPath);
      }
      return NextResponse.redirect(loginUrl);
    }

    // 如果是 API 请求：
    // 后台管理敏感操作和管理页面相关接口必须鉴权拦截，防止未经授权的修改；
    // 业务读取接口（如视频检索、图片/视频流代理）避免因服务端内部自调用（无 Cookie）或跨域标签而导致全网资源匹配失效。
    const isProtectedAdminApi =
      pathname.startsWith('/api/database') ||
      pathname.startsWith('/api/decrypt') ||
      pathname.startsWith('/api/admin');

    if (isProtectedAdminApi) {
      return NextResponse.json(
        { code: 401, error: 'Unauthorized', message: '请先登录' },
        { status: 401 }
      );
    }
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
