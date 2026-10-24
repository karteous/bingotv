'use client';

import { useState } from 'react';
import { Play, Star } from 'lucide-react';
import { DoubanMovie } from '@/types/douban';

interface DoubanCardProps {
  movie: DoubanMovie;
  onSelect: (movie: DoubanMovie) => void;
  /** 是否为首屏可见卡片，优先加载 */
  priority?: boolean;
}

export default function DoubanCard({ movie, onSelect, priority = false }: DoubanCardProps) {
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
 
  // 豆瓣图片使用代理
  const imageUrl = `/api/image-proxy?url=${encodeURIComponent(movie.cover)}`;

  return (
    <div
      onClick={() => onSelect(movie)}
      className="group relative cursor-pointer transition-all duration-300 hover:scale-102 hover:z-10"
    >
      {/* 海报缩略图容器 */}
      <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-gray-800 shadow-md">
        {!imageError ? (
          <img
            src={imageUrl}
            alt={movie.title}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              isLoading ? 'opacity-0' : 'opacity-100'
            }`}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setImageError(true);
              setIsLoading(false);
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            <svg className="w-10 h-10 sm:w-12 sm:h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        
        {/* 加载状态 */}
        {isLoading && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
            <div className="animate-spin rounded-full h-6 w-6 sm:h-8 sm:w-8 border-2 border-gray-600 border-t-white" />
          </div>
        )}

        {/* 评分标签 */}
        {movie.rate && (
          <div className="absolute top-1.5 left-1.5 sm:top-2 sm:left-2 px-1.5 py-0.5 bg-black/80 backdrop-blur-sm rounded text-yellow-400 text-xs sm:text-sm font-bold flex items-center space-x-0.5 sm:space-x-1 z-10">
            <Star className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-current" />
            <span>{movie.rate}</span>
          </div>
        )}

        {/* 缩略图正中间单图标播放按钮 */}
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="w-10 h-10 sm:w-11 sm:h-11 bg-black/60 group-hover:bg-red-600 text-white rounded-full flex items-center justify-center backdrop-blur-md border border-white/25 shadow-xl transition-all duration-300 group-hover:scale-110">
            <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current ml-0.5 text-white" />
          </div>
        </div>

        {/* 底部片名渐变遮罩层 */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent pt-8 pb-2 px-2.5 sm:px-3 z-10">
          <h3 className="text-white font-bold text-xs sm:text-sm line-clamp-1 drop-shadow-md">
            {movie.title}
          </h3>
          {movie.episode_info && (
            <p className="text-gray-300 text-[10px] mt-0.5 line-clamp-1">
              {movie.episode_info}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
