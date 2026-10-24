'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';
import { Drama } from '@/types/drama';

interface DramaCardProps {
  drama: Drama;
  onSelect: (drama: Drama) => void;
}

export default function DramaCard({ drama, onSelect }: DramaCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);

  const getProxyImageUrl = (url: string) => {
    if (!url) return '';
    return `//wsrv.nl/?url=${encodeURIComponent(url)}&w=400&h=600&fit=cover&output=webp`;
  };

  return (
    <div
      className="relative cursor-pointer transition-all duration-300 ease-out group"
      onClick={() => onSelect(drama)}
    >
      {/* 卡片容器 */}
      <div className="relative rounded-lg overflow-hidden transition-all duration-300 scale-100 group-hover:scale-102 group-hover:z-10 group-hover:shadow-2xl">
        {/* 图片 */}
        <div className="relative aspect-[2/3] bg-gray-900">
          {drama.pic ? (
            <>
              <img
                src={getProxyImageUrl(drama.pic)}
                alt={drama.name}
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  imageLoaded ? 'opacity-100' : 'opacity-0'
                }`}
                onLoad={() => setImageLoaded(true)}
                loading="lazy"
              />
              {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-gray-700 border-t-gray-500 rounded-full animate-spin" />
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-600">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}

          {/* 缩略图正中间单图标播放按钮 */}
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="w-10 h-10 sm:w-11 sm:h-11 bg-black/60 group-hover:bg-red-600 text-white rounded-full flex items-center justify-center backdrop-blur-md border border-white/25 shadow-xl transition-all duration-300 group-hover:scale-110">
              <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current ml-0.5 text-white" />
            </div>
          </div>

          {/* 渐变遮罩 */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-80 group-hover:opacity-100 transition-opacity duration-300" />
        </div>

        {/* 底部信息层 */}
        <div className="absolute bottom-0 left-0 right-0 p-2.5 sm:p-3 transform transition-all duration-300 z-10">
          <h3 className="text-white font-semibold text-xs sm:text-sm mb-1 line-clamp-1 drop-shadow-md">{drama.name}</h3>
          
          <div className="flex items-center space-x-1.5 text-[10px] sm:text-xs text-gray-300">
            {drama.remarks && (
              <span className="px-1.5 py-0.5 bg-green-600/90 text-white rounded text-[10px] font-medium">
                {drama.remarks}
              </span>
            )}
            {drama.year && (
              <span>{drama.year}</span>
            )}
            {drama.type && (
              <span className="text-gray-400 line-clamp-1">· {drama.type}</span>
            )}
          </div>
        </div>

        {/* 标签 */}
        {drama.remarks && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-green-600/90 backdrop-blur-sm text-white rounded text-[10px] font-medium z-10">
            {drama.remarks}
          </div>
        )}
      </div>
    </div>
  );
}
