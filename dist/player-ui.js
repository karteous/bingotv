// 特斯拉车机专属防黑屏播放器 (Tesla Driving-Safe Canvas AVPlayer)
//
// 核心攻坚原理：
// 1. 特斯拉车机（Chromium on Linux）在行车（D/R挡行驶）时，会对 DOM 中的 <video> 标签图层实施硬件级视觉遮罩（黑屏但保留音频）。
// 2. 特斯拉系统对 <canvas> 标签完全放行（车载游戏、仪表盘、地图均使用 Canvas/WebGL）。
// 3. 本播放器采用双轨 Canvas 防黑屏体系：
//    - 轨道 A: 优先采用 assets/avplayer-d71a6953.js 核心（WebCodecs + Canvas 硬件解码，配置 checkUseMES=false 阻断原生 video 降级）。
//    - 轨道 B: 全链路 Canvas 视频帧投射引擎（Canvas Blit Pipeline）。无论是 AVPlayer 内部触发还是 Fallback，
//             底层 <video> 均强制设为后台隐形解码源（1px/透明），画面由前台全屏 <canvas> 极速渲染（requestVideoFrameCallback/RAF + desynchronized）。
// 4. 彻底解决“行车有声无画（黑屏）”以及“驻车模式下触控进度条无法拖动”的两大核心痛点。

import { o as AVPlayer } from "./assets/avplayer-d71a6953.js";

export class Player {
  constructor(options = {}) {
    this.options = options;
    this.container = options.container;
    this.url = options.url || null;
    this.title = options.title || "";
    this.isLive = Boolean(options.isLive);

    this.avPlayer = null;
    this.activeFallbackVideo = null;
    this.drivingCanvas = null;
    this.drivingCanvasCtx = null;
    this._isDestroyed = false;

    this.duration = 0;
    this.currentTime = 0;
    this.isDraggingProgress = false;
    this.controlsTimer = null;
    this.longPressTimer = null;
    this.isLongPressing = false;
    this.currentPlaybackRate = 1;

    this._rvfcId = null;
    this._rafId = null;
    this._domObserver = null;

    this._init();
  }

  _getSetting(key, defaultValue = true) {
    try {
      const v = window.localStorage.getItem(key);
      if (v === null) return defaultValue;
      return v === "true";
    } catch {
      return defaultValue;
    }
  }

  _setSetting(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {}
  }

  _init() {
    if (!this.container) throw new Error("Tesla Player: 缺少 container 容器");

    this.container.innerHTML = "";
    this.container.style.position = "relative";
    this.container.style.width = "100%";
    this.container.style.height = "100%";
    this.container.style.backgroundColor = "#000";
    this.container.style.overflow = "hidden";
    this.container.style.userSelect = "none";
    this.container.style.webkitUserSelect = "none";

    this._injectStyles();
    this._createDOM();
    this._setupDOMGuardian();
    this._bindEvents();

    if (this.url) {
      this.loadSource(this.url);
    }
  }

