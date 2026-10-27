/* Lazy website client, on-demand Windows transport and per-song JSON cache. */
(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory(require('./external-core.js'));
	else root.FuriganaExternal = factory(root.FuriganaExternalCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
	'use strict';
	function validateProxy(value) {
		const text = String(value || '').trim();
		if (!text) return '';
		let url;
		try { url = new URL(text); } catch (_) { throw new Error('代理格式示例：http://127.0.0.1:7890'); }
		if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname ||
			url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/') || /[\s\x00-\x1f]/.test(text)) {
			throw new Error('仅支持 HTTP / HTTPS / SOCKS5 地址，不包含账号密码、路径或查询参数');
		}
		return text;
	}
	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
	function requestError(result) {
		const status = Number(result.status) || 0, code = Number(result.curlCode) || 0;
		const message = code === 28 ? '请求超时（curl error 28）' : status ? 'HTTP ' + status : String(result.error || '网络请求失败');
		const error = new Error(message);
		error.retryable = [408, 425, 429, 500, 502, 503, 504].includes(status) || [5, 6, 7, 18, 28, 35, 52, 55, 56, 92, 97].includes(code);
		const after = String(result.retryAfter || '').trim();
		error.retryAfterMs = /^\d+$/.test(after) ? Number(after) * 1000 : Math.max(0, (Date.parse(after) || 0) - Date.now());
		return error;
	}
	function retryable(error) {
		if (typeof error.retryable === 'boolean') return error.retryable;
		return error.name === 'AbortError' || error instanceof TypeError && /fetch|network/i.test(error.message) ||
			/HTTP (408|425|429|500|502|503|504)\b|curl error (5|6|7|18|28|35|52|55|56|92|97)\b/.test(error.message);
	}
	function browserTransport(bn, plugin, options = {}) {
		let scriptPromise, rootPromise;
		let chain = Promise.resolve();
		const toBase64 = value => {
			const bytes = new TextEncoder().encode(value);
			let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
			return btoa(binary);
		};
		const command64 = value => {
			let binary = '';
			for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); binary += String.fromCharCode(c & 255, c >> 8); }
			return btoa(binary);
		};
		const dataRoot = () => rootPromise || (rootPromise = bn.app.getDataPath().then(p => p.replace(/\\/g, '/')));
		async function request(url, proxy, cancelled = () => false) {
			if (!core.allowedURL(url)) throw new Error('只允许访问歌词网站');
			proxy = validateProxy(proxy);
			const job = async () => {
				if (cancelled()) throw new Error('已取消');
				const dir = (await dataRoot()) + '/lyrics/jp-furigana/requests';
				if (!await bn.fs.mkdir(dir)) throw new Error('无法创建请求目录');
				if (!scriptPromise) scriptPromise = bn.fs.readFileText(plugin.pluginPath + '/external-fetch.ps1').catch(e => { scriptPromise = null; throw e; });
				const script = await scriptPromise;
				const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
				const id = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
				const reply = dir + '/request-' + id + '.json';
				const encoded = toBase64(JSON.stringify({ url, proxy, reply }));
				const command = 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + command64('& {\n' + script + '\n} ' + encoded);
				if (command.length > 30000) throw new Error('网络脚本超出 Windows 命令长度限制');
				const deadline = Date.now() + 45000;
				let cancellationSent = false;
				try {
					if (cancelled()) throw new Error('已取消');
					if (!await bn.app.exec(command, false, false)) throw new Error('无法启动系统网络组件');
					while (Date.now() < deadline) {
						if (cancelled() && !cancellationSent) {
							cancellationSent = true;
							try { await storage.writeFileText(reply + '.cancel', '1'); } catch (_) { /* bounded helper timeout still applies */ }
						}
						if (await bn.fs.exists(reply)) {
							const raw = await bn.fs.readFileText(reply);
							if (cancelled()) throw new Error('已取消');
							if (raw.length > 3000000) throw new Error('网站响应过大');
							const result = JSON.parse(raw);
							if (!result.ok) throw requestError(result);
							if (typeof result.body !== 'string' || !core.allowedURL(result.url)) throw new Error('无效的网站响应');
							return result.body;
						}
						await sleep(350);
					}
					throw new Error('网络请求超时（系统组件可能被拦截）');
				} finally {
					// Only this request's exact filenames, never a directory or wildcard.
					for (const path of [reply, reply + '.partial', reply + '.cancel']) {
						try { if (await bn.fs.exists(path)) await bn.fs.remove(path); } catch (_) { /* next request remains usable */ }
					}
				}
			};
			// One child process at a time, including rapidly skipped tracks.
			const result = chain.then(job, job);
			chain = result.catch(() => {});
			return result;
		}
		// BetterNCM 1.3.4's binary write route uses wide Windows paths; its text
		// route uses a narrow std::string, which can fail for Chinese folder names.
		const storage = { ...bn.fs, writeFileText: (path, text) =>
			bn.fs.writeFile(path, new Blob([text], { type: 'application/json;charset=utf-8' })) };
		return { request, dataRoot, fs: storage, parse: html => new DOMParser().parseFromString(html, 'text/html'), ...options };
	}
	function create(deps) {
		let generation = 0, currentId = null, current = null, groups = [], status = '未启用外部网站';
		let cachePath = '', source = '', lastSettings = null;
		let cancelWait = null, loading = false, lastMetadata = null;
		const retryDelays = deps.retryDelays || [3000, 8000, 15000];
		const lineCache = new Map();
		function announce(text) { status = text; if (deps.onStatus) deps.onStatus(); }
		const alive = g => g === generation;
		function cancelRetry() { if (cancelWait) cancelWait(); }
		function reset() { generation++; cancelRetry(); loading = false; currentId = null; current = null; groups = []; source = ''; lineCache.clear(); }
		function stop() { reset(); announce('未启用外部网站'); }
		function waitRetry(ms) {
			return new Promise(resolve => {
				const timer = setTimeout(() => { cancelWait = null; resolve(true); }, ms);
				cancelWait = () => { clearTimeout(timer); cancelWait = null; resolve(false); };
			});
		}
		function setAutoRetry(value) {
			if (!lastSettings) return;
			lastSettings.externalAutoRetry = value;
			if (value !== 'failed') cancelRetry();
			else if (!loading && currentId && !current && lastMetadata) return load(currentId, lastMetadata, lastSettings);
		}
		async function directory(settings) {
			const root = await deps.dataRoot();
			let path = String(settings.externalCacheDir || '').trim().replace(/\\/g, '/');
			if (!path) path = root + '/lyrics/jp-furigana';
			else if (!/^[A-Za-z]:\//.test(path)) throw new Error('自定义缓存目录需要填写完整磁盘路径');
			if (/[\x00-\x1f"<>|?*]/.test(path) || path.split('/').some(p => p === '..')) throw new Error('缓存目录格式无效');
			if (!await deps.fs.mkdir(path)) throw new Error('无法创建歌词缓存目录');
			return path.replace(/\/$/, '');
		}
		function accept(record, cached, g, warning = '') {
			if (!alive(g)) return;
			current = record; groups = core.prepare(record); lineCache.clear(); source = record.provider;
			announce((cached ? '本地缓存' : '已获取') + ' · ' + (source === 'utaten' ? 'UtaTen 振假名' : '歌ネット罗马音') + ' · ' + record.lines.length + ' 行' + warning);
			if (deps.onReady) deps.onReady();
		}
		async function load(songId, metadata, settings, force = false) {
			reset(); const g = generation; currentId = String(songId); settings = { ...settings }; lastSettings = settings; lastMetadata = metadata;
			if (!/^\d{1,20}$/.test(currentId)) { announce('当前歌曲没有可用的网易云 ID'); return; }
			const id = currentId;
			loading = true;
			let retries = 0;
			async function attempt(task, label) {
				for (;;) {
					if (!alive(g)) throw new Error('已取消');
					try { return await task(); } catch (error) {
						if (!alive(g) || settings.externalAutoRetry !== 'failed' || !retryable(error) || retries >= retryDelays.length) throw error;
						const delay = Math.max(retryDelays[retries], error.retryAfterMs || 0);
						// Respect long server cooldowns without retaining a song's task indefinitely.
						if (!Number.isFinite(delay) || delay > 300000) throw error;
						retries++;
						announce(label + '：' + error.message + '；' + Math.ceil(delay / 1000) + ' 秒后自动重试（' + retries + '/' + retryDelays.length + '）');
						if (!await waitRetry(delay) || !alive(g) || settings.externalAutoRetry !== 'failed') throw error;
						announce(label + '：正在自动重试（' + retries + '/' + retryDelays.length + '）…');
					}
				}
			}
			announce('读取外部歌词缓存…');
			try {
				const dir = await directory(settings);
				const path = dir + '/' + id + '.json';
				if (!alive(g)) return;
				cachePath = dir;
				if (!force && await deps.fs.exists(path)) {
					try {
						const raw = await deps.fs.readFileText(path);
						if (raw.length > 2000000) throw new Error('缓存过大');
						const record = JSON.parse(raw);
						if (core.validRecord(record, id) && (settings.externalProvider === 'auto' || !settings.externalProvider || settings.externalProvider === record.provider)) {
							accept(record, true, g); return;
						}
					} catch (_) { /* Invalid or partially-written cache: refetch. */ }
				}
				if (!alive(g)) return;
				announce('获取歌曲信息…');
				const track = await attempt(metadata, '获取歌曲信息');
				if (!alive(g)) return;
				if (!track || !track.title || !Array.isArray(track.artists) || !track.artists.some(Boolean)) throw new Error('无法确定歌名与歌手，请稍后重试');
				const proxy = settings.externalProxyEnabled ? validateProxy(settings.externalProxy) : '';
				if (settings.externalProxyEnabled && !proxy) throw new Error('请填写代理地址或关闭代理');
				const providers = settings.externalProvider === 'utaten' ? ['utaten'] : settings.externalProvider === 'utanet' ? ['utanet'] : ['utaten', 'utanet'];
				const errors = [];
				for (const provider of providers) {
					if (!alive(g)) return;
					try {
						announce('正在查询 ' + (provider === 'utaten' ? 'UtaTen' : '歌ネット') + '，暂用网易云音译 / 词典…');
						const fetchDoc = async url => deps.parse(await attempt(() => deps.request(url, proxy, () => !alive(g)),
							(provider === 'utaten' ? 'UtaTen' : '歌ネット') + (url.includes('/search') ? ' 搜索' : ' 歌词页')));
						const search = await fetchDoc(core.searchURL(provider, track));
						if (!alive(g)) return;
						const candidates = core.searchResults(search, provider).filter(c => core.matches(c, track));
						if (candidates.length !== 1) throw new Error(candidates.length ? '存在多个同名版本，未自动套用' : '未找到歌名与歌手都匹配的结果');
						const candidate = candidates[0];
						const url = provider === 'utaten' ? candidate.url : candidate.url.replace('/song/', '/global/en/lyric/');
						const doc = await fetchDoc(url);
						if (!alive(g)) return;
						const data = provider === 'utaten' ? core.parseUtaten(doc, url) : core.parseUtanet(doc, url, candidate);
						if (!core.matches(data, track)) throw new Error('歌曲页的歌名 / 歌手与搜索结果不一致');
						const record = { schema: 1, songId: id, fetchedAt: new Date().toISOString(), ...data };
						if (!core.validRecord(record, id)) throw new Error('网站歌词格式校验失败');
						let warning = '';
						try {
							const serialized = JSON.stringify(record);
							if (!await deps.fs.writeFileText(path, serialized) || await deps.fs.readFileText(path) !== serialized) throw new Error('缓存写入校验失败');
						} catch (_) { warning = '（缓存写入失败，本次仍可显示）'; }
						accept(record, false, g, warning); return;
					} catch (error) { errors.push((provider === 'utaten' ? 'UtaTen' : '歌ネット') + '：' + error.message); }
				}
				if (alive(g)) announce(errors.join('\n') + '\n继续使用网易云音译 / 词典；可手动重试');
			} catch (error) { if (alive(g)) announce(error.message + '；继续使用网易云音译 / 词典'); }
			finally { if (alive(g)) loading = false; }
		}
		function segments(text, mode, fromRomaji) {
			if (!current) return null;
			const k = mode + '|' + text;
			if (!lineCache.has(k)) {
				if (lineCache.size > 1000) lineCache.clear();
				lineCache.set(k, core.segmentsFor(text, groups, mode, fromRomaji));
			}
			return lineCache.get(k);
		}
		return { load, stop, setAutoRetry, segments, inspect: () => ({ songId: currentId, status, cachePath, source, loading, waitingRetry: !!cancelWait, url: current && current.url, settings: lastSettings }) };
	}
	return { create, browserTransport, validateProxy, requestError };
});
