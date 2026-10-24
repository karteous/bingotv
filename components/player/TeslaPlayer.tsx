"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, RotateCw } from "lucide-react";

interface TeslaPlayerProps {
  videoUrl: string;
  title?: string;
  onEnded?: () => void;
}

export function TeslaPlayer({ videoUrl, title, onEnded }: TeslaPlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // 本地同源车机播放页面（底层全面启用 dist/assets/avplayer-d71a6953.js Canvas 硬件解码）
  const teslaPlayerUrl = `/dist/index.html?url=${encodeURIComponent(
    videoUrl
  )}${title ? `&title=${encodeURIComponent(title)}` : ""}`;

  const handleOpenExternal = () => {
    window.open(teslaPlayerUrl, "_blank");
  };

  const handleReload = () => {
    setIsLoading(true);
    setReloadKey((prev) => prev + 1);
  };

  // 监听来自播放器 iframe 的事件通信
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return;
      if (event.data.type === "PLAYER_READY") {
        setIsLoading(false);
      } else if (event.data.type === "VIDEO_ENDED") {
        if (onEnded) onEnded();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [onEnded]);

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
          title="在特斯拉车机独立全屏打开（Canvas 行车模式）"
        >
          <span>车机全屏</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 加载指示 */}
      {isLoading && (
        <div className="absolute inset-0 z-20 bg-black flex flex-col items-center justify-center gap-3 pointer-events-none">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-700 border-t-red-600" />
          <p className="text-gray-400 text-sm">正在加载自研车机播放器 (Canvas 硬解)...</p>
        </div>
      )}

      {/* 嵌入本地同源 Canvas 播放器 */}
      <iframe
        key={`${reloadKey}-${videoUrl}`}
        ref={iframeRef}
        src={teslaPlayerUrl}
        className="w-full h-full border-0 grow"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
        title={title ? `Tesla Player - ${title}` : "Tesla Player"}
        onLoad={() => setIsLoading(false)}
      />
    </div>
  );
}
