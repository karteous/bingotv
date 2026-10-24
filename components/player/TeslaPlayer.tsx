"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, RotateCw } from "lucide-react";

interface TeslaPlayerProps {
  videoUrl: string;
  title?: string;
  onEnded?: () => void;
}

export function TeslaPlayer({ videoUrl, title, onEnded }: TeslaPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 本地独立车机播放页面
  const standaloneUrl = `/dist/index.html?url=${encodeURIComponent(
    videoUrl
  )}${title ? `&title=${encodeURIComponent(title)}` : ""}`;

  const handleOpenExternal = () => {
    window.open(standaloneUrl, "_blank");
  };

  const handleReload = () => {
    if (playerRef.current && videoUrl) {
      setIsLoading(true);
      playerRef.current.loadSource(videoUrl);
      setTimeout(() => setIsLoading(false), 300);
    }
  };

  useEffect(() => {
    let isMounted = true;

    async function initPlayer() {
      if (!containerRef.current) return;
      setIsLoading(true);

      try {
        // 动态引入 Hls.js（如果全局未定义）
        if (typeof window !== "undefined" && !(window as unknown as { Hls?: unknown }).Hls) {
          const HlsModule = (await import("hls.js")).default;
          (window as unknown as { Hls: unknown }).Hls = HlsModule;
        }

        // 动态导入自研 Player 内核（非第三方 ArtPlayer）
        const { Player } = await import("@/dist/player-ui.js");

        if (!isMounted || !containerRef.current) return;

        // 销毁旧实例
        if (playerRef.current) {
          playerRef.current.destroy();
          playerRef.current = null;
        }

        const player = new Player({
          container: containerRef.current,
          url: videoUrl,
          title: title || "自研车机播放器",
          isLive: false,
        });

        // 监听结束事件
        if (player.video && onEnded) {
          player.video.addEventListener("ended", onEnded);
        }

        playerRef.current = player;
      } catch (err) {
        console.error("[TeslaPlayer Mount Error]", err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initPlayer();

    return () => {
      isMounted = false;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
    };
  }, [videoUrl, title, onEnded]);

  return (
    <div className="relative w-full h-full bg-black flex flex-col overflow-hidden">
      {/* 顶部快捷操作栏 */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-2 pointer-events-auto">
        <button
          onClick={handleReload}
          className="p-2 bg-black/60 hover:bg-black/80 text-gray-300 hover:text-white rounded-lg backdrop-blur-md transition-colors border border-white/10"
          title="刷新播放器"
          aria-label="刷新播放器"
        >
          <RotateCw className="w-4 h-4" />
        </button>
        <button
          onClick={handleOpenExternal}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-black/60 hover:bg-red-600/80 text-gray-300 hover:text-white text-xs font-medium rounded-lg backdrop-blur-md transition-all border border-white/10 shadow-lg"
          title="在特斯拉车机独立全屏打开"
        >
          <span>车机全屏</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 加载指示 */}
      {isLoading && (
        <div className="absolute inset-0 z-20 bg-black flex flex-col items-center justify-center gap-3 pointer-events-none">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-700 border-t-red-600" />
          <p className="text-gray-400 text-sm">正在加载自研车机播放器...</p>
        </div>
      )}

      {/* 自研播放器挂载容器 */}
      <div ref={containerRef} className="w-full h-full grow" />
    </div>
  );
}
