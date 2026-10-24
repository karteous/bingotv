// 自研车机专用 HTML5 / HLS 播放器 (Tesla Custom In-Car Player)
// - 纯原生实现，不依赖 ArtPlayer
// - 针对特斯拉等车载大屏触控优化：大热区进度条、手势快进/快退、长按2倍速、硬解设置
// - 支持 HLS (.m3u8) 与标准 MP4 视频

export class Player {
  constructor(options = {}) {
    this.options = options;
    this.container = options.container;
    this.url = options.url || null;
    this.title = options.title || "";
    this.isLive = Boolean(options.isLive);

    this.video = null;
    this.hls = null;
    this.controlsTimer = null;
    this.longPressTimer = null;
    this.isLongPressing = false;
    this.savedPlaybackRate = 1;
    this.isDraggingProgress = false;
    this.touchStartX = 0;
    this.touchStartTime = 0;
    this.isSwiping = false;

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
    if (document.getElementById("tesla-player-style")) return;
    const style = document.createElement("style");
    style.id = "tesla-player-style";
    style.textContent = `
      .tp-root { position: relative; width: 100%; height: 100%; background: #000; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .tp-video { width: 100%; height: 100%; object-fit: contain; background: #000; }
      .tp-layer { position: absolute; inset: 0; pointer-events: none; }
      .tp-interactive { pointer-events: auto; }
      
      /* 顶部状态栏 */
      .tp-header { position: absolute; top: 0; left: 0; right: 0; height: 56px; background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; z-index: 30; transition: opacity 0.3s; }
      .tp-title { color: #fff; font-size: 15px; font-weight: 500; text-shadow: 0 1px 3px rgba(0,0,0,0.8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%; }
      .tp-header-actions { display: flex; align-items: center; gap: 10px; }
      
      /* 底部控制栏 */
      .tp-footer { position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 70%, transparent 100%); padding: 12px 16px 14px; z-index: 30; transition: opacity 0.3s, transform 0.3s; }
      .tp-hidden { opacity: 0 !important; pointer-events: none !important; }
      
      /* 车机大热区进度条 */
      .tp-progress-wrap { position: relative; width: 100%; height: 26px; display: flex; align-items: center; cursor: pointer; touch-action: none; margin-bottom: 6px; }
      .tp-progress-track { position: relative; width: 100%; height: 6px; background: rgba(255,255,255,0.25); border-radius: 4px; overflow: hidden; }
      .tp-progress-buffered { position: absolute; top: 0; left: 0; height: 100%; background: rgba(255,255,255,0.4); width: 0%; border-radius: 4px; }
      .tp-progress-played { position: absolute; top: 0; left: 0; height: 100%; background: #e50914; width: 0%; border-radius: 4px; }
      .tp-progress-thumb { position: absolute; top: 50%; left: 0%; width: 16px; height: 16px; background: #fff; border-radius: 50%; transform: translate(-50%, -50%); box-shadow: 0 0 6px rgba(0,0,0,0.6); pointer-events: none; transition: transform 0.1s; }
      .tp-progress-wrap:active .tp-progress-thumb { transform: translate(-50%, -50%) scale(1.3); }

      /* 控制按钮栏 */
      .tp-controls { display: flex; align-items: center; justify-content: space-between; }
      .tp-controls-left, .tp-controls-right { display: flex; align-items: center; gap: 14px; }
      .tp-btn { background: none; border: none; color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 6px; border-radius: 6px; transition: background 0.2s, transform 0.1s; }
      .tp-btn:active { transform: scale(0.92); }
      .tp-btn svg { width: 22px; height: 22px; fill: currentColor; }
      .tp-time { color: #ddd; font-size: 13px; font-variant-numeric: tabular-nums; }
      
      /* 居中大播放按钮 / 加载中 */
      .tp-center-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 20; pointer-events: none; }
      .tp-spinner { width: 50px; height: 50px; border: 4px solid rgba(255,255,255,0.2); border-top-color: #e50914; border-radius: 50%; animation: tp-spin 0.8s linear infinite; }
      @keyframes tp-spin { to { transform: rotate(360deg); } }

      .tp-center-play { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 68px; height: 68px; background: rgba(0,0,0,0.65); border: 2px solid rgba(255,255,255,0.3); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #fff; z-index: 25; backdrop-filter: blur(4px); transition: transform 0.2s, opacity 0.2s; }
      .tp-center-play:active { transform: translate(-50%, -50%) scale(0.9); }
      .tp-center-play svg { width: 32px; height: 32px; fill: currentColor; margin-left: 3px; }

      /* 手势浮层胶囊提示 (快进 / 倍速) */
      .tp-capsule-tip { position: absolute; top: 22%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.2); backdrop-filter: blur(8px); padding: 8px 18px; border-radius: 20px; color: #fff; font-size: 14px; font-weight: 500; display: flex; align-items: center; gap: 8px; z-index: 40; pointer-events: none; transition: opacity 0.2s; }

      /* 解码与车机设置面板 */
      .tp-settings-modal { position: absolute; top: 12px; right: 12px; width: 280px; max-width: 90%; background: rgba(18,18,18,0.96); border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; backdrop-filter: blur(12px); padding: 14px; z-index: 50; color: #fff; box-shadow: 0 10px 30px rgba(0,0,0,0.8); }
      .tp-modal-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 8px; margin-bottom: 10px; font-size: 14px; font-weight: 600; }
      .tp-setting-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 0; font-size: 13px; color: #eee; }
      .tp-setting-row input[type="checkbox"] { width: 18px; height: 18px; accent-color: #e50914; cursor: pointer; }
      .tp-modal-close { background: none; border: none; color: #aaa; cursor: pointer; font-size: 18px; line-height: 1; }
      .tp-modal-close:hover { color: #fff; }

      /* 倍速菜单 */
      .tp-rate-menu { position: absolute; bottom: 50px; right: 50px; background: rgba(20,20,20,0.95); border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; gap: 2px; z-index: 45; }
      .tp-rate-item { background: none; border: none; color: #ccc; padding: 6px 14px; text-align: center; font-size: 12px; border-radius: 4px; cursor: pointer; }
      .tp-rate-item.active { background: #e50914; color: #fff; font-weight: 600; }
    `;
    document.head.appendChild(style);
  }