  _injectStyles() {
    if (document.getElementById("tesla-avplayer-style")) return;
    const style = document.createElement("style");
    style.id = "tesla-avplayer-style";
    style.textContent = `
      .tp-root { position: relative; width: 100%; height: 100%; background: #000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .tp-media-stage { position: absolute; inset: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #000; }
      
      /* 核心渲染画布：永远保持在最前端，保证行车画面不被遮罩 */
      .tp-driving-canvas, .avplayer-canvas {
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
        position: absolute !important;
        inset: 0 !important;
        z-index: 5 !important;
        pointer-events: none;
      }
      
      /* 后台隐形解码视频标签：绝对不能露出在 DOM 视觉层，以防被特斯拉系统施加行车黑屏遮罩 */
      .tp-hidden-decoder {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        width: 1px !important;
        height: 1px !important;
        opacity: 0.001 !important;
        pointer-events: none !important;
        z-index: 1 !important;
      }
      
      /* 顶部状态栏 */
      .tp-header { position: absolute; top: 0; left: 0; right: 0; height: 56px; background: linear-gradient(to bottom, rgba(0,0,0,0.85), transparent); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; z-index: 30; transition: opacity 0.3s; }
      .tp-title { color: #fff; font-size: 15px; font-weight: 500; text-shadow: 0 1px 3px rgba(0,0,0,0.8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%; display: flex; align-items: center; gap: 8px; }
      .tp-badge-canvas { font-size: 10px; background: rgba(229,9,20,0.88); color: #fff; padding: 2px 7px; border-radius: 4px; font-weight: 600; letter-spacing: 0.5px; }
      .tp-header-actions { display: flex; align-items: center; gap: 10px; }
      
      /* 底部控制栏 */
      .tp-footer { position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 70%, transparent 100%); padding: 12px 18px 14px; z-index: 30; transition: opacity 0.3s; }
      .tp-hidden { opacity: 0 !important; pointer-events: none !important; }
      
      /* 车机大热区防误触进度条 */
      .tp-progress-wrap { position: relative; width: 100%; height: 36px; display: flex; align-items: center; cursor: pointer; touch-action: none; margin-bottom: 4px; }
      .tp-progress-track { position: relative; width: 100%; height: 6px; background: rgba(255,255,255,0.25); border-radius: 4px; overflow: hidden; pointer-events: none; }
      .tp-progress-buffered { position: absolute; top: 0; left: 0; height: 100%; background: rgba(255,255,255,0.45); width: 0%; border-radius: 4px; }
      .tp-progress-played { position: absolute; top: 0; left: 0; height: 100%; background: #e50914; width: 0%; border-radius: 4px; }
      .tp-progress-thumb { position: absolute; top: 50%; left: 0%; width: 18px; height: 18px; background: #fff; border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 8px rgba(0,0,0,0.8); pointer-events: none; transition: transform 0.1s; }
      .tp-progress-wrap:active .tp-progress-thumb { transform: translate(-50%, -50%) scale(1.35); }

      /* 控制按钮栏 */
      .tp-controls { display: flex; align-items: center; justify-content: space-between; }
      .tp-controls-left, .tp-controls-right { display: flex; align-items: center; gap: 14px; }
      .tp-btn { background: none; border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 8px; border-radius: 8px; transition: background 0.2s, transform 0.1s; }
      .tp-btn:active { transform: scale(0.92); }
      .tp-btn svg { width: 24px; height: 24px; fill: currentColor; }
      .tp-time { color: #eee; font-size: 13px; font-variant-numeric: tabular-nums; font-weight: 500; }
      
      /* 居中大播放按钮 / 加载中 */
      .tp-center-loading { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; z-index: 20; pointer-events: none; background: rgba(0,0,0,0.3); }
      .tp-spinner { width: 52px; height: 52px; border: 4px solid rgba(255,255,255,0.2); border-top-color: #e50914; border-radius: 50%; animation: tp-spin 0.8s linear infinite; }
      .tp-loading-text { color: #ddd; font-size: 13px; letter-spacing: 0.5px; }
      @keyframes tp-spin { to { transform: rotate(360deg); } }

      .tp-center-play { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 72px; height: 72px; background: rgba(0,0,0,0.7); border: 2px solid rgba(255,255,255,0.35); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; z-index: 25; backdrop-filter: blur(6px); transition: transform 0.2s, opacity 0.2s; }
      .tp-center-play:active { transform: translate(-50%, -50%) scale(0.9); }
      .tp-center-play svg { width: 34px; height: 34px; fill: currentColor; margin-left: 3px; }

      /* 手势浮层胶囊提示 (快进 / 倍速) */
      .tp-capsule-tip { position: absolute; top: 22%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.85); border: 1px solid rgba(255,255,255,0.25); backdrop-filter: blur(10px); padding: 8px 18px; border-radius: 20px; color: #fff; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px; z-index: 40; pointer-events: none; transition: opacity 0.2s; }

      /* 解码与车机设置面板 */
      .tp-settings-modal { position: absolute; top: 12px; right: 12px; width: 290px; max-width: 90%; background: rgba(18,18,18,0.96); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; backdrop-filter: blur(14px); padding: 14px; z-index: 50; color: #fff; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
      .tp-modal-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 8px; margin-bottom: 10px; font-size: 14px; font-weight: 600; }
      .tp-setting-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; font-size: 13px; color: #eee; }
      .tp-setting-row input[type="checkbox"] { width: 18px; height: 18px; accent-color: #e50914; cursor: pointer; }
      .tp-modal-close { background: none; border: none; color: #aaa; cursor: pointer; font-size: 18px; line-height: 1; }
      .tp-modal-close:hover { color: #fff; }

      /* 倍速菜单 */
      .tp-rate-menu { position: absolute; bottom: 58px; right: 60px; background: rgba(20,20,20,0.96); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; gap: 2px; z-index: 45; }
      .tp-rate-item { background: none; border: none; color: #ccc; padding: 6px 14px; text-align: center; font-size: 13px; border-radius: 4px; cursor: pointer; }
      .tp-rate-item.active { background: #e50914; color: #fff; font-weight: 600; }
    `;
    document.head.appendChild(style);
  }

