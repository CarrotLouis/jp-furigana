'use strict';
const { JSDOM } = require('jsdom');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = path.resolve(__dirname, '../src');
const original = '恋人と空をみる';
const dom = new JSDOM('<body><div id="root"><ul class="lyric"><li class="line"><p>' + original + '</p><p>保留原来的中文翻译</p></li></ul></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://music.163.com/' });
const win = dom.window, handlers = {}, disk = new Map();
let songId = '1', pending, requests = 0;
const metadata = { id: 1, name: '星の手紙', artists: [{ name: '試験歌手' }] };
win.document.getElementById('root').__reactContainer$test = { memoizedProps: { store: { getState: () => ({ playing: { resourceTrackId: songId, curTrack: { ...metadata, id: Number(songId) } } }), dispatch() {}, subscribe() {} } } };
win.plugin = { pluginPath: src, devMode: false, onLoad: f => handlers.load = f, onConfig: f => handlers.config = f };
win.betterncm = { app: { getBetterNCMVersion: async () => '1.3.4' }, ncm: { openUrl() {} }, fs: { exists: async () => true } };
win.kuromoji = { builder: () => ({ build: cb => cb(null, { tokenize: () => [
	{ surface_form: '恋人', reading: 'コイビト', word_type: 'KNOWN' }, { surface_form: 'と', reading: 'ト', word_type: 'KNOWN' },
	{ surface_form: '空', reading: 'ソラ', word_type: 'KNOWN' }, { surface_form: 'を', reading: 'ヲ', word_type: 'KNOWN' }, { surface_form: 'みる', reading: 'ミル', word_type: 'KNOWN' }
] }) }) };
win.fetch = async () => ({ ok: true, json: async () => ({ lrc: { lyric: '[00:01]' + original }, romalrc: { lyric: '[00:01]ko i bi to to so ra wo mi ru' } }) });
for (const file of ['furigana.js', 'external-core.js', 'external.js']) win.eval(fs.readFileSync(path.join(src, file), 'utf8'));
win.FuriganaExternal.browserTransport = () => ({
	dataRoot: async () => 'C:/BetterNCM',
	fs: { mkdir: async () => true, exists: async p => disk.has(p), readFileText: async p => disk.get(p), writeFileText: async (p, value) => { disk.set(p, value); return true; } },
	parse: html => new win.DOMParser().parseFromString(html, 'text/html'),
	request: async url => {
		requests++;
		if (url.includes('/search')) return '<table><tr><td class="searchResult__title"><a href="/lyric/test001/">星の手紙</a></td><td class="searchResult__artist"><p><a>試験歌手</a></p></td></tr></table>';
		await new Promise(resolve => { pending = resolve; });
		return '<h2 class="newLyricTitle__main">星の手紙<span>歌詞</span></h2><h3><a href="/artist/1">試験歌手</a></h3><div class="lyricBody"><div class="hiragana"><span class="ruby"><span class="rb">恋人</span><span class="rt">あなた</span></span>と<span class="ruby"><span class="rb">空</span><span class="rt">そら</span></span>をみる</div></div>';
	}
});
win.localStorage.setItem('jp-furigana.config', JSON.stringify({ readingSource: 'external' }));
win.eval(fs.readFileSync(path.join(src, 'main.js'), 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let n = 0; n < 100; n++) { if (fn()) return; await sleep(30); } throw new Error('Timed out waiting for plugin'); }
const readings = () => [...win.document.querySelectorAll('li:first-child .fg-rt')].map(n => n.textContent);
(async () => {
	await handlers.load();
	await until(() => pending && readings().includes('こいびと'));
	assert.equal(win.JPFurigana.state.srcExternal, 0, 'Official/local fallback visible while website is pending');
	pending();
	await until(() => readings().includes('あなた'));
	assert.equal(win.JPFurigana.state.srcExternal, 1);
	assert.equal(win.document.querySelector('li p:nth-child(2)').textContent, '保留原来的中文翻译');
	const panel = handlers.config(); win.document.body.append(panel);
	assert(panel.querySelector('option[value="external"]'));
	assert.equal(panel.querySelector('.fg-external-settings').hidden, false);
	assert(panel.querySelector('.fg-external-status').textContent.includes('UtaTen'));
	const proxy = panel.querySelector('[data-k="externalProxy"]');
	proxy.value = 'http://user:password@127.0.0.1:7890'; proxy.dispatchEvent(new win.Event('change'));
	assert(panel.querySelector('.fg-external-error').textContent.includes('账号密码'));
	assert.equal(win.JPFurigana.config.externalProxy, '');
	const count = requests;
	win.JPFurigana.set('kana', 'katakana');
	await until(() => readings().includes('アナタ'));
	assert.equal(requests, count, 'Kana style change reuses disk cache');
	win.JPFurigana.disable();
	assert.equal(win.document.querySelector('li p').textContent, original);
	assert.equal(win.document.querySelectorAll('ul.lyric .fg-rt').length, 0);
	pending = null; songId = '2'; win.JPFurigana.enable();
	await until(() => pending && win.JPFurigana.state.externalTrackId === '2' && readings().includes('コイビト'));
	assert(!readings().includes('アナタ'), 'Previous song must not leak into the next song');
	win.JPFurigana.set('readingSource', 'dict'); pending();
	await sleep(150); win.JPFurigana.pass(); await sleep(150);
	assert(!readings().includes('アナタ'), 'Disabled external source must ignore late completion');
	assert(!disk.has('C:/BetterNCM/lyrics/jp-furigana/2.json'));
	console.log('Integration tests passed: native lyric DOM, immediate fallback, async replacement, translations, settings, cached kana toggle, disable restore, track isolation and late-result cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => win.close());
