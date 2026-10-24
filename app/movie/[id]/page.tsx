"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Play,
  Star,
  Loader2,
  AlertCircle,
  RefreshCw,
  Clock,
  MapPin,
  Users,
  Clapperboard,
  ImageIcon,
  MessageCircle,
  Film,
} from "lucide-react";
import Link from "next/link";
import { getImageUrl } from "@/lib/utils/image-utils";
import { cleanTitleForSearch } from "@/lib/utils/title-utils";
import { loadMovieCache } from "@/hooks/useMovieMatch";

interface AvailableSource {
  source_key: string;
  source_name: string;
  vod_id: string | number;
  vod_name: string;
  match_confidence: "high" | "medium" | "low";
  priority: number; // 视频源优先级，数值越小越靠前
}

interface CachedMatchData {
  douban_id: string;
  title: string;
  matches: AvailableSource[];
  timestamp: number;
}

// 完整的电影详情
interface MovieDetail {
  id: string;
  title: string; // 完整标题（含外文名/年份）用于显示
  searchTitle: string; // 简短标题用于搜索
  cover: string;
  rate: string;
  types: string[];
  directors: string[];
  actors: string[];
  duration: string;
  region: string;
  release_year: string;
  episodes_count: string;
  short_comment?: {
    content: string;
    author: string | { name: string };
  };
  // 新增字段 - 来自增强的API
  photos?: Array<{
    id: string;
    image: string;
    thumb: string;
  }>;
  comments?: Array<{
    id: string;
    content: string;
    author: {
      name: string;
    };
  }>;
  recommendations?: Array<{
    id: string;
    title: string;
    cover: string;
    rate: string;
  }>;
}

type SearchStatus = "idle" | "searching" | "success" | "error" | "not_found";

