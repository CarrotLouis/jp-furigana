'use strict';
const assert = require('node:assert/strict'), { JSDOM } = require('jsdom');
const core = require('../src/external-core.js'), { create } = require('../src/external.js');
const title = '物凄く狂っとるフランちゃんが物凄いうた';
const spaced = '物凄く狂っとるフランちゃんが 物凄いうた';
const fragments = core.partialTitles(title);
const lyrics = ['青い空を見ながら手紙を書いている', '遠い町へ歩いてゆく明日の朝まで'];
const otherLyrics = ['違う歌の中で朝を待ち続ける', '知らない名前を呼んでみたのです'];
const metadata = async () => ({ title, artists: ['ななひら', '別の歌手'], lyrics });
const settings = { externalProvider: 'utaten', externalAutoRetry: 'failed' };
const row = (name = spaced, artist = 'ななひら', id = 'correct') => `<table><tr><td class="searchResult__title"><a href="/lyric/${id}/">${name}</a></td><td class="searchResult__artist"><p><a>${artist}</a></p></td></tr></table>`;
const page = (artist = 'ななひら', lines = lyrics) => `<h2 class="newLyricTitle__main">${spaced}</h2><h3><a href="/artist/1/">${artist}</a></h3><div class="lyricBody"><div class="hiragana">` + lines.map(text => `<span class="ruby"><span class="rb">${text[0]}</span><span class="rt">あ</span></span>${text.slice(1)}`).join('<br>') + '</div></div>';
const query = url => { const u = new URL(url); return [u.searchParams.get('title'), u.searchParams.get('artist_name')]; };
function fixture(request) {
 const calls = [], files = new Map(), states = [];
 const client = create({ dataRoot: async () => 'C:/Test', retryDelays: [0], parse: html => new JSDOM(html).window.document,
  request: async (...args) => { calls.push(args[0]); return request(...args); },
  fs: { mkdir: async () => true, exists: async p => files.has(p), readFileText: async p => files.get(p), writeFileText: async (p, v) => { files.set(p, v); return true; } },
  onStatus: () => states.push(client.inspect().status) });
 return { client, calls, files, states, queries: () => calls.filter(url => new URL(url).pathname === '/search').map(query) };
}
(async () => {
 assert.equal(core.titleKey(title), core.titleKey(spaced));
 assert.equal(core.titleKey('物凄く　狂っとる フランちゃんが　物凄いうた'), core.titleKey(title));
 assert.notEqual(core.titleKey('Pr ay'), core.titleKey('Pray'));
 assert.notEqual(core.titleKey('PRAY.'), core.titleKey('Pray'));
 assert.notEqual(core.titleKey('日本語 Love Story'), core.titleKey('日本語 LoveStory'));
 assert.equal(fragments.length, 2);
 assert(fragments.every(part => part.length >= 6 && part.length <= 10 && title.includes(part)));
 assert(fragments[0].length + fragments[1].length <= Array.from(title).length, 'Japanese fragments do not overlap');
 assert.deepEqual(core.partialTitles('Pray'), []);
 assert.deepEqual(core.partialTitles('短い曲名'), []);
 assert.deepEqual(core.partialTitles('Lil’ Goldfish'), ['Goldfish']);
 assert.deepEqual(core.partialTitles('Lil\' Goldfish (Cover)'), ['Goldfish']);

 const direct = fixture(async url => url.includes('/search') ? row() : page());
 await direct.client.load('1', metadata, settings);
 assert.equal(direct.calls.length, 2, 'Full-title success issues no partial query');

 const artistPartial = fixture(async url => {
  if (!url.includes('/search')) return page();
  const [term, artist] = query(url);
  return term === fragments[0] && artist === 'ななひら' ? row() : '<table></table>';
 });
 await artistPartial.client.load('2', metadata, settings);
 assert.equal(artistPartial.client.inspect().source, 'utaten');
 assert.deepEqual(artistPartial.queries(), [[title, 'ななひら'], [fragments[0], 'ななひら']]);

 const secondArtist = fixture(async url => {
  if (!url.includes('/search')) return page('別の歌手');
  const [term, artist] = query(url);
  return term === title && artist === '別の歌手' ? row(spaced, artist) : '<table></table>';
 });
 await secondArtist.client.load('3', metadata, settings);
 assert.equal(secondArtist.client.inspect().source, 'utaten');
 const strictOrder = [[title, 'ななひら'], ...fragments.map(part => [part, 'ななひら']), [title, '別の歌手']];
 assert.deepEqual(secondArtist.queries(), strictOrder, 'Only the first artist gets the partial-query stage before artist rotation');

 const titlePartial = fixture(async url => {
  if (!url.includes('/search')) return page('別表記');
  const [term, artist] = query(url);
  if (artist !== null) return '<table></table>';
  if (term === fragments[0]) return row(fragments[0] + 'という別の曲', '別表記', 'excluded');
  if (term === fragments[1]) return row(spaced, '別表記');
  return '<table></table>';
 });
 await titlePartial.client.load('4', metadata, settings);
 assert.equal(titlePartial.client.inspect().source, 'utaten');
 const allQueries = [...strictOrder, [title, null], ...fragments.map(part => [part, null])];
 assert.deepEqual(titlePartial.queries(), allQueries);
 assert(!titlePartial.calls.some(url => url.includes('/excluded/')), 'Partial substring hits still require the complete title');
 assert(!titlePartial.states.some(s => s.includes('自动重试')), 'All stages belong to one attempt');

 const missing = fixture(async () => '<table></table>');
 await missing.client.load('5', metadata, settings);
 assert.deepEqual(missing.queries(), allQueries);
 assert.match(missing.client.inspect().error, /未找到同名歌曲/);
 assert(!missing.client.inspect().loading);
 assert(missing.client.inspect().manualSearch);
 assert.equal(missing.files.size, 0);
 assert(!missing.states.some(s => s.includes('自动重试')), 'A valid zero-result search is not a network retry');

 const details = [];
 const laterMatch = fixture(async url => {
  if (!url.includes('/search')) { details.push(new URL(url).pathname); return url.includes('/wrong/') ? page('別表記', otherLyrics) : page('別表記'); }
  const [term, artist] = query(url);
  if (artist !== null) return '<table></table>';
  if (new URL(url).searchParams.get('page') === '2') return row(spaced, '別表記');
  if (term === title) return row(spaced, '別表記', 'wrong');
  if (term === fragments[0]) return '<link rel="next" href="/search?title=' + encodeURIComponent(term) + '&page=2">' + row(spaced, '別表記', 'wrong');
  return row(spaced, '別表記');
 });
 await laterMatch.client.load('6', metadata, settings);
 assert.equal(laterMatch.client.inspect().source, 'utaten');
 assert.deepEqual(details, ['/lyric/wrong/', '/lyric/correct/'], 'Fallback paginates and never refetches duplicate details');

 let failed = false;
 const retry = fixture(async url => {
  if (!url.includes('/search')) return page();
  if (query(url)[0] !== fragments[0]) return '<table></table>';
  if (!failed) { failed = true; const error = new Error('HTTP 503'); error.retryable = true; throw error; }
  return row();
 });
 await retry.client.load('7', metadata, settings);
 assert.equal(retry.client.inspect().source, 'utaten');
 assert.deepEqual(retry.queries(), [[title, 'ななひら'], [fragments[0], 'ななひら'], [title, 'ななひら'], [fragments[0], 'ななひら']]);

 const cancelled = fixture(async () => { if (cancelled.calls.length === 2) cancelled.client.cancelFetch(); return '<table></table>'; });
 await cancelled.client.load('8', metadata, settings);
 assert.equal(cancelled.calls.length, 2, 'Cancel during a partial search prevents subsequent requests');
 assert.equal(cancelled.files.size, 0);

 const utanet = fixture(async () => '<table></table>');
 await utanet.client.load('9', metadata, { ...settings, externalProvider: 'utanet' });
 assert.equal(utanet.calls.length, 1, 'Uta-Net retains its existing workflow');
 console.log('Partial-title search passed: Japanese spaces, bounded fragments, exact query order, full-title guards, lyric evidence, pagination, deduplication, cancellation and retry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
