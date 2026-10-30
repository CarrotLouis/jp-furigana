// Opt-in Windows smoke test. Fetches named songs; keeps copyrighted HTML/cache private.
// Run: node tools/test-external-live.cjs
// --diagnose records each provider's availability, including automatic fallback,
// without aborting at the first website outage. It skips the slower proxy test.
'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), net = require('node:net');
const { JSDOM } = require('jsdom');
const core = require('../src/external-core.js'), clientModule = require('../src/external.js');
const screenshot = require('../tests/fixtures/utaten-confusions.cjs');
const privateRoot = path.resolve(__dirname, '../tests/private');
const activeChildren = new Set(), sockets = new Set();
let count = 0;
const diagnose = process.argv.includes('--diagnose');
const utatenOnly = process.argv.includes('--utaten');
const bn = {
	app: {
		getDataPath: async () => privateRoot,
		exec: async command => {
			const match = /^powershell\.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(command);
			assert(match, 'Only the declared one-shot helper may execute');
			const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', match[1]], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
			activeChildren.add(child); let error = '';
			child.stderr.on('data', data => { error += data.toString(); });
			child.on('exit', code => { activeChildren.delete(child); if (code) console.error('Helper exit', code, error.slice(0,600)); });
			return new Promise((resolve, reject) => { child.once('spawn', () => resolve(true)); child.once('error', reject); });
		}
	},
	fs: {
		mkdir: async p => { await fs.mkdir(p, { recursive: true }); return true; },
		exists: async p => { try { await fs.access(p); return true; } catch (_) { return false; } },
		readFileText: p => fs.readFile(p, 'utf8'),
		writeFileText: async (p, text) => { await fs.writeFile(p, text, 'utf8'); return true; },
		writeFile: async (p, blob) => { await fs.writeFile(p, Buffer.from(await blob.arrayBuffer())); return true; },
		remove: async p => { assert(/^request-[a-f0-9]{32}\.json(?:\.(?:partial|cancel))?$|^\d{1,20}\.json\.write-[a-f0-9]{32}(?:\.result)?$/.test(path.basename(p))); await fs.unlink(p); return true; }
	}
};
const transport = clientModule.browserTransport(bn, { pluginPath: path.resolve(__dirname, '../src') }, { parse: html => new JSDOM(html).window.document });
const measuredRequest = async (...args) => {
	count++; const start = performance.now();
	try {
		const html = await transport.request(...args);
		console.log(JSON.stringify({ request: new URL(args[0]).hostname + new URL(args[0]).pathname, milliseconds: Math.round(performance.now() - start), bytes: Buffer.byteLength(html) }));
		return html;
	} catch (error) {
		console.log(JSON.stringify({ request: new URL(args[0]).hostname + new URL(args[0]).pathname, milliseconds: Math.round(performance.now() - start), error: error.message }));
		throw error;
	}
};
const tracks = [
	{ id: '990000001', title: '恋人を射ち堕とした日', artists: ['Sound Horizon'] },
	{ id: '990000002', title: 'know me...', artists: ['八木海莉'] }
];
if (utatenOnly) tracks.push({ id: '990000004', title: '残酷な天使のテーゼ', artists: ['高橋洋子'] });
async function testProviders() {
	const report = [];
	for (const provider of utatenOnly ? ['utaten'] : diagnose ? ['utaten', 'utanet', 'auto'] : ['utaten', 'utanet']) for (const track of tracks) {
		const client = clientModule.create({ ...transport, request: measuredRequest });
		const start = performance.now();
		await client.load(track.id, async () => track, { externalProvider: provider }, true);
		const status = client.inspect();
		if (diagnose && (!status.ready || status.error)) { report.push({ provider, title: track.title, ok: false, milliseconds: Math.round(performance.now() - start), error: status.error || status.status }); continue; }
		if (provider === 'auto') assert(['utaten', 'utanet'].includes(status.source), status.status);
		else assert.equal(status.source, provider, status.status);
		if (provider === 'utaten' && track.id === tracks[0].id) {
			const segs = client.segments('凜と蒼く 別離の詩を 戀人を射ち墮とす', 'hiragana');
			assert(segs && segs.some(s => s.text === '戀人' && s.rt === 'あなた'), 'User-provided traditional text should align to the website ruby');
			const corrected = client.segments(screenshot.target, 'hiragana');
			assert(corrected && corrected.map(s => s.text).join('') === screenshot.target);
			assert(corrected.some(s => s.text === '沖動' && s.rt === 'しょうどう'));
			assert(corrected.some(s => s.text === '暗' && s.rt === 'やみ'));
		}
		const ms = Math.round(performance.now() - start), before = count, cacheStart = performance.now();
		await client.load(track.id, () => { throw new Error('Cached songs should not need metadata'); }, { externalProvider: provider });
		assert.equal(count, before);
		if (provider === 'utaten' && track.id === tracks[0].id) {
			assert(client.segments(screenshot.target, 'hiragana').some(s => s.text === '暗' && s.rt === 'やみ'), 'Existing schema-1 caches use the repaired matching too');
		}
		report.push({ provider, source: status.source, title: track.title, ok: true, milliseconds: ms, cacheMilliseconds: Math.round(performance.now() - cacheStart), cacheNetworkRequests: count - before });
		if (provider === 'utaten' && track.id === tracks[0].id) {
			const stored = JSON.parse(await fs.readFile(path.join(privateRoot, 'lyrics/jp-furigana/' + track.id + '.json'), 'utf8'));
			const relaxed = clientModule.create({ ...transport, request: measuredRequest });
			const alternate = { ...track, artists: ['サウンドホライズン'], lyrics: stored.lines.map(l => l.text) };
			const startRelaxed = performance.now(), beforeRelaxed = count;
			await relaxed.load('990000003', async () => alternate, { externalProvider: 'utaten' }, true);
			assert.equal(relaxed.inspect().source, 'utaten', relaxed.inspect().status);
			assert.equal(relaxed.inspect().url, stored.url);
			report.push({ provider, mode: 'title-only-and-lyric-evidence', milliseconds: Math.round(performance.now() - startRelaxed), requests: count - beforeRelaxed });
		}
	}
	return report;
}
async function testProxy() {
	let connects = 0;
	let mode = 'normal';
	const delays = new Set();
	const server = net.createServer(socket => {
		sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
		let buffer = Buffer.alloc(0);
		const read = chunk => {
			buffer = Buffer.concat([buffer, chunk]);
			const end = buffer.indexOf('\r\n\r\n');
			if (end < 0) { if (buffer.length > 4096) socket.destroy(); return; }
			socket.removeListener('data', read);
			if (!/^CONNECT utaten\.com:443 HTTP\/1\.[01]\r\n/.test(buffer.toString('ascii'))) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
			connects++;
			if (mode === 'stall') return; // Exercise real cancellation while curl is connecting.
			const upstream = net.connect(443, 'utaten.com', () => {
				const forward = () => {
					socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
					if (buffer.length > end + 4) upstream.write(buffer.subarray(end + 4));
					socket.pipe(upstream); upstream.pipe(socket);
				};
				if (mode === 'slow') { const timer = setTimeout(() => { delays.delete(timer); forward(); }, 6200); delays.add(timer); }
				else forward();
			});
			sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
			upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy());
		};
		socket.on('data', read);
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const html = await measuredRequest('https://utaten.com/lyric/jb50812046/', 'http://127.0.0.1:' + server.address().port);
		assert(core.parseUtaten(transport.parse(html), 'https://utaten.com/lyric/jb50812046/').lines.length > 0);
		assert(connects > 0, 'Request must actually traverse the configured proxy');
		mode = 'slow'; const slowStart = performance.now();
		const slow = await measuredRequest('https://utaten.com/lyric/jb50812046/', 'http://127.0.0.1:' + server.address().port);
		assert(core.parseUtaten(transport.parse(slow), 'https://utaten.com/lyric/jb50812046/').lines.length > 0);
		const slowMs = Math.round(performance.now() - slowStart);
		assert(slowMs >= 6200, 'The delayed proxy must exceed the old five-second connection budget');
		mode = 'stall'; const before = connects; let cancelled = false;
		const stalled = measuredRequest('https://utaten.com/lyric/jb50812046/', 'http://127.0.0.1:' + server.address().port, () => cancelled);
		const assertion = assert.rejects(stalled, /已取消/);
		const deadline = Date.now() + 10000;
		while (connects === before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
		assert(connects > before); const cancelStart = performance.now(); cancelled = true;
		await assertion; const cancelMs = Math.round(performance.now() - cancelStart);
		assert(cancelMs < 5000, 'Cancelling should kill the blocked curl, not wait for its timeout');
		const leftovers = await fs.readdir(path.join(privateRoot, 'lyrics/jp-furigana/requests'));
		assert(!leftovers.some(name => /\.(cancel|headers|partial)$/.test(name)), 'Cancellation sidecars must be cleaned');
		return { protocol: 'HTTP CONNECT', successfulConnections: connects - 1, delayedConnectMilliseconds: slowMs, cancelledRequestMilliseconds: cancelMs };
	} finally { for (const timer of delays) clearTimeout(timer); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}
(async () => {
	if (process.platform !== 'win32') throw new Error('Windows is required for the actual transport smoke test');
	await fs.mkdir(privateRoot, { recursive: true });
	const providers = await testProviders();
	const proxy = diagnose || utatenOnly ? { skipped: true } : await testProxy();
	const report = { providers, proxy, requests: count };
	await fs.writeFile(path.join(privateRoot, 'live-report.json'), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { for (const child of activeChildren) child.kill(); });