  _createDOM() {
    this.root = document.createElement("div");
    this.root.className = "tp-root";

    this.root.innerHTML = `
      <video class="tp-video" playsinline webkit-playsinline x5-video-player-type="h5-page"></video>
      
      <!-- 居中加载与播放 -->
      <div class="tp-center-loading tp-hidden" id="tp-loading">
        <div class="tp-spinner"></div>
      </div>
      <div class="tp-center-play tp-hidden" id="tp-center-play" title="播放">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </div>

      <!-- 手势/倍速提示胶囊 -->
      <div class="tp-capsule-tip tp-hidden" id="tp-tip"></div>

      <!-- 顶部标题栏 -->
      <div class="tp-header" id="tp-header">
        <div class="tp-title" id="tp-title">${this.title || "特斯拉车机播放器"}</div>
        <div class="tp-header-actions">
          <button class="tp-btn" id="tp-btn-settings" title="车机解码与硬件加速设置">
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
            <button class="tp-btn" id="tp-rate-btn" style="font-size: 13px; font-weight: 600; width: 36px;">1.0x</button>
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
          <span>车机解码设置</span>
          <button class="tp-modal-close" id="tp-modal-close">×</button>
        </div>
        <div class="tp-setting-row">
          <span>硬件加速 (GPU)</span>
          <input type="checkbox" id="set-hardware">
        </div>
        <div class="tp-setting-row">
          <span>视频硬解码 (WebCodec)</span>
          <input type="checkbox" id="set-video-webcodec">
        </div>
        <div class="tp-setting-row">
          <span>音频硬解码 (WebCodec)</span>
          <input type="checkbox" id="set-audio-webcodec">
        </div>
        <div class="tp-setting-row">
          <span>音频 MSE 解码</span>
          <input type="checkbox" id="set-audio-mse">
        </div>
        <div class="tp-setting-row">
          <span>WebGPU 渲染引擎</span>
          <input type="checkbox" id="set-webgpu">
        </div>
      </div>
    `;

    this.container.appendChild(this.root);

    this.video = this.root.querySelector(".tp-video");
    this.header = this.root.querySelector("#tp-header");
    this.footer = this.root.querySelector("#tp-footer");
    this.loadingEl = this.root.querySelector("#tp-loading");
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

    // 初始化硬件加速设置 Checkbox 状态
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

    hw.addEventListener("change", (e) => this._setSetting("KIT_PLAYER_HARDWARE", e.target.checked));
    vWc.addEventListener("change", (e) => this._setSetting("KIT_PLAYER_VIDEO_WEBCODEC", e.target.checked));
    aWc.addEventListener("change", (e) => this._setSetting("KIT_PLAYER_AUDIO_WEBCODEC", e.target.checked));
    aMse.addEventListener("change", (e) => this._setSetting("KIT_PLAYER_AUDIO_MSE", e.target.checked));
    wGpu.addEventListener("change", (e) => this._setSetting("KIT_PLAYER_WEBGPU", e.target.checked));
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
    if (!this.video.paused) {
      this.controlsTimer = setTimeout(() => {
        this._toggleControls(false);
      }, 4000);
    }
  }

