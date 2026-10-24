"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Film } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok) {
        // 登录成功，跳转到目标页面或首页
        const target =
          redirect.startsWith("/") &&
          !redirect.startsWith("//") &&
          !redirect.startsWith("/login")
            ? redirect
            : "/";
        router.push(target);
        router.refresh();
      } else {
        setError(data.error || "密码错误，请重新输入");
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("网络错误或服务异常，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#141414] relative overflow-hidden px-4">
      {/* 背景暗影与光晕效果 */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="bg-[#1a1a1a]/90 backdrop-blur-md rounded-2xl shadow-2xl p-8 sm:p-10 border border-zinc-800">
          {/* Logo 区域 */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-600/10 text-red-600 mb-4 border border-red-600/20">
              <Film className="w-7 h-7" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[#E50914] tracking-tight">
              bingoTV
            </h1>
            <p className="text-zinc-400 text-sm mt-2">
              全站访问受限，请输入访问密码以继续
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-2"
              >
                访问密码
              </label>
              <div className="relative">
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 bg-zinc-900 border border-zinc-700/80 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#E50914] focus:border-transparent transition text-base"
                  placeholder="请输入访问密码"
                  required
                  autoFocus
                />
                <Lock className="w-5 h-5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm flex items-center gap-2 animate-shake">
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#E50914] hover:bg-[#b80710] active:scale-[0.99] disabled:bg-red-900/60 disabled:cursor-not-allowed text-white font-semibold py-3.5 px-4 rounded-xl shadow-lg shadow-red-900/20 transition-all duration-200 text-base"
            >
              {loading ? "正在验证..." : "进入网站"}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-zinc-800/80 text-center">
            <p className="text-xs text-zinc-500">
              © {new Date().getFullYear()} bingoTV · 海量精彩影视尽在其中
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#141414]">
          <div className="text-white text-sm">加载中...</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
