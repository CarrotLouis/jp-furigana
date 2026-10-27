'use strict';
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { create, requestError } = require('../src/external.js');
const search = '<table><tr><td class="searchResult__title"><a href="/lyric/test/">試験曲</a></td><td class="searchResult__artist"><p><a>試験歌手</a></p></td></tr></table>';
const song = '<h2 class="newLyricTitle__main">試験曲</h2><h3><a href="/artist/1">試験歌手</a></h3><div class="lyricBody"><div class="hiragana"><span class="ruby"><span class="rb">空</span><span class="rt">そら</span></span>を見る</div></div>';
const metadata = async () => ({ title: '試験曲', artists: ['試験歌手'] });
const off = { externalProvider: 'utaten', externalAutoRetry: 'off' }, on = { ...off, externalAutoRetry: 'failed' };
const timeout = () => requestError({ curlCode: 28, error: 'curl error 28' });
function fixture(request, retryDelays = [0, 0, 0]) {
	const files = new Map(), states = [];
	const client = create({ request, retryDelays, dataRoot: async () => 'C:/Test', parse: html => new JSDOM(html).window.document,
		fs: { mkdir: async () => true, exists: async p => files.has(p), readFileText: async p => files.get(p), writeFileText: async (p, v) => { files.set(p, v); return true; } },
		onStatus: () => states.push(client.inspect().status) });
	return { client, states };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test) { for (let n = 0; n < 100; n++) { if (test()) return; await sleep(2); } throw new Error('Wait failed'); }
(async () => {
	let calls = 0;
	const a = fixture(async () => { calls++; throw timeout(); });
	await a.client.load('1', metadata, off);
	assert.equal(calls, 1, 'Off must still perform the initial attempt');
	assert.equal(a.client.inspect().loading, false);
	let searches = 0, details = 0;
	const b = fixture(async url => { if (url.includes('/search')) { searches++; return search; } if (++details < 3) throw timeout(); return song; });
	await b.client.load('1', metadata, on);
	assert.equal(searches, 1, 'Retry the detail request instead of restarting a successful search');
	assert.equal(details, 3); assert.equal(b.client.inspect().source, 'utaten');
	assert(b.states.some(s => s.includes('自动重试（2/3）')));
	calls = 0;
	const c = fixture(async () => { calls++; throw timeout(); });
	await c.client.load('1', metadata, on); assert.equal(calls, 4, 'One initial request plus at most three retries');
	assert.equal(c.client.inspect().waitingRetry, false);
	for (const response of [{ status: 403 }, { status: 404 }, { curlCode: 60 }]) {
		calls = 0; const x = fixture(async () => { calls++; throw requestError(response); });
		await x.client.load('1', metadata, on); assert.equal(calls, 1, 'Do not loop on refusal, missing pages or invalid certificates');
	}
	calls = 0; const missing = fixture(async () => { calls++; return '<html></html>'; });
	await missing.client.load('1', metadata, on); assert.equal(calls, 1, 'No matching song is not a transient network error');
	let attempts = 0;
	const d = fixture(async () => { attempts++; throw timeout(); }, [60000, 60000, 60000]);
	const pending = d.client.load('1', metadata, on);
	await until(() => d.client.inspect().waitingRetry);
	d.client.setAutoRetry('off'); await pending;
	assert.equal(attempts, 1, 'Disabling cancels the wait without issuing another initial request');
	assert.equal(d.client.inspect().waitingRetry, false);
	const resumed = d.client.setAutoRetry('failed');
	await until(() => d.client.inspect().waitingRetry);
	d.client.stop(); await resumed;
	assert.equal(attempts, 2, 'Enabling after failure permits a fresh bounded attempt');
	assert.equal(d.client.inspect().songId, null);
	let first = true;
	const e = fixture(async url => { if (first) { first = false; throw timeout(); } return url.includes('/search') ? search : song; }, [60000]);
	const old = e.client.load('1', metadata, on); await until(() => e.client.inspect().waitingRetry);
	await e.client.load('2', metadata, on); await old;
	assert.equal(e.client.inspect().songId, '2'); assert.equal(e.client.inspect().source, 'utaten');
	assert(!e.states.slice(e.states.lastIndexOf('读取外部歌词缓存…') + 1).some(s => s.includes('继续使用网易云')));
	const rateLimit = requestError({ status: 429, retryAfter: '60' });
	assert(rateLimit.retryable); assert.equal(rateLimit.retryAfterMs, 60000);
	calls = 0; const longWait = fixture(async () => { calls++; throw requestError({ status: 503, retryAfter: '600' }); });
	await longWait.client.load('1', metadata, on); assert.equal(calls, 1, 'Do not shorten a server cooldown to fit the retry budget');
	console.log('Retry tests passed: off/initial, detail-only retries, bounded attempts, permanent failures, cancellation, policy changes, track isolation and Retry-After.');
})().catch(error => { console.error(error); process.exitCode = 1; });