export default function MovieDetailPage() {
  const params = useParams();
  const router = useRouter();

  const doubanId = params.id as string;

  // 电影详情状态
  const [movieDetail, setMovieDetail] = useState<MovieDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(true);

  // 智能返回：如果有历史记录则返回，否则跳转首页
  const goBack = useCallback(() => {
    // window.history.length > 2 表示有可返回的历史（1是初始页面，2是当前页面）
    if (window.history.length > 2) {
      router.back();
    } else {
      router.push("/");
    }
  }, [router]);

  // 获取电影详情：优先缓存快速显示，API 补充详细信息
  useEffect(() => {
    // 1. 立即从缓存加载数据（快速显示）
    const cached = loadMovieCache(doubanId);
    if (cached) {
      setMovieDetail({
        id: cached.id,
        title: cached.title,
        searchTitle: cached.title, // 缓存的是简短标题
        cover: cached.cover,
        rate: cached.rate,
        types: [],
        directors: [],
        actors: [],
        duration: "",
        region: "",
        release_year: "",
        episodes_count: cached.episode_info || "",
      });
      setIsLoadingDetail(false); // 有缓存立即结束加载状态
    }

    // 2. 异步请求 API 补充详细信息
    const fetchApiDetail = async () => {
      try {
        const { getSubjectDetail } = await import("@/lib/douban-service");
        const apiData = await getSubjectDetail(doubanId);
        if (apiData && apiData.id) {
          // 用 API 数据补充缓存没有的字段，缓存字段优先
          setMovieDetail((prev) => {
            const cachedData = prev || ({} as MovieDetail);
            return {
              id: cachedData.id || apiData.id,
              title: cachedData.title || apiData.title,
              searchTitle:
                cachedData.searchTitle || cleanTitleForSearch(apiData.title),
              // 封面：缓存优先，但如果缓存是空的则用API的
              cover: cachedData.cover || apiData.cover || "",
              rate: cachedData.rate || apiData.rate || "",
              // 以下字段缓存通常没有，用 API 补充
              types: apiData.types || cachedData.types || [],
              directors: apiData.directors || cachedData.directors || [],
              actors: apiData.actors || cachedData.actors || [],
              duration: apiData.duration || cachedData.duration || "",
              region: apiData.region || cachedData.region || "",
              release_year:
                apiData.release_year || cachedData.release_year || "",
              episodes_count:
                cachedData.episodes_count || apiData.episodes_count || "",
              short_comment: apiData.short_comment || cachedData.short_comment,
              // 新增字段
              photos: apiData.photos || [],
              comments: apiData.comments || [],
              recommendations: apiData.recommendations || [],
            };
          });
        }
      } catch (error) {
        console.warn("API 获取详情失败:", error);
      } finally {
        setIsLoadingDetail(false);
      }
    };

    if (doubanId) {
      fetchApiDetail();
    }
  }, [doubanId]);

  // 便捷访问
  const title = movieDetail?.title || "";
  const searchTitle = movieDetail?.searchTitle || ""; // 用于搜索的简短标题
  const cover = movieDetail?.cover || "";
  const rate = movieDetail?.rate || "";

  // 搜索状态
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [availableSources, setAvailableSources] = useState<AvailableSource[]>(
    []
  );
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [searchedSourceCount, setSearchedSourceCount] = useState<number>(0);
  const [totalSourceCount, setTotalSourceCount] = useState<number>(0);

  // 流式搜索播放源 - 每个源完成立即显示
  const searchPlaySources = useCallback(
    async (forceRefresh = false) => {
      // 检查缓存
      if (!forceRefresh) {
        try {
          const cached = localStorage.getItem("multi_source_matches");
          if (cached) {
            const data: CachedMatchData = JSON.parse(cached);
            // 缓存有效期 30 分钟，且是同一部影片
            if (
              data.douban_id === doubanId &&
              Date.now() - data.timestamp < 30 * 60 * 1000 &&
              data.matches.length > 0
            ) {
              // 缓存数据也需要按 priority 排序，确保顺序一致
              const sorted = [...data.matches].sort((a, b) => {
                // 先按 priority 排序
                if (a.priority !== b.priority) {
                  return a.priority - b.priority;
                }
                // 同 priority 按置信度排序：high > medium > low
                const order = { high: 3, medium: 2, low: 1 };
                return order[b.match_confidence] - order[a.match_confidence];
              });
              setAvailableSources(sorted);
              setSearchStatus("success");
              return;
            }
          }
        } catch {
          // 缓存读取失败，继续搜索
        }
      }

      // 开始流式搜索
      setSearchStatus("searching");
      setErrorMessage("");
      setAvailableSources([]);
      setSearchedSourceCount(0);
      setTotalSourceCount(0);

      try {
        // 使用简短标题搜索，提高匹配率
        const response = await fetch(
          `/api/douban/match-vod-stream?title=${encodeURIComponent(
            searchTitle
          )}&douban_id=${doubanId}`
        );

        if (!response.ok) {
          throw new Error("搜索请求失败");
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("无法读取响应流");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        const allMatches: AvailableSource[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // 解析 SSE 数据
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === "init") {
                  setTotalSourceCount(data.totalSources);
                } else if (data.type === "result") {
                  setSearchedSourceCount(data.completed);

                  // 如果找到匹配，立即添加到列表
                  if (data.match) {
                    allMatches.push(data.match);
                    // 按优先级排序（数值越小越靠前），同优先级按置信度排序
                    const sorted = [...allMatches].sort((a, b) => {
                      // 先按 priority 排序
                      if (a.priority !== b.priority) {
                        return a.priority - b.priority;
                      }
                      // 同 priority 按置信度排序：high > medium > low
                      const order = { high: 3, medium: 2, low: 1 };
                      return (
                        order[b.match_confidence] - order[a.match_confidence]
                      );
                    });
                    setAvailableSources(sorted);

                    // 只要找到第一个源，就切换到 success 状态
                    if (allMatches.length === 1) {
                      setSearchStatus("success");
                    }
                  }
                } else if (data.type === "done") {
                  // 搜索完成
                  if (allMatches.length > 0) {
                    // 缓存结果
                    localStorage.setItem(
                      "multi_source_matches",
                      JSON.stringify({
                        douban_id: doubanId,
                        title: searchTitle,
                        matches: allMatches,
                        timestamp: Date.now(),
                      })
                    );
                    // 确保状态为成功
                    setSearchStatus("success");
                  } else {
                    setSearchStatus("not_found");
                    setErrorMessage(
                      `已搜索 ${data.totalSources} 个视频源，未找到匹配内容`
                    );
                  }
                }
              } catch (e) {
                console.error("解析 SSE 数据失败:", e);
              }
            }
          }
        }
      } catch (error) {
        setSearchStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "搜索播放源时出错"
        );
      }
    },
    [doubanId, searchTitle]
  );

  // 组件挂载时自动搜索
  useEffect(() => {
    let isMounted = true;

    const doSearch = async () => {
      if (doubanId && searchTitle && isMounted) {
        await searchPlaySources();
      }
    };

    doSearch();

    return () => {
      isMounted = false;
    };
  }, [doubanId, searchTitle, searchPlaySources]);

  // 播放
  const handlePlay = (source: AvailableSource) => {
    router.push(
      `/play/${source.vod_id}?source=${source.source_key}&multi=true`
    );
  };

  // 智能选取横屏大背景图：优先使用剧照，没有则使用封面
  const heroBackdrop =
    movieDetail?.photos && movieDetail.photos.length > 0
      ? movieDetail.photos[0].image
      : cover;

  // 快速播放（使用第一个源）
  const handleQuickPlay = () => {
    if (availableSources.length > 0) {
      handlePlay(availableSources[0]);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-red-500/30">
      {/* 沉浸式大画幅横屏背景 */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[#0a0a0a] z-0" />
        {heroBackdrop && (
          <img
            src={getImageUrl(heroBackdrop)}
            alt={title}
            className="absolute top-0 right-0 w-full h-[70vh] lg:h-[85vh] object-cover object-top opacity-35 lg:opacity-40 transition-opacity duration-1000 scale-105 filter brightness-90 contrast-105"
          />
        )}
        {/* 多重电影感渐变蒙层：底部向上渐变融入黑底，左侧向右渐变保证文字高对比可读 */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/85 to-transparent z-10" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent z-10" />
        <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-[#0a0a0a]/90 to-transparent z-10" />
      </div>

      {/* 导航栏 */}
      <nav className="sticky top-0 left-0 right-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-xl border-b border-white/5 shadow-2xl shadow-black/50">
        <div className="max-w-[2000px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={goBack}
              className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors group"
            >
              <ArrowLeft className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
            </button>
            <h1
              className="text-lg sm:text-xl font-bold tracking-tight cursor-pointer flex items-center"
              onClick={goBack}
            >
              <span className="text-red-600">bingoTV</span>
              <span className="text-white ml-1">详情</span>
            </h1>
          </div>
        </div>
      </nav>

      {/* 加载中骨架屏 - 响应式双栏：文字在左，选集在右 */}
      {isLoadingDetail && (
        <main className="relative z-20 max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12 py-5 md:py-8 lg:py-10">
          <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 xl:gap-14 items-start w-full">
            {/* 左侧文字骨架 */}
            <div className="w-full lg:w-5/12 xl:w-5/12 space-y-5 animate-pulse">
              <div className="h-10 lg:h-12 bg-white/10 rounded-xl w-3/4" />
              <div className="flex flex-wrap gap-2">
                <div className="h-7 w-16 bg-yellow-500/10 rounded-lg" />
                <div className="h-7 w-14 bg-white/10 rounded-lg" />
                <div className="h-7 w-20 bg-white/10 rounded-lg" />
                <div className="h-7 w-16 bg-white/10 rounded-lg" />
              </div>
              <div className="flex gap-2">
                <div className="h-6 w-14 bg-red-500/10 rounded-full" />
                <div className="h-6 w-14 bg-red-500/10 rounded-full" />
                <div className="h-6 w-14 bg-red-500/10 rounded-full" />
              </div>
              <div className="bg-white/5 rounded-xl p-4 space-y-2">
                <div className="h-4 bg-white/10 rounded w-1/2" />
                <div className="h-4 bg-white/10 rounded w-3/4" />
              </div>
              <div className="bg-white/5 rounded-xl p-4 space-y-2">
                <div className="h-4 bg-white/10 rounded w-full" />
                <div className="h-4 bg-white/10 rounded w-5/6" />
              </div>
            </div>

            {/* 右侧播放源骨架 */}
            <div className="flex-1 w-full bg-white/5 rounded-2xl md:rounded-3xl p-6 space-y-4 animate-pulse">
              <div className="flex justify-between items-center">
                <div className="h-6 w-20 bg-white/10 rounded" />
                <div className="h-5 w-28 bg-white/5 rounded-full" />
              </div>
              <div className="h-10 w-32 bg-red-500/20 rounded-xl" />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="h-14 bg-white/5 rounded-xl"
                  />
                ))}
              </div>
            </div>
          </div>
        </main>
      )}

      {/* 主内容 - 去掉独立小缩略图，文字在左，选集（播放源）在右 */}
      {!isLoadingDetail && (
        <main className="relative z-20 max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12 py-5 md:py-8 lg:py-10">
          <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 xl:gap-14 items-start w-full">
            
            {/* 左侧：文字详情区 */}
            <div className="w-full lg:w-5/12 xl:w-5/12 shrink-0 animate-fade-in space-y-5 sm:space-y-6">
              <div>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-white mb-3 lg:mb-4 leading-tight tracking-tight drop-shadow-xl">
                  {title}
                </h1>

                {/* 评分和元数据小标签 */}
                <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs sm:text-sm mb-4">
                  {rate && (
                    <div className="flex items-center gap-1 bg-yellow-500/20 text-yellow-400 px-2.5 py-1 rounded-lg border border-yellow-500/20 font-bold backdrop-blur-sm">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      <span>{rate}</span>
                    </div>
                  )}
                  {movieDetail?.release_year && (
                    <div className="px-2.5 py-1 bg-white/10 rounded-lg text-gray-200 border border-white/5 backdrop-blur-sm">
                      {movieDetail.release_year}
                    </div>
                  )}
                  {movieDetail?.duration && (
                    <div className="flex items-center gap-1 px-2.5 py-1 bg-white/10 rounded-lg text-gray-200 border border-white/5 backdrop-blur-sm">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      {movieDetail.duration}
                    </div>
                  )}
                  {movieDetail?.region && (
                    <div className="flex items-center gap-1 px-2.5 py-1 bg-white/10 rounded-lg text-gray-200 border border-white/5 backdrop-blur-sm">
                      <MapPin className="w-3.5 h-3.5 text-gray-400" />
                      {movieDetail.region}
                    </div>
                  )}
                  {movieDetail?.episodes_count && (
                    <div className="px-2.5 py-1 bg-blue-500/20 text-blue-300 rounded-lg border border-blue-500/20 backdrop-blur-sm">
                      {movieDetail.episodes_count}
                    </div>
                  )}
                </div>

                {/* 类型标签 */}
                {movieDetail?.types && movieDetail.types.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {movieDetail.types.map((type, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-0.5 sm:py-1 bg-red-500/20 text-red-300 rounded-full text-xs font-medium border border-red-500/20"
                      >
                        {type}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 导演与演员 */}
              <div className="space-y-2 text-xs sm:text-sm text-gray-300 bg-white/[0.04] p-3.5 sm:p-4 rounded-xl border border-white/5">
                {movieDetail?.directors && movieDetail.directors.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-gray-400 shrink-0 flex items-center gap-1 font-medium">
                      <Clapperboard className="w-3.5 h-3.5 text-gray-400" />
                      导演:
                    </span>
                    <span className="text-gray-200">
                      {movieDetail.directors.join(" / ")}
                    </span>
                  </div>
                )}
                {movieDetail?.actors && movieDetail.actors.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-gray-400 shrink-0 flex items-center gap-1 font-medium">
                      <Users className="w-3.5 h-3.5 text-gray-400" />
                      主演:
                    </span>
                    <span className="text-gray-200 line-clamp-2">
                      {movieDetail.actors.slice(0, 6).join(" / ")}
                    </span>
                  </div>
                )}
              </div>

              {/* 短评卡片 */}
              {movieDetail?.short_comment && (
                <div className="bg-white/[0.04] rounded-xl p-3.5 sm:p-4 border border-white/5 shadow-lg">
                  <p className="text-gray-300 text-xs sm:text-sm italic leading-relaxed">
                    &ldquo;{movieDetail.short_comment.content}&rdquo;
                  </p>
                  <p className="text-gray-500 text-xs mt-2 text-right">
                    ——{" "}
                    {typeof movieDetail.short_comment.author === "string"
                      ? movieDetail.short_comment.author
                      : movieDetail.short_comment.author?.name}
                  </p>
                </div>
              )}

              {/* 剧照预览 */}
              {movieDetail?.photos && movieDetail.photos.length > 0 && (
                <div className="pt-1">
                  <h3 className="text-xs sm:text-sm font-bold text-gray-400 mb-2.5 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
                    剧照
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {movieDetail.photos.slice(0, 3).map((photo) => (
                      <a
                        key={photo.id}
                        href={photo.image}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-video rounded-lg overflow-hidden bg-white/5 hover:opacity-80 transition-opacity border border-white/5"
                      >
                        <img
                          src={getImageUrl(photo.thumb || photo.image)}
                          alt="剧照"
                          className="w-full h-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 右侧：选集与播放源区域 */}
            <div className="flex-1 w-full animate-fade-in delay-100">
              <div className="bg-[#121212]/50 backdrop-blur-2xl rounded-2xl md:rounded-3xl border border-white/10 p-4 sm:p-6 md:p-7 shadow-2xl shadow-black/40">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2.5">
                    <span className="w-1 h-5 bg-red-600 rounded-full" />
                    播放源
                    {searchStatus === "searching" && totalSourceCount > 0 && (
                      <span className="text-xs sm:text-sm font-normal text-gray-400 ml-2 flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        正在搜索... {searchedSourceCount}/{totalSourceCount}
                      </span>
                    )}
                  </h2>

                  {/* 统计信息 */}
                  {availableSources.length > 0 && (
                    <div className="text-xs sm:text-sm text-gray-400 bg-black/30 px-2.5 py-0.5 rounded-full border border-white/5">
                      已找到{" "}
                      <span className="text-white font-bold">
                        {availableSources.length}
                      </span>{" "}
                      个可用源
                    </div>
                  )}
                </div>

                {/* 搜索中且无结果 */}
                {searchStatus === "searching" &&
                  availableSources.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-3">
                      <Loader2 className="w-8 h-8 animate-spin text-red-500" />
                      <span>正在全网搜索资源...</span>
                    </div>
                  )}

                {/* 有结果 */}
                {(searchStatus === "success" ||
                  (searchStatus === "searching" &&
                    availableSources.length > 0)) && (
                  <div className="space-y-4 sm:space-y-5">
                    {/* 快速播放 */}
                    <div>
                      <button
                        onClick={handleQuickPlay}
                        className="inline-flex items-center justify-center gap-2.5 bg-red-600 hover:bg-red-500 text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl sm:rounded-2xl font-semibold sm:font-bold text-sm sm:text-base transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-red-900/25 group"
                      >
                        <div className="w-6 h-6 sm:w-7 sm:h-7 bg-white rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5 fill-red-600 text-red-600 ml-0.5" />
                        </div>
                        <span>立即播放</span>
                      </button>
                    </div>

                    {/* 播放源卡片列表 */}
                    <div>
                      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-2.5 sm:gap-3">
                        {availableSources.map((source, index) => (
                          <button
                            key={`${source.source_key}-${source.vod_id}`}
                            onClick={() => handlePlay(source)}
                            className={`relative p-3.5 rounded-xl text-left transition-all duration-300 group border ${
                              index === 0
                                ? "bg-red-500/10 border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50"
                                : "bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10"
                            }`}
                          >
                            <div className="flex items-start justify-between mb-1.5">
                              <span
                                className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                                  index === 0
                                    ? "bg-red-500/20 text-red-300"
                                    : "bg-white/10 text-gray-400 group-hover:text-white"
                                }`}
                              >
                                {source.source_name}
                              </span>
                              {source.match_confidence === "high" && (
                                <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded-full border border-green-500/20">
                                  精确
                                </span>
                              )}
                            </div>
                            <div className="font-medium text-white text-xs sm:text-sm line-clamp-1 group-hover:text-red-400 transition-colors">
                              {source.vod_name}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
{/* 未找到 */}
                {searchStatus === "not_found" && (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center">
                      <AlertCircle className="w-8 h-8 text-gray-500" />
                    </div>
                    <div className="text-center">
                      <p className="text-white font-medium mb-1">
                        未找到匹配资源
                      </p>
                      <p className="text-sm text-gray-500">{errorMessage}</p>
                    </div>
                    <button
                      onClick={() => searchPlaySources(true)}
                      className="mt-2 px-6 py-2 bg-white/5 hover:bg-white/10 rounded-full text-sm text-gray-300 hover:text-white transition-colors border border-white/5 flex items-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      重新搜索
                    </button>
                  </div>
                )}

                {/* 错误状态 - 提示配置视频源 */}
                {searchStatus === "error" && (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <div className="w-16 h-16 bg-[#E50914]/10 rounded-full flex items-center justify-center">
                      <AlertCircle className="w-8 h-8 text-[#E50914]" />
                    </div>
                    <div className="text-center">
                      <p className="text-white font-medium mb-2">
                        未配置视频源
                      </p>
                      <p className="text-sm text-gray-400 max-w-xs">
                        需要先在后台配置视频源才能搜索播放资源
                      </p>
                    </div>
                    <a
                      href="/admin/settings"
                      className="mt-2 px-6 py-2.5 bg-[#E50914] hover:bg-[#B20710] rounded-full text-sm text-white font-medium transition-colors shadow-lg shadow-[#E50914]/20 flex items-center gap-2"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      前往配置
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 相关推荐 */}
          {movieDetail?.recommendations &&
            movieDetail.recommendations.length > 0 && (
              <div className="mt-12">
                <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                  <Film className="w-6 h-6 text-red-500" />
                  相关推荐
                </h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                  {movieDetail.recommendations.map((rec) => (
                    <Link
                      key={rec.id}
                      href={`/movie/${rec.id}`}
                      className="group"
                    >
                      <div className="aspect-2/3 rounded-xl overflow-hidden bg-white/5 mb-2 border border-white/5 group-hover:border-red-500/50 transition-colors">
                        <img
                          src={getImageUrl(rec.cover)}
                          alt={rec.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                      <h3 className="text-sm text-white font-medium line-clamp-1 group-hover:text-red-400 transition-colors">
                        {rec.title}
                      </h3>
                      {rec.rate && (
                        <div className="flex items-center gap-1 text-xs text-yellow-400 mt-1">
                          <Star className="w-3 h-3 fill-current" />
                          {rec.rate}
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            )}
        </main>
      )}
    </div>
  );
}
