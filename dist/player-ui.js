// 基于 ArtPlayer 的简化 UI 封装
// - 保留“设置”里的解码选项（localStorage 键保持不变）
// - 依赖 index.html 先引入 dist/artplayer.js（提供 window.Artplayer）

export class Player {
	constructor(options) {
		this.options = options || {};
		this.container = this.options.container;
		this.url = null;
		this.art = null;
		this.settingPanel = null;
		this._init();
	}

	_init() {
		if (!this.container) throw new Error('缺少 container');
		this.container.style.position = 'relative';
		this.container.style.width = '100%';
		this.container.style.height = '100%';

		this._createSettingPanel();
		this._mountArtplayer('');
	}

	_getSetting(key, defaultTrue = true) {
		const v = window.localStorage.getItem(key);
		if (v === null) return defaultTrue;
		return v === 'true';
	}

	_createSettingPanel() {
		const wrap = document.createElement('div');
		wrap.style.position = 'absolute';
		wrap.style.top = '0';
		wrap.style.right = '0';
		wrap.style.zIndex = '99';
		wrap.style.pointerEvents = 'none';

		const panel = document.createElement('div');
		panel.style.pointerEvents = 'auto';
		panel.style.margin = '12px';
		panel.style.padding = '12px 14px';
		panel.style.background = 'rgba(0,0,0,0.6)';
		panel.style.borderRadius = '8px';
		panel.style.color = '#fff';
		panel.style.fontSize = '14px';
		panel.style.maxWidth = '260px';
		panel.style.display = 'none';

		panel.innerHTML = `
			<div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;border-bottom:1px solid rgba(255,255,255,.2);padding-bottom:.5rem;margin-bottom:.5rem;">
				<span style="font-weight:600">设置</span>
				<button class="setting-close" style="background:none;border:none;color:#fff;cursor:pointer">×</button>
                    </div>
			<div style="display:flex;flex-direction:column;gap:.5rem;">
				<label style="display:flex;justify-content:space-between;align-items:center;gap:1rem;">
					<span>硬件加速</span>
					<input id="enable-hardware" type="checkbox" />
                           </label>
				<label style="display:flex;justify-content:space-between;align-items:center;gap:1rem;">
					<span>视频硬解码</span>
					<input id="video-webcodec" type="checkbox" />
                           </label>
				<label style="display:flex;justify-content:space-between;align-items:center;gap:1rem;">
					<span>音频硬解码</span>
					<input id="audio-webcodec" type="checkbox" />
                            </label>
				<label style="display:flex;justify-content:space-between;align-items:center;gap:1rem;">
					<span>音频MSE解码</span>
					<input id="audio-mse" type="checkbox" />
                            </label>
				<label style="display:flex;justify-content:space-between;align-items:center;gap:1rem;">
					<span>WebGPU</span>
					<input id="enable-webgpu" type="checkbox" />
                            </label>
                        </div>
		`;

		wrap.appendChild(panel);
		this.container.appendChild(wrap);
		this.settingPanel = panel;

		panel.querySelector('#enable-hardware').checked = this._getSetting('KIT_PLAYER_HARDWARE');
		panel.querySelector('#video-webcodec').checked = this._getSetting('KIT_PLAYER_VIDEO_WEBCODEC');
		panel.querySelector('#audio-webcodec').checked = this._getSetting('KIT_PLAYER_AUDIO_WEBCODEC');
		panel.querySelector('#audio-mse').checked = this._getSetting('KIT_PLAYER_AUDIO_MSE');
		panel.querySelector('#enable-webgpu').checked = this._getSetting('KIT_PLAYER_WEBGPU');

		panel.querySelector('#enable-hardware').addEventListener('change', (e) => {
			localStorage.setItem('KIT_PLAYER_HARDWARE', e.target.checked.toString());
		});
		panel.querySelector('#video-webcodec').addEventListener('change', (e) => {
			localStorage.setItem('KIT_PLAYER_VIDEO_WEBCODEC', e.target.checked.toString());
		});
		panel.querySelector('#audio-webcodec').addEventListener('change', (e) => {
			localStorage.setItem('KIT_PLAYER_AUDIO_WEBCODEC', e.target.checked.toString());
		});
		panel.querySelector('#audio-mse').addEventListener('change', (e) => {
			localStorage.setItem('KIT_PLAYER_AUDIO_MSE', e.target.checked.toString());
		});
		panel.querySelector('#enable-webgpu').addEventListener('change', (e) => {
			localStorage.setItem('KIT_PLAYER_WEBGPU', e.target.checked.toString());
		});

		const toggleBtn = document.createElement('button');
		toggleBtn.textContent = '设置';
		toggleBtn.style.position = 'absolute';
		toggleBtn.style.top = '12px';
		toggleBtn.style.right = '12px';
		toggleBtn.style.zIndex = '100';
		toggleBtn.style.padding = '6px 10px';
		toggleBtn.style.background = 'rgba(0,0,0,0.6)';
		toggleBtn.style.color = '#fff';
		toggleBtn.style.border = 'none';
		toggleBtn.style.borderRadius = '6px';
		toggleBtn.style.cursor = 'pointer';
		this.container.appendChild(toggleBtn);

		toggleBtn.addEventListener('click', () => {
			panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
		});
		panel.querySelector('.setting-close').addEventListener('click', () => {
			panel.style.display = 'none';
		});
	}

	_mountArtplayer(url) {
		if (!window.Artplayer) {
			throw new Error('Artplayer 未加载，请在 index.html 中引入 dist/artplayer.js');
		}
		if (this.art) {
			try { this.art.destroy(false); } catch (e) {}
			this.art = null;
		}
		this.art = new window.Artplayer({
			container: this.container,
			url: url || '',
			autoplay: false,
			autoSize: true,
			muted: false,
			volume: 0.6,
			isLive: this.options.isLive ?? false,
			lang: 'zh-cn',
			lock: true,
			fastForward: true,
			setting: true,
			pip: true,
			fullscreen: true,
			fullscreenWeb: true,
			theme: '#e50916',
		});
	}

	loadSource(url) {
		if (!url || url === this.url) return this;
		this.url = url;
		if (this.art && typeof this.art.switchUrl === 'function') {
			this.art.switchUrl(url, true);
		} else {
			this._mountArtplayer(url);
		}
		try { this.art.play(); } catch (e) {}
		return this;
	}

	destroy() {
		if (this.art) {
			try { this.art.destroy(false); } catch (e) {}
			this.art = null;
		}
	}
}

                    