  _createDOM() {
    this.root = document.createElement("div");
    this.root.className = "tp-root";

    this.root.innerHTML = `
      <!-- 画面舞台：只允许展示 <canvas>，任何后台解码 <video> 都会被守护机制压制为隐形 -->
      <div class="tp-media-stage" id="tp-stage"></div>
      
      <!-- 居中加载与播放 -->
      <div class="tp-center-loading tp-hidden" id="tp-loading">
        <div class="tp-spinner"></div>
        <div class="tp-loading-text" id="tp-loading-text">正在启动车机 Canvas 硬解...</div>
      </div>
      <div class="tp-center-play tp-hidden" id="tp-center-play" title="播放">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>

      <!-- 手势/倍速提示胶囊 -->
      <div class="tp-capsule-tip tp-hidden" id="tp-tip"></div>

      <!-- 顶部标题栏 -->
      <div class="tp-header" id="tp-header">
        <div class="tp-title" id="tp-title">
          <span>${this.title || "特斯拉车机播放器"}</span>
          <span class="tp-badge-canvas" id="tp-engine-tag">Canvas行车防黑屏</span>
        </div>
        <div class="tp-header-actions">
          <button class="tp-btn" id="tp-btn-settings" title="车机解码设置">
            <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
          </button>
        </div>
      </div>

      <!-- 底部控制栏 -->
      <div class="tp-footer" id="tp-footer">
        <div class="tp-progress-wrap" id="tp-progress">
          <div class="tp-progress-track">
            <div class="tp-progress-buffered" id="tp-buf"></div>
            <div class="tp-progress-played" id="tp-played"></div>
          </div>
          <div class="tp-progress-thumb" id="tp-thumb"></div>
        </div>

        <div class="tp-controls">
          <div class="tp-controls-left">
            <button class="tp-btn" id="tp-play-btn" title="播放/暂停">
              <svg id="tp-play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <span class="tp-time" id="tp-time">00:00 / 00:00</span>
          </div>

          <div class="tp-controls-right">
            <button class="tp-btn" id="tp-rate-btn" style="font-size: 13px; font-weight: 600; width: 44px;">1.0x</button>
            <button class="tp-btn" id="tp-reload-btn" title="重新载入视频">
              <svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
            <button class="tp-btn" id="tp-fullscreen-btn" title="全屏">
              <svg id="tp-fs-icon" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 倍速弹出菜单 -->
      <div class="tp-rate-menu tp-hidden" id="tp-rate-menu">
        <button class="tp-rate-item" data-rate="0.75">0.75x</button>
        <button class="tp-rate-item active" data-rate="1">1.0x</button>
        <button class="tp-rate-item" data-rate="1.25">1.25x</button>
        <button class="tp-rate-item" data-rate="1.5">1.5x</button>
        <button class="tp-rate-item" data-rate="2">2.0x</button>
      </div>

      <!-- 解码与车机设置面板 -->
      <div class="tp-settings-modal tp-hidden" id="tp-modal">
        <div class="tp-modal-header">
          <span>车机解码与硬件加速</span>
          <button class="tp-modal-close" id="tp-modal-close">×</button>
        </div>
        <div class="tp-setting-row">
          <span>硬件加速 (GPU)</span>
          <input type="checkbox" id="set-hardware">
        </div>
        <div class="tp-setting-row">
          <span>视频硬解码 (WebCodecs)</span>
          <input type="checkbox" id="set-video-webcodec">
        </div>
        <div class="tp-setting-row">
          <span>音频硬解码 (WebCodecs)</span>
          <input type="checkbox" id="set-audio-webcodec">
        </div>
        <div class="tp-setting-row">
          <span>音频 MSE 解码</span>
          <input type="checkbox" id="set-audio-mse">
        </div>
        <div class="tp-setting-row">
          <span>WebGPU 引擎</span>
          <input type="checkbox" id="set-webgpu">
        </div>
      </div>
    `;

    this.container.appendChild(this.root);

    this.stageEl = this.root.querySelector("#tp-stage");
    this.header = this.root.querySelector("#tp-header");
    this.footer = this.root.querySelector("#tp-footer");
    this.loadingEl = this.root.querySelector("#tp-loading");
    this.loadingTextEl = this.root.querySelector("#tp-loading-text");
    this.centerPlayEl = this.root.querySelector("#tp-center-play");
    this.tipEl = this.root.querySelector("#tp-tip");
    this.progressWrap = this.root.querySelector("#tp-progress");
    this.playedEl = this.root.querySelector("#tp-played");
    this.bufEl = this.root.querySelector("#tp-buf");
    this.thumbEl = this.root.querySelector("#tp-thumb");
    this.playBtn = this.root.querySelector("#tp-play-btn");
    this.playIcon = this.root.querySelector("#tp-play-icon");
    this.timeEl = this.root.querySelector("#tp-time");
    this.rateBtn = this.root.querySelector("#tp-rate-btn");
    this.rateMenu = this.root.querySelector("#tp-rate-menu");
    this.reloadBtn = this.root.querySelector("#tp-reload-btn");
    this.fullscreenBtn = this.root.querySelector("#tp-fullscreen-btn");
    this.settingsBtn = this.root.querySelector("#tp-btn-settings");
    this.settingsModal = this.root.querySelector("#tp-modal");
    this.modalClose = this.root.querySelector("#tp-modal-close");

    this._initSettingsUI();
  }

