'use strict';
const { JSDOM } = require('jsdom');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const src = path.resolve(__dirname, '../src');
const screenshot = require('./fixtures/utaten-confusions.cjs');
const rnp = process.argv.includes('rnp');
const original = '恋人と空をみる';
const texts = [original, screenshot.target, '空をみる日'];
const native = '<ul class="lyric">' + texts.map(text => '<li class="line"><p>' + text + '</p><p class="translation">保留原来的中文翻译</p></li>').join('') + '</ul>';
const karaoke = '<div id="rnp-view"><div class="rnp-lyrics">' + texts.map(text => '<div class="rnp-lyrics-line"><div class="rnp-lyrics-line-karaoke">' +
	[...text].map(c => '<div class="rnp-karaoke-word" style="display:inline-block"><span>' + c + '</span><span class="rnp-karaoke-word-filler">' + c + '</span></div>').join('') +
	'</div><div class="translation rnp-lyrics-line-translated">保留原来的中文翻译</div></div>').join('') + '</div></div>';
const dom = new JSDOM('<body><div id="root">' + (rnp ? '<div class="g-single" style="visibility:hidden">' + native + '</div>' : native) + '</div>' + (rnp ? karaoke : '') + '</body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://music.163.com/' });
const win = dom.window, handlers = {}, disk = new Map();
let songId = '1', pending, requests = 0;
const metadata = { id: 1, name: '星の手紙', artists: [{ name: '試験歌手' }] };
win.document.getElementById('root').__reactContainer$test = { memoizedProps: { store: { getState: () => ({ playing: { resourceTrackId: songId, curTrack: { ...metadata, id: Number(songId) } } }), dispatch() {}, subscribe() {} } } };
win.plugin = { pluginPath: src, devMode: false, onLoad: f => handlers.load = f, onConfig: f => handlers.config = f };
win.betterncm = { app: { getBetterNCMVersion: async () => '1.3.4' }, ncm: { openUrl() {} }, fs: { exists: async () => true } };
win.kuromoji = { builder: () => ({ build: cb => cb(null, { tokenize: text => {
	const words = [['恋人', 'コイビト'], ['空', 'ソラ'], ['日', 'ヒ'], ['抗', 'アラガ'], ['沖動', 'オキドウ'], ['暗', 'アン'], ['彼', 'カレ'], ['包', 'ツツ']];
	const tokens = [];
	for (let at = 0; at < text.length;) {
		const [surface_form, reading] = words.find(([word]) => text.startsWith(word, at)) || [text[at], text[at]];
		tokens.push({ surface_form, reading, word_type: 'KNOWN' }); at += surface_form.length;
	}
	return tokens;
} }) }) };
win.fetch = async () => ({ ok: true, json: async () => ({
	lrc: { lyric: texts.map((text, i) => '[00:0' + (i + 1) + ']' + text).join('\n') },
	romalrc: { lyric: '[00:01]ko i bi to to so ra wo mi ru\n[00:02]a ra ga e nu o ki do u no a n ga ka re wo tsu tsu n da\n[00:03]so ra wo mi ru hi' }
}) });
for (const file of ['furigana.js', 'external-core.js', 'external.js']) win.eval(fs.readFileSync(path.join(src, file), 'utf8'));
win.FuriganaExternal.browserTransport = () => ({
	dataRoot: async () => 'C:/BetterNCM',
	fs: { mkdir: async () => true, exists: async p => disk.has(p), readFileText: async p => disk.get(p), writeFileText: async (p, value) => { disk.set(p, value); return true; } },
	parse: html => new win.DOMParser().parseFromString(html, 'text/html'),
	request: async url => {
		requests++;
		assert.equal(new URL(url).hostname, 'utaten.com', 'UtaTen-only must never request Uta-Net');
		if (url.includes('/search')) return '<table><tr><td class="searchResult__title"><a href="/lyric/test001/">星の手紙</a></td><td class="searchResult__artist"><p><a>試験歌手</a></p></td></tr></table>';
		await new Promise(resolve => { pending = resolve; });
		return '<h2 class="newLyricTitle__main">星の手紙<span>歌詞</span></h2><h3><a href="/artist/1">試験歌手</a></h3><div class="lyricBody"><div class="hiragana"><span class="ruby"><span class="rb">恋人</span><span class="rt">あなた</span></span>と<span class="ruby"><span class="rb">空</span><span class="rt">そら</span></span>をみる<br>' + screenshot.html + '</div></div>';
	}
});
win.localStorage.setItem('jp-furigana.config', JSON.stringify({ readingSource: 'external', externalProvider: 'utaten' }));
win.eval(fs.readFileSync(path.join(src, 'main.js'), 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let n = 0; n < 100; n++) { if (fn()) return; await sleep(30); } throw new Error('Timed out waiting for plugin'); }
const lyricLines = () => [...win.document.querySelectorAll(rnp ? '.rnp-lyrics-line-karaoke' : 'li.line > p:first-child')];
const readings = (i = 0) => [...lyricLines()[i].querySelectorAll('.fg-rt')].map(n => n.textContent);
const baseText = element => { const copy = element.cloneNode(true); for (const n of copy.querySelectorAll('.fg-rt,rt,.rnp-karaoke-word-filler')) n.remove(); return copy.textContent; };
const assertScreenshot = (mode = 'hiragana') => {
	assert.equal(baseText(lyricLines()[1]), screenshot.target);
	const pairs = [...lyricLines()[1].querySelectorAll('.fg-ruby')].map(n => [baseText(n), n.querySelector('.fg-rt').textContent]);
	for (const [text, rt] of [['沖動', mode === 'hiragana' ? 'しょうどう' : 'ショウドウ'], ['暗', mode === 'hiragana' ? 'やみ' : 'ヤミ']]) {
		assert(pairs.some(p => p[0] === text && p[1] === rt), text + ' must use the website reading at its original position');
	}
};
(async () => {
	await handlers.load();
	await until(() => pending && readings().includes('こいびと'));
	assert.equal(win.JPFurigana.state.srcExternal, 0, 'Official/local fallback visible while website is pending');
	assert(readings(1).includes('あん'), 'Reproduce the old fallback reading before the website is ready');
	pending();
	await until(() => readings().includes('あなた'));
	assert.equal(win.JPFurigana.state.srcExternal, 2);
	assert.equal(win.JPFurigana.state.srcRomaji, 1, 'An actually unmatched line still falls back');
	assertScreenshot();
	assert([...win.document.querySelectorAll('.translation')].every(n => n.textContent === '保留原来的中文翻译'));
	const panel = handlers.config(); win.document.body.append(panel);
	assert(panel.querySelector('option[value="external"]'));
	assert.equal(panel.querySelector('.fg-external-settings').hidden, false);
	assert(panel.querySelector('.fg-external-status').textContent.includes('UtaTen'));
	assert(panel.querySelector('.fg-external-status').textContent.includes('网站命中 2 行；网易云音译回退 1 行'));
	const proxy = panel.querySelector('[data-k="externalProxy"]');
	proxy.value = 'http://user:password@127.0.0.1:7890'; proxy.dispatchEvent(new win.Event('change'));
	assert(panel.querySelector('.fg-external-error').textContent.includes('账号密码'));
	assert.equal(win.JPFurigana.config.externalProxy, '');
	const count = requests;
	win.JPFurigana.set('kana', 'katakana');
	await until(() => readings().includes('アナタ'));
	assertScreenshot('katakana');
	assert.equal(requests, count, 'Kana style change reuses disk cache');
	win.JPFurigana.disable();
	assert.equal(baseText(lyricLines()[0]), original);
	assert.equal(baseText(lyricLines()[1]), screenshot.target);
	assert(lyricLines().every(n => !n.querySelector('.fg-rt')));
	pending = null; songId = '2'; win.JPFurigana.enable();
	await until(() => pending && win.JPFurigana.state.externalTrackId === '2' && readings().includes('コイビト'));
	assert(!readings().includes('アナタ'), 'Previous song must not leak into the next song');
	assert(!readings(1).includes('ヤミ'), 'Corrected external reading must not leak into a new song');
	win.JPFurigana.set('readingSource', 'dict'); pending();
	await sleep(150); win.JPFurigana.pass(); await sleep(150);
	assert(!readings().includes('アナタ'), 'Disabled external source must ignore late completion');
	assert(!disk.has('C:/BetterNCM/lyrics/jp-furigana/2.json'));
	console.log('Integration tests passed (' + (rnp ? 'RNP split karaoke and filler' : 'native DOM') + '): screenshot correction, immediate fallback, async replacement, translations, settings, cached kana toggle, disable restore, track isolation and late-result cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => win.close());
