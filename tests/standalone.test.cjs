'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const src = path.resolve(__dirname, '../src'), manifest = require('../src/manifest.json');
async function fixture(conflict, late = false) {
	const dom = new JSDOM('<body><p id="original">原页面</p></body>', { url: 'https://music.163.com/', runScripts: 'outside-only', pretendToBeVisual: true });
	const win = dom.window, handlers = {}, opened = [], legacy = JSON.stringify({ enabled: false, readingSource: 'dict', rtSize: 74, configVersion: 2 });
	const oldCore = {}, oldDictionary = {}, oldLoader = () => {}, oldApi = {};
	win.FuriganaCore = oldCore; win.kuromoji = oldDictionary; win.__FURIGANA_DICT_LOADER__ = oldLoader;
	win.loadedPlugins = conflict && !late ? { 'jp-furigana': { manifest: { slug: 'jp-furigana' } } } : {};
	win.plugin = { pluginPath: src, devMode: false, onLoad: f => handlers.load = f, onAllPluginsLoaded: f => handlers.all = f, onConfig: f => handlers.config = f };
	win.betterncm = { app: { getBetterNCMVersion: async () => '1.3.4' }, ncm: { openUrl: url => opened.push(url) } };
	win.localStorage.setItem('jp-furigana.config', legacy); win.localStorage.setItem('jp-furigana.cache.v3', 'keep-original-cache');
	for (const { file } of manifest.injects.Main) win.eval(fs.readFileSync(path.join(src, file), 'utf8'));
	assert.equal(win.FuriganaCore, oldCore); assert.equal(win.kuromoji, oldDictionary); assert.equal(win.__FURIGANA_DICT_LOADER__, oldLoader);
	assert.equal(handlers.load, undefined, 'Wait for all plugin manifests before starting');
	assert(!win.JPFuriganaPlus); assert(!win.document.querySelector('style'));
	if (conflict && late) win.loadedPlugins['jp-furigana'] = { manifest: { slug: 'jp-furigana' } };
	if (conflict) win.JPFurigana = oldApi;
	await handlers.all(win.loadedPlugins);
	if (conflict) {
		assert.equal(win.JPFurigana, oldApi); assert(!win.JPFuriganaPlus);
		assert(!win.document.querySelector('style')); assert(!win.__FURIGANA_PLUS_DICT_LOADER__);
		const panel = handlers.config(); assert(panel.textContent.includes('Plus 已暂停'));
		panel.querySelector('a').click(); assert.equal(opened[0], 'https://github.com/CarrotLouis/jp-furigana/tree/standalone');
	} else {
		assert(win.JPFuriganaPlus); assert(!win.JPFurigana);
		assert.equal(win.JPFuriganaPlus.config.rtSize, 74, 'Copy earlier user settings once');
		win.JPFuriganaPlus.set('rtSize', 81);
		assert.equal(JSON.parse(win.localStorage.getItem('jp-furigana-plus.config')).rtSize, 81);
		assert.equal(win.document.querySelector('#original').textContent, '原页面');
	}
	assert.equal(win.localStorage.getItem('jp-furigana.config'), legacy, 'Never overwrite original settings');
	assert.equal(win.localStorage.getItem('jp-furigana.cache.v3'), 'keep-original-cache');
	win.close();
}
(async () => {
	await fixture(true); await fixture(true, true); await fixture(false);
	console.log('Standalone passed: isolated globals/settings, safe migration, both plugin load orders, conflict UI and no original DOM/cache mutation.');
})().catch(e => { console.error(e); process.exitCode = 1; });