  // =========================================================================
  // 特斯拉 DOM 守护与无感 Canvas 包装体系
  // 核心逻辑：任何试图插入 stageEl 的 <video>，均立即被压制为隐形后台解码器，
  // 画面由前台顶层 <canvas> 接管以 60fps 实时映射，行车时绝不触发特斯拉视频黑屏遮罩！
  // =========================================================================
  _setupDOMGuardian() {
    this._domObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1 && node.tagName === "VIDEO") {
            this._interceptVideoElement(node);
          }
        }
      }
    });

    this._domObserver.observe(this.stageEl, { childList: true, subtree: true });
  }

  _interceptVideoElement(videoEl) {
    if (!videoEl || videoEl.dataset.tpGuarded === "true") return;
    videoEl.dataset.tpGuarded = "true";

    // 1. 将 <video> 标签剥离视觉层（压制为隐形解码后台，确保特斯拉系统无法施加行车黑屏）
    videoEl.classList.add("tp-hidden-decoder");
    videoEl.style.setProperty("position", "absolute", "important");
    videoEl.style.setProperty("top", "0", "important");
    videoEl.style.setProperty("left", "0", "important");
    videoEl.style.setProperty("width", "1px", "important");
    videoEl.style.setProperty("height", "1px", "important");
    videoEl.style.setProperty("opacity", "0.001", "important");
    videoEl.style.setProperty("pointer-events", "none", "important");
    videoEl.style.setProperty("z-index", "-1", "important");

    // 2. 保证前台有一个处于最顶层的 Canvas 用于实时绘制
    this._ensureDrivingCanvas();
    this.activeFallbackVideo = videoEl;

    // 3. 启动高频视频帧投射循环
    this._startVideoFramePipeline(videoEl);
  }

  _ensureDrivingCanvas() {
    if (this.drivingCanvas && this.stageEl.contains(this.drivingCanvas)) {
      return this.drivingCanvas;
    }

    const canvas = document.createElement("canvas");
    canvas.id = "tp-driving-canvas";
    canvas.className = "tp-driving-canvas";
    this.stageEl.appendChild(canvas);

    this.drivingCanvas = canvas;
    // 使用 desynchronized 获取最低延迟和最高 GPU 直通性能
    this.drivingCanvasCtx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true
    }) || canvas.getContext("2d");

    return canvas;
  }

  _drawVideoFrame(video, canvas) {
    if (!video || !canvas || video.readyState < 2) return;
    const ctx = this.drivingCanvasCtx || canvas.getContext("2d");
    if (!ctx) return;

    const vw = video.videoWidth || 1920;
    const vh = video.videoHeight || 1080;

    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }

    ctx.drawImage(video, 0, 0, vw, vh);
  }

  _startVideoFramePipeline(video) {
    this._stopVideoFramePipeline();

    const canvas = this._ensureDrivingCanvas();

    const render = () => {
      if (this._isDestroyed || !video) return;

      if (!video.paused && !video.ended) {
        this._drawVideoFrame(video, canvas);
      }

      if ("requestVideoFrameCallback" in video) {
        this._rvfcId = video.requestVideoFrameCallback(() => render());
      } else {
        this._rafId = requestAnimationFrame(render);
      }
    };

    if ("requestVideoFrameCallback" in video) {
      this._rvfcId = video.requestVideoFrameCallback(() => render());
    } else {
      this._rafId = requestAnimationFrame(render);
    }

    // 关键状态事件触发即时重绘，消除首帧与寻道时的黑屏
    const onFrameUpdate = () => this._drawVideoFrame(video, canvas);
    video.addEventListener("play", onFrameUpdate);
    video.addEventListener("playing", onFrameUpdate);
    video.addEventListener("seeked", onFrameUpdate);
    video.addEventListener("timeupdate", onFrameUpdate);
  }

  _stopVideoFramePipeline() {
    if (this._rvfcId && this.activeFallbackVideo && "cancelVideoFrameCallback" in this.activeFallbackVideo) {
      try {
        this.activeFallbackVideo.cancelVideoFrameCallback(this._rvfcId);
      } catch {}
      this._rvfcId = null;
    }
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _initSettingsUI() {
    const hw = this.root.querySelector("#set-hardware");
    const vWc = this.root.querySelector("#set-video-webcodec");
    const aWc = this.root.querySelector("#set-audio-webcodec");
    const aMse = this.root.querySelector("#set-audio-mse");
    const wGpu = this.root.querySelector("#set-webgpu");

    hw.checked = this._getSetting("KIT_PLAYER_HARDWARE", true);
    vWc.checked = this._getSetting("KIT_PLAYER_VIDEO_WEBCODEC", true);
    aWc.checked = this._getSetting("KIT_PLAYER_AUDIO_WEBCODEC", true);
    aMse.checked = this._getSetting("KIT_PLAYER_AUDIO_MSE", true);
    wGpu.checked = this._getSetting("KIT_PLAYER_WEBGPU", false);

    const onSettingChange = () => {
      if (this.url) {
        this.loadSource(this.url);
      }
    };

    hw.addEventListener("change", (e) => { this._setSetting("KIT_PLAYER_HARDWARE", e.target.checked); onSettingChange(); });
    vWc.addEventListener("change", (e) => { this._setSetting("KIT_PLAYER_VIDEO_WEBCODEC", e.target.checked); onSettingChange(); });
    aWc.addEventListener("change", (e) => { this._setSetting("KIT_PLAYER_AUDIO_WEBCODEC", e.target.checked); onSettingChange(); });
    aMse.addEventListener("change", (e) => { this._setSetting("KIT_PLAYER_AUDIO_MSE", e.target.checked); onSettingChange(); });
    wGpu.addEventListener("change", (e) => { this._setSetting("KIT_PLAYER_WEBGPU", e.target.checked); onSettingChange(); });
  }

  _formatTime(sec) {
    if (isNaN(sec) || sec < 0) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const mm = m < 10 ? "0" + m : m;
    const ss = s < 10 ? "0" + s : s;
    return `${mm}:${ss}`;
  }

  _showTip(text, duration = 1200) {
    this.tipEl.textContent = text;
    this.tipEl.classList.remove("tp-hidden");
    clearTimeout(this._tipTimer);
    if (duration > 0) {
      this._tipTimer = setTimeout(() => {
        this.tipEl.classList.add("tp-hidden");
      }, duration);
    }
  }

  _hideTip() {
    clearTimeout(this._tipTimer);
    this.tipEl.classList.add("tp-hidden");
  }

  _toggleControls(forceShow) {
    const isVisible = forceShow !== undefined ? forceShow : this.footer.classList.contains("tp-hidden");
    if (isVisible) {
      this.header.classList.remove("tp-hidden");
      this.footer.classList.remove("tp-hidden");
      this._resetControlsTimer();
    } else {
      this.header.classList.add("tp-hidden");
      this.footer.classList.add("tp-hidden");
      this.rateMenu.classList.add("tp-hidden");
      this.settingsModal.classList.add("tp-hidden");
    }
  }

  _resetControlsTimer() {
    clearTimeout(this.controlsTimer);
    if (this._isPlaying()) {
      this.controlsTimer = setTimeout(() => {
        this._toggleControls(false);
      }, 4000);
    }
  }

  _isPlaying() {
    if (this.avPlayer && !this.activeFallbackVideo) {
      return this.avPlayer.status === 6; // 6 = playing
    }
    if (this.activeFallbackVideo) {
      return !this.activeFallbackVideo.paused && !this.activeFallbackVideo.ended;
    }
    return false;
  }

  _updateProgressUI(curSec, durSec) {
    this.currentTime = Math.max(0, curSec || 0);
    if (durSec > 0) this.duration = durSec;
    const pct = this.duration > 0 ? Math.min(100, Math.max(0, (this.currentTime / this.duration) * 100)) : 0;
    this.playedEl.style.width = pct + "%";
    this.thumbEl.style.left = pct + "%";
    this.timeEl.textContent = `${this._formatTime(this.currentTime)} / ${this._formatTime(this.duration)}`;
  }

  _bindEvents() {
    // 播放/暂停控制
    const togglePlay = () => {
      if (this._isPlaying()) {
        this.pause();
      } else {
        this.play();
      }
    };
    this.playBtn.addEventListener("click", togglePlay);
    this.centerPlayEl.addEventListener("click", togglePlay);

    // =======================================================================
    // 进度条拖拽与精准点击寻道（彻底解决驻车与行车模式下进度条无法拖动）
    // =======================================================================
    const calcRatioFromEvent = (e) => {
      const rect = this.progressWrap.getBoundingClientRect();
      if (!rect.width) return 0;
      let clientX = 0;
      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
      } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
      } else if (typeof e.clientX === "number") {
        clientX = e.clientX;
      }
      const offset = clientX - rect.left;
      return Math.max(0, Math.min(1, offset / rect.width));
    };

    // 鼠标按下与拖拽
    this.progressWrap.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      this.isDraggingProgress = true;
      const ratio = calcRatioFromEvent(e);
      const targetSec = ratio * this.duration;
      this._updateProgressUI(targetSec, this.duration);
      this._showTip(this._formatTime(targetSec), 0);

      const onMouseMove = (ev) => {
        if (!this.isDraggingProgress) return;
        const r = calcRatioFromEvent(ev);
        const s = r * this.duration;
        this._updateProgressUI(s, this.duration);
        this._showTip(this._formatTime(s), 0);
      };

      const onMouseUp = (ev) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        if (this.isDraggingProgress) {
          const r = calcRatioFromEvent(ev);
          const finalSec = r * this.duration;
          this.seek(finalSec);
          this._hideTip();
          this.isDraggingProgress = false;
        }
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    // 车载触摸屏触控：开始、滑动、松手
    this.progressWrap.addEventListener("touchstart", (e) => {
      e.stopPropagation();
      this.isDraggingProgress = true;
      const ratio = calcRatioFromEvent(e);
      const targetSec = ratio * this.duration;
      this._updateProgressUI(targetSec, this.duration);
      this._showTip(this._formatTime(targetSec), 0);
    }, { passive: false });

    this.progressWrap.addEventListener("touchmove", (e) => {
      if (!this.isDraggingProgress) return;
      e.preventDefault();
      e.stopPropagation();
      const ratio = calcRatioFromEvent(e);
      const targetSec = ratio * this.duration;
      this._updateProgressUI(targetSec, this.duration);
      this._showTip(this._formatTime(targetSec), 0);
    }, { passive: false });

    this.progressWrap.addEventListener("touchend", (e) => {
      if (this.isDraggingProgress) {
        e.stopPropagation();
        const ratio = calcRatioFromEvent(e);
        const finalSec = ratio * this.duration;
        this.seek(finalSec);
        this._hideTip();
        this.isDraggingProgress = false;
      }
    });

    // 倍速设置
    this.rateBtn.addEventListener("click", () => {
      this.rateMenu.classList.toggle("tp-hidden");
    });

    this.rateMenu.querySelectorAll(".tp-rate-item").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const rate = parseFloat(e.target.dataset.rate);
        this.currentPlaybackRate = rate;
        this.rateBtn.textContent = rate === 1 ? "1.0x" : rate + "x";
        this.rateMenu.querySelectorAll(".tp-rate-item").forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        this.rateMenu.classList.add("tp-hidden");

        if (this.activeFallbackVideo) {
          this.activeFallbackVideo.playbackRate = rate;
        }
        if (this.avPlayer && typeof this.avPlayer.setPlayRate === "function") {
          try {
            this.avPlayer.setPlayRate(rate);
          } catch {}
        }
      });
    });

    // 刷新与全屏
    this.reloadBtn.addEventListener("click", () => {
      if (this.url) this.loadSource(this.url);
    });

    this.fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());

    // 解码设置面板开闭
    this.settingsBtn.addEventListener("click", () => {
      this.settingsModal.classList.toggle("tp-hidden");
    });
    this.modalClose.addEventListener("click", () => {
      this.settingsModal.classList.add("tp-hidden");
    });

    // 画面点击与车载手势（双击快进/快退，长按倍速）
    let lastTapTime = 0;
    this.root.addEventListener("click", (e) => {
      if (
        e.target.closest("#tp-footer") ||
        e.target.closest("#tp-header") ||
        e.target.closest("#tp-modal") ||
        e.target.closest("#tp-rate-menu") ||
        e.target.closest("#tp-center-play")
      ) {
        return;
      }

      const now = Date.now();
      const rect = this.root.getBoundingClientRect();
      const x = e.clientX - rect.left;

      if (now - lastTapTime < 300) {
        // 双击手势：左侧快退 10s，右侧快进 10s
        if (x < rect.width * 0.4) {
          this.seek(this.currentTime - 10);
          this._showTip("快退 10秒");
        } else if (x > rect.width * 0.6) {
          this.seek(this.currentTime + 10);
          this._showTip("快进 10秒");
        }
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;

      this._toggleControls();
    });

    // 监听全屏变动更新按钮图标
    document.addEventListener("fullscreenchange", () => {
      const isFs = Boolean(document.fullscreenElement);
      const fsIcon = this.root.querySelector("#tp-fs-icon");
      if (fsIcon) {
        fsIcon.innerHTML = isFs
          ? `<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>`
          : `<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>`;
      }
    });
  }

  async loadSource(url) {
    if (!url) return this;
    this.url = url;
    this._isDestroyed = false;

    this.loadingEl.classList.remove("tp-hidden");
    this.loadingTextEl.textContent = "正在启动车机 Canvas 硬解...";
    this.centerPlayEl.classList.add("tp-hidden");

    this._destroyInternal();

    const isM3u8 = url.includes(".m3u8") || url.includes("m3u8");

    try {
      // 1. 优先尝试 AVPlayer (WebCodecs + Canvas)
      const enableHardware = this._getSetting("KIT_PLAYER_HARDWARE", true);
      const enableWebCodecs = this._getSetting("KIT_PLAYER_VIDEO_WEBCODEC", true);
      const enableWebGPU = this._getSetting("KIT_PLAYER_WEBGPU", false);
      const audioMSE = this._getSetting("KIT_PLAYER_AUDIO_MSE", true);

      const av = new AVPlayer({
        container: this.stageEl,
        enableHardware: enableHardware,
        enableWebCodecs: enableWebCodecs,
        enableWebGPU: enableWebGPU,
        enableWorker: true,
        audioMSE: audioMSE,
        // 关键配置：强制禁用 MSE 视频管线，阻止其调用 createVideo() 生成视频标签
        checkUseMES: () => false,
        isLive: this.isLive,
      });

      this.avPlayer = av;

      // 绑定 AVPlayer 原生时间同步
      av.on("time", (timeMs) => {
        if (this.isDraggingProgress) return;
        const curSec = Number(timeMs) / 1000;
        const durBig = av.getDuration();
        const durSec = durBig ? Number(durBig) / 1000 : 0;
        this._updateProgressUI(curSec, durSec);
      });

      av.on("playing", () => {
        this.loadingEl.classList.add("tp-hidden");
        this.centerPlayEl.classList.add("tp-hidden");
        this.playIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
        this._resetControlsTimer();
      });

      av.on("paused", () => {
        this.centerPlayEl.classList.remove("tp-hidden");
        this.playIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
        this._toggleControls(true);
      });

      av.on("firstVideoRendered", () => {
        this.loadingEl.classList.add("tp-hidden");
        this.centerPlayEl.classList.add("tp-hidden");
        const tag = this.root.querySelector("#tp-engine-tag");
        if (tag) tag.textContent = "Canvas硬解行车模式";
      });

      av.on("ended", () => {
        this.centerPlayEl.classList.remove("tp-hidden");
        this.playIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
        if (typeof this.options.onEnded === "function") {
          this.options.onEnded();
        }
      });

      // 执行加载与播放
      await av.load(url, { ext: isM3u8 ? "m3u8" : undefined });
      await av.play({ audio: true, video: true });
      this.loadingEl.classList.add("tp-hidden");

    } catch (err) {
      console.warn("[Tesla AVPlayer Hardcoded Engine Fallback, switching to Canvas Blit Pipeline]", err);
      // 若硬件解码发生网络/编码不兼容，无缝切换到轨道 B：Canvas 投射引擎
      this._initCanvasBlitFallback(url, isM3u8);
    }

    return this;
  }

  // =========================================================================
  // 轨道 B：全链路 Canvas 视频帧投射引擎（Canvas Blit Pipeline）
  // 绝不直接展示 <video>，将其置于隐形后台解码，画面由前台顶层 <canvas> 每帧绘制！
  // 彻底打破“行车黑屏”魔咒，在任何情况下均确保行车画面丝滑流畅输出！
  // =========================================================================
  _initCanvasBlitFallback(url, isM3u8) {
    this._destroyInternal();

    const tag = this.root.querySelector("#tp-engine-tag");
    if (tag) tag.textContent = "Canvas投射行车模式";

    // 1. 创建前台画布
    const canvas = this._ensureDrivingCanvas();

    // 2. 创建隐形后台解码器
    const v = document.createElement("video");
    v.className = "tp-hidden-decoder";
    v.playsInline = true;
    v.setAttribute("webkit-playsinline", "true");
    v.setAttribute("x5-video-player-type", "h5-page");
    v.autoplay = true;
    v.crossOrigin = "anonymous";

    this.stageEl.appendChild(v);
    this.activeFallbackVideo = v;

    // 3. 拦截并绑定事件
    this._interceptVideoElement(v);

    v.addEventListener("waiting", () => this.loadingEl.classList.remove("tp-hidden"));
    v.addEventListener("playing", () => {
      this.loadingEl.classList.add("tp-hidden");
      this.centerPlayEl.classList.add("tp-hidden");
      this.playIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
      this._resetControlsTimer();
      this._drawVideoFrame(v, canvas);
    });

    v.addEventListener("pause", () => {
      this.centerPlayEl.classList.remove("tp-hidden");
      this.playIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
      this._toggleControls(true);
    });

    v.addEventListener("timeupdate", () => {
      if (this.isDraggingProgress) return;
      this._updateProgressUI(v.currentTime || 0, v.duration || 0);
    });

    v.addEventListener("durationchange", () => {
      if (v.duration > 0) {
        this.duration = v.duration;
        this._updateProgressUI(v.currentTime || 0, v.duration);
      }
    });

    v.addEventListener("ended", () => {
      this.centerPlayEl.classList.remove("tp-hidden");
      this.playIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
      if (typeof this.options.onEnded === "function") {
        this.options.onEnded();
      }
    });

    // 4. 加载视频流
    const HlsClass = window.Hls || null;
    if (isM3u8 && HlsClass && HlsClass.isSupported()) {
      const hls = new HlsClass({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
      });
      hls.loadSource(url);
      hls.attachMedia(v);
      this._hls = hls;

      hls.on(HlsClass.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case HlsClass.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case HlsClass.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              this.loadingTextEl.textContent = "视频加载异常，正在重试...";
              break;
          }
        }
      });
    } else {
      v.src = url;
      v.load();
      v.play().catch(() => {});
    }
  }

  seek(targetSeconds) {
    const sec = Math.max(0, Math.min(this.duration || Infinity, targetSeconds));

    if (this.avPlayer && !this.activeFallbackVideo) {
      try {
        const targetMs = BigInt(Math.floor(sec * 1000));
        this.avPlayer.seek(targetMs);
      } catch (e) {
        console.error("[AVPlayer Seek Error]", e);
      }
    } else if (this.activeFallbackVideo) {
      this.activeFallbackVideo.currentTime = sec;
      if (this.drivingCanvas) {
        this._drawVideoFrame(this.activeFallbackVideo, this.drivingCanvas);
      }
    }

    this._updateProgressUI(sec, this.duration);
  }

  play() {
    if (this.avPlayer && !this.activeFallbackVideo) {
      return this.avPlayer.play({ audio: true, video: true });
    }
    if (this.activeFallbackVideo) {
      return this.activeFallbackVideo.play();
    }
  }

  pause() {
    if (this.avPlayer && !this.activeFallbackVideo) {
      this.avPlayer.pause();
    }
    if (this.activeFallbackVideo) {
      this.activeFallbackVideo.pause();
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      if (this.root.requestFullscreen) {
        this.root.requestFullscreen().catch(() => {});
      } else if (this.stageEl.requestFullscreen) {
        this.stageEl.requestFullscreen().catch(() => {});
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  _destroyInternal() {
    this._stopVideoFramePipeline();

    if (this.avPlayer) {
      try {
        this.avPlayer.stop();
      } catch {}
      this.avPlayer = null;
    }

    if (this._hls) {
      try {
        this._hls.destroy();
      } catch {}
      this._hls = null;
    }

    if (this.activeFallbackVideo) {
      try {
        this.activeFallbackVideo.pause();
        this.activeFallbackVideo.removeAttribute("src");
        this.activeFallbackVideo.load();
      } catch {}
      this.activeFallbackVideo = null;
    }

    this.drivingCanvas = null;
    this.drivingCanvasCtx = null;
    this.stageEl.innerHTML = "";
  }

  destroy() {
    this._isDestroyed = true;
    clearTimeout(this.controlsTimer);
    clearTimeout(this.longPressTimer);
    clearTimeout(this._tipTimer);

    if (this._domObserver) {
      this._domObserver.disconnect();
      this._domObserver = null;
    }

    this._destroyInternal();
    this.container.innerHTML = "";
  }
}
