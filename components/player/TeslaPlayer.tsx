"use client";

import { useState } from "react";
import { ExternalLink, RotateCw } from "lucide-react";

interface TeslaPlayerProps {
  videoUrl: string;
  title?: string;
}

export function TeslaPlayer({ videoUrl, title }: TeslaPlayerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const teslaPlayerUrl = `https://tesla-player.com/?url=${encodeURIComponent(videoUrl)}`;

  const handleOpenExternal = () => {
    window.open(teslaPlayerUrl, "_blank");
  };

  const handleReload = () => {
    setIsLoading(true);
    setReloadKey((prev) => prev + 1);
  };

  return (
    <div className="relative w-full h-full bg-black flex flex-col">
      {/* 顶部特斯拉快捷条 */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
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
        <div className="absolute inset-0 z-10 bg-black flex flex-col items-center justify-center gap-3">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-700 border-t-red-600" />
          <p className="text-gray-400 text-sm">正在加载 Tesla 播放器...</p>
        </div>
      )}

      {/* Tesla Player 核心嵌入 */}
      <iframe
        key={reloadKey}
        src={teslaPlayerUrl}
        className="w-full h-full border-0 grow"
        allowFullScreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        title={title ? `Tesla Player - ${title}` : "Tesla Player"}
        onLoad={() => setIsLoading(false)}
      />
    </div>
  );
}
