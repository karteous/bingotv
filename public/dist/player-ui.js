// 特斯拉车机自研专用播放器 (Tesla Custom In-Car AVPlayer)
// - 底层全面启用 assets/avplayer-d71a6953.js 核心（基于 Canvas + WebCodecs / WebGPU 解码）
// - 彻底解决特斯拉车机在行车过程中对 <video> 标签的视觉图层强制遮罩屏蔽（解决行车有声无画）
// - 完美修复驻车模式下进度条触控与 BigInt 时间戳精准 Seek（解决驻车无法拖动）

import { o as AVPlayer } from "./assets/avplayer-d71a6953.js";

export class Player {
  constructor(options = {}) {
    this.options = options;
    this.container = options.container;
    this.url = options.url || null;
    this.title = options.title || "";
    this.isLive = Boolean(options.isLive);

    this.avPlayer = null;
    this.videoEl = null; // fallback
    this.isUsingCanvas = false;

    this.duration = 0;
    this.currentTime = 0;
    this.isDraggingProgress = false;
    this.isSeeking = false;
    this.controlsTimer = null;
    this.longPressTimer = null;
    this.isLongPressing = false;
    this.savedPlaybackRate = 1;

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
      .tp-media-stage canvas, .tp-media-stage video { width: 100%; height: 100%; object-fit: contain; }
      
      /* 顶部状态栏 */
      .tp-header { position: absolute; top: 0; left: 0; right: 0; height: 56px; background: linear-gradient(to bottom, rgba(0,0,0,0.85), transparent); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; z-index: 30; transition: opacity 0.3s; }
      .tp-title { color: #fff; font-size: 15px; font-weight: 500; text-shadow: 0 1px 3px rgba(0,0,0,0.8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%; display: flex; align-items: center; gap: 8px; }
      .tp-badge-canvas { font-size: 10px; background: rgba(229,9,20,0.8); color: #fff; padding: 1px 6px; border-radius: 4px; font-weight: 600; letter-spacing: 0.5px; }
      .tp-header-actions { display: flex; align-items: center; gap: 10px; }
      
      /* 底部控制栏 */
      .tp-footer { position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.6) 70%, transparent 100%); padding: 12px 18px 14px; z-index: 30; transition: opacity 0.3s; }
      .tp-hidden { opacity: 0 !important; pointer-events: none !important; }
      
      /* 车机大热区防误触进度条 */
      .tp-progress-wrap { position: relative; width: 100%; height: 32px; display: flex; align-items: center; cursor: pointer; touch-action: none; margin-bottom: 4px; }
      .tp-progress-track { position: relative; width: 100%; height: 6px; background: rgba(255,255,255,0.25); border-radius: 4px; overflow: hidden; }
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
      <!-- 视频/Canvas 渲染视口 -->
      <div class="tp-media-stage" id="tp-stage"></div>
      
      <!-- 居中加载与播放 -->
      <div class="tp-center-loading tp-hidden" id="tp-loading">
        <div class="tp-spinner"></div>
        <div class="tp-loading-text" id="tp-loading-text">正在启动车机硬解引擎...</div>
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
          <span class="tp-badge-canvas" id="tp-engine-tag">Canvas行车优化</span>
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
            <button class="tp-btn" id="tp-rate-btn" style="font-size: 13px; font-weight: 600; width: 40px;">1.0x</button>
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
      // 切换设置后重新载入
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
    if (this.avPlayer) {
      return this.avPlayer.status === 6; // 6 = playing
    }
    if (this.videoEl) {
      return !this.videoEl.paused;
    }
    return false;
  }