  _bindEvents() {
    const v = this.video;

    // 播放状态监听
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

    // 进度更新
    v.addEventListener("timeupdate", () => {
      if (this.isDraggingProgress) return;
      const cur = v.currentTime || 0;
      const dur = v.duration || 0;
      const pct = dur > 0 ? (cur / dur) * 100 : 0;
      this.playedEl.style.width = pct + "%";
      this.thumbEl.style.left = pct + "%";
      this.timeEl.textContent = `${this._formatTime(cur)} / ${this._formatTime(dur)}`;
    });

    // 缓冲进度
    v.addEventListener("progress", () => {
      if (v.buffered.length > 0 && v.duration > 0) {
        const bufferedEnd = v.buffered.end(v.buffered.length - 1);
        const pct = (bufferedEnd / v.duration) * 100;
        this.bufEl.style.width = pct + "%";
      }
    });

    // 播放/暂停控制
    const togglePlay = () => {
      if (v.paused) {
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    };
    this.playBtn.addEventListener("click", togglePlay);
    this.centerPlayEl.addEventListener("click", togglePlay);

    // 进度条拖拽与点击
    const seekFromEvent = (e) => {
      const rect = this.progressWrap.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetTime = pos * (v.duration || 0);
      this.playedEl.style.width = pos * 100 + "%";
      this.thumbEl.style.left = pos * 100 + "%";
      return targetTime;
    };

    this.progressWrap.addEventListener("mousedown", (e) => {
      this.isDraggingProgress = true;
      const t = seekFromEvent(e);
      const onMove = (ev) => { seekFromEvent(ev); };
      const onUp = (ev) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const finalT = seekFromEvent(ev);
        v.currentTime = finalT;
        this.isDraggingProgress = false;
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    this.progressWrap.addEventListener("touchstart", (e) => {
      this.isDraggingProgress = true;
      seekFromEvent(e);
    }, { passive: true });

    this.progressWrap.addEventListener("touchmove", (e) => {
      if (this.isDraggingProgress) seekFromEvent(e);
    }, { passive: true });

    this.progressWrap.addEventListener("touchend", (e) => {
      if (this.isDraggingProgress) {
        const finalT = seekFromEvent(e);
        v.currentTime = finalT;
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
        v.playbackRate = rate;
        this.rateBtn.textContent = rate === 1 ? "1.0x" : rate + "x";
        this.rateMenu.querySelectorAll(".tp-rate-item").forEach((b) => b.classList.remove("active"));
        e.target.classList.add("active");
        this.rateMenu.classList.add("tp-hidden");
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

    // 画面点击与手势处理（车机长按 2x 快进，左右滑动寻道）
    this.root.addEventListener("click", (e) => {
      if (e.target.closest("#tp-footer") || e.target.closest("#tp-header") || e.target.closest("#tp-modal") || e.target.closest("#tp-center-play")) {
        return;
      }
      this._toggleControls();
    });

    // 长按 2.0x 倍速 (车机常用舒适体验)
    const startLongPress = () => {
      this.longPressTimer = setTimeout(() => {
        if (!v.paused) {
          this.isLongPressing = true;
          this.savedPlaybackRate = v.playbackRate;
          v.playbackRate = 2.0;
          this._showTip("▶▶ 2.0x 极速快进中", 0);
        }
      }, 500);
    };

    const endLongPress = () => {
      clearTimeout(this.longPressTimer);
      if (this.isLongPressing) {
        this.isLongPressing = false;
        v.playbackRate = this.savedPlaybackRate || 1;
        this._hideTip();
      }
    };

    this.root.addEventListener("touchstart", (e) => {
      if (e.target.closest("#tp-footer") || e.target.closest("#tp-header")) return;
      this.touchStartX = e.touches[0].clientX;
      this.touchStartTime = v.currentTime;
      this.isSwiping = false;
      startLongPress();
    }, { passive: true });

    this.root.addEventListener("touchmove", (e) => {
      if (this.isDraggingProgress) return;
      const dx = e.touches[0].clientX - this.touchStartX;
      if (Math.abs(dx) > 20) {
        endLongPress(); // 滑动时取消长按
        this.isSwiping = true;
        const seekOffset = (dx / window.innerWidth) * 90; // 最大滑动区间90秒
        const target = Math.max(0, Math.min(v.duration || 0, this.touchStartTime + seekOffset));
        const sign = seekOffset >= 0 ? "+" : "";
        this._showTip(`${sign}${Math.round(seekOffset)}s (${this._formatTime(target)})`, 0);
      }
    }, { passive: true });

    this.root.addEventListener("touchend", (e) => {
      endLongPress();
      if (this.isSwiping) {
        const dx = (e.changedTouches[0]?.clientX || this.touchStartX) - this.touchStartX;
        const seekOffset = (dx / window.innerWidth) * 90;
        v.currentTime = Math.max(0, Math.min(v.duration || 0, this.touchStartTime + seekOffset));
        this._hideTip();
        this.isSwiping = false;
      }
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

  loadSource(url) {
    if (!url) return this;
    this.url = url;
    this.loadingEl.classList.remove("tp-hidden");
    this.centerPlayEl.classList.add("tp-hidden");

    if (this.hls) {
      try {
        this.hls.destroy();
      } catch {}
      this.hls = null;
    }

    const isM3u8 = url.includes(".m3u8") || url.includes("m3u8");
    const HlsClass = window.Hls || null;

    // 如果是 HLS 流且 Hls.js 可用
    if (isM3u8 && HlsClass && HlsClass.isSupported()) {
      const enableHw = this._getSetting("KIT_PLAYER_HARDWARE", true);
      const hls = new HlsClass({
        enableWorker: enableHw,
        lowLatencyMode: true,
        backBufferLength: 90,
        maxBufferLength: 30,
        autoStartLoad: true,
      });

      hls.loadSource(url);
      hls.attachMedia(this.video);

      hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
        this.loadingEl.classList.add("tp-hidden");
        this.video.play().catch(() => {
          this.centerPlayEl.classList.remove("tp-hidden");
        });
      });

      hls.on(HlsClass.Events.ERROR, (event, data) => {
        console.warn("[Tesla HLS Error]", data.type, data.details);
        if (data.fatal) {
          switch (data.type) {
            case HlsClass.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case HlsClass.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              this.loadingEl.classList.add("tp-hidden");
              this._showTip("视频加载异常，请点击刷新重试", 3000);
              break;
          }
        }
      });

      this.hls = hls;
    } else {
      // 原生播放支持（Safari / 原生支持 HLS 的车机 / MP4）
      this.video.src = url;
      this.video.load();
      this.video.play().catch(() => {
        this.loadingEl.classList.add("tp-hidden");
        this.centerPlayEl.classList.remove("tp-hidden");
      });
    }

    return this;
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      if (this.root.requestFullscreen) {
        this.root.requestFullscreen().catch(() => {});
      } else if (this.video.webkitEnterFullscreen) {
        this.video.webkitEnterFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  play() {
    return this.video?.play();
  }

  pause() {
    this.video?.pause();
  }

  destroy() {
    clearTimeout(this.controlsTimer);
    clearTimeout(this.longPressTimer);
    clearTimeout(this._tipTimer);
    if (this.hls) {
      try {
        this.hls.destroy();
      } catch {}
      this.hls = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
    }
    this.container.innerHTML = "";
  }
}