  _updateProgressUI(curSec, durSec) {
    this.currentTime = curSec;
    if (durSec > 0) this.duration = durSec;
    const pct = this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
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

    // ==========================================
    // 进度条拖拽与点击（修复驻车模式下无法拖动）
    // ==========================================
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

    // 鼠标按下与拖动
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

    // 触控开始、滑动与松手 (车载触摸屏事件)
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
      e.preventDefault(); // 阻止滚动
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
        this.rateBtn.textContent = rate === 1 ? "1.0x" : rate + "x";
        this.rateMenu.querySelectorAll(".tp-rate-item").forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        this.rateMenu.classList.add("tp-hidden");
        // 调节倍速
        if (this.videoEl) {
          this.videoEl.playbackRate = rate;
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

    // 画面点击
    this.root.addEventListener("click", (e) => {
      if (e.target.closest("#tp-footer") || e.target.closest("#tp-header") || e.target.closest("#tp-modal") || e.target.closest("#tp-center-play")) {
        return;
      }
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
    this.loadingEl.classList.remove("tp-hidden");
    this.loadingTextEl.textContent = "正在启动车机 Canvas 硬解...";
    this.centerPlayEl.classList.add("tp-hidden");

    // 清理旧播放器
    this._destroyInternal();

    const isM3u8 = url.includes(".m3u8") || url.includes("m3u8");

    try {
      // 1. 优先使用 AVPlayer (Canvas 硬件解码，解决行车时黑屏)
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
        isLive: this.isLive,
      });

      this.avPlayer = av;
      this.isUsingCanvas = true;

      // 绑定 AVPlayer 原生事件
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
      });

      av.on("ended", () => {
        this.centerPlayEl.classList.remove("tp-hidden");
        this.playIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`;
        if (typeof this.options.onEnded === "function") {
          this.options.onEnded();
        }
      });

      // 启动加载与播放
      await av.load(url, { ext: isM3u8 ? "m3u8" : undefined });
      await av.play({ audio: true, video: true });
      this.loadingEl.classList.add("tp-hidden");

    } catch (err) {
      console.warn("[Tesla AVPlayer Init Error, falling back to Native]", err);
      // 如果 AVPlayer 加载失败，降级为原生 HTML5 Video 兜底
      this._initNativeFallback(url, isM3u8);
    }

    return this;
  }

  _initNativeFallback(url, isM3u8) {
    this._destroyInternal();
    this.isUsingCanvas = false;
    const tag = this.root.querySelector("#tp-engine-tag");
    if (tag) tag.textContent = "原生兼容模式";

    const v = document.createElement("video");
    v.className = "tp-video";
    v.playsInline = true;
    v.setAttribute("webkit-playsinline", "true");
    v.setAttribute("x5-video-player-type", "h5-page");
    v.autoplay = true;

    this.stageEl.appendChild(v);
    this.videoEl = v;

    v.addEventListener("waiting", () => this.loadingEl.classList.remove("tp-hidden"));
    v.addEventListener("playing", () => {
      this.loadingEl.classList.add("tp-hidden");
      this.centerPlayEl.classList.add("tp-hidden");
      this.playIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
      this._resetControlsTimer();
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

    const HlsClass = window.Hls || null;
    if (isM3u8 && HlsClass && HlsClass.isSupported()) {
      const hls = new HlsClass({ enableWorker: true });
      hls.loadSource(url);
      hls.attachMedia(v);
      this._hls = hls;
    } else {
      v.src = url;
      v.load();
      v.play().catch(() => {});
    }
  }

  seek(targetSeconds) {
    const sec = Math.max(0, Math.min(this.duration || Infinity, targetSeconds));
    if (this.avPlayer) {
      try {
        // 关键修复：AVPlayer 的 seek 必须传递以毫秒为单位的 BigInt！
        const targetMs = BigInt(Math.floor(sec * 1000));
        this.avPlayer.seek(targetMs);
      } catch (e) {
        console.error("[AVPlayer Seek Error]", e);
      }
    } else if (this.videoEl) {
      this.videoEl.currentTime = sec;
    }
    this._updateProgressUI(sec, this.duration);
  }

  play() {
    if (this.avPlayer) {
      return this.avPlayer.play({ audio: true, video: true });
    }
    if (this.videoEl) {
      return this.videoEl.play();
    }
  }

  pause() {
    if (this.avPlayer) {
      this.avPlayer.pause();
    }
    if (this.videoEl) {
      this.videoEl.pause();
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
    if (this.videoEl) {
      try {
        this.videoEl.pause();
        this.videoEl.removeAttribute("src");
        this.videoEl.load();
      } catch {}
      this.videoEl = null;
    }
    this.stageEl.innerHTML = "";
  }

  destroy() {
    clearTimeout(this.controlsTimer);
    clearTimeout(this.longPressTimer);
    clearTimeout(this._tipTimer);
    this._destroyInternal();
    this.container.innerHTML = "";
  }
}
