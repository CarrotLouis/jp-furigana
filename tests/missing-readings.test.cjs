'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
globalThis.__FURIGANA_DICT_LOADER__ = p => fs.promises.readFile(p).then(b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const kuromoji = require('../src/kuromoji.js'), core = require('../src/furigana.js');
const examples = [
	['それは二人が出會ったあの日まで 遡る', 'so re wa fu ta ri ga de a tta a no hi ma de sa ka no bo ru', { 出會: 'であ' }],
	['それは二人が出会ったあの日まで 遡る', 'so re wa fu ta ri ga de a tta a no hi ma de sa ka no bo ru', { 出会: 'であ' }],
	['凜と蒼く 別離の詩を 戀人を射ち墮とす', 'ri n to a o ku be tsu ri no shi wo re n ni n wo u chi o to su', { 凜: 'りん', 墮: 'お' }],
	['凛と蒼く 別離の詩を 恋人を射ち堕とす', 'ri n to a o ku be tsu ri no shi wo re n ni n wo u chi o to su', { 凛: 'りん', 堕: 'お' }],
	['堕ちる', 'o chi ru', { 堕: 'お' }],
	['墮ちた', 'o chi ta', { 墮: 'お' }],
	['堕落する', 'da ra ku su ru', { 堕落: 'だらく' }],
];
function verifyText(segs, text) {
	assert.equal(segs.map(s => s.text).join(''), text, 'Keep exact original glyphs and whitespace');
	for (const s of segs) if (s.rt) assert.equal(text.slice(s.at, s.at + s.text.length), s.text, 'Ruby offsets remain valid');
	for (let i = 0; i < text.length; i++) if (core.hasKanji(text[i])) {
		assert(segs.some(s => s.rt && s.at <= i && i < s.at + s.text.length), 'No missing kanji reading at ' + text[i]);
	}
}
kuromoji.builder({ dicPath: path.resolve(__dirname, '../src/dict') }).build((error, tokenizer) => {
	try {
		if (error) throw error;
		for (const [text, romaji, expected] of examples) {
			const dict = core.tokensToSegments(core.tokenizeForReading(tokenizer, text));
			verifyText(dict, text);
			for (const [word, reading] of Object.entries(expected)) assert(dict.some(s => s.text === word && s.rt === reading), word + ' dictionary reading');
			const official = core.segmentsFromReading(text, core.romajiToKana(romaji), dict);
			verifyText(official, text);
			for (const [word, reading] of Object.entries(expected)) assert(official.some(s => s.text === word && s.rt === reading), word + ' romaji reading');
			const katakana = core.segmentsFromReading(text, core.romajiToKana(romaji), dict, { kana: 'katakana' });
			verifyText(katakana, text);
			for (const s of katakana) if (s.rt) assert(!/[ぁ-ゖ]/.test(s.rt));
		}
		// The screenshot has an extra "i" in the source romaji. Fix coverage without
		// silently pretending we know a singer's intention; websites can replace it.
		const text = examples[0][0], dict = core.tokensToSegments(core.tokenizeForReading(tokenizer, text));
		verifyText(core.segmentsFromReading(text, core.romajiToKana(examples[0][1].replace('de a tta', 'de a i tta')), dict), text);
		const raw = core.tokensToSegments(tokenizer.tokenize('出會った'));
		const recovered = core.segmentsFromReading('出會った', 'であった', raw);
		assert(recovered.some(s => s.text === '出會' && s.rt === 'であ'), 'Recover a unique reading even from unnormalized tokens');
		const unknown = core.segmentsFromReading('鵺をみる', 'ぬえをみる', [{ text: '鵺をみる' }]);
		assert(unknown.some(s => s.text === '鵺' && s.rt === 'ぬえ'));
		const ambiguous = core.segmentsFromReading('鵺の空', 'ぬえのねのそら', [{ text: '鵺の' }, { text: '空', rt: 'そら', at: 2 }]);
		assert(!ambiguous || !ambiguous.some(s => s.text === '鵺' && s.rt), 'Do not guess ambiguous unknown-word boundaries');
		const noEvidence = core.tokensToSegments([{ surface_form: '鵺', word_type: 'UNKNOWN' }]);
		assert(!noEvidence[0].rt, 'No invented dictionary pronunciation');
		console.log('Missing-reading regression tests passed: screenshot lines, modern/traditional glyphs, dictionary/romaji/katakana, verb context, unknown recovery, ambiguity and exact offsets.');
	} catch (e) { console.error(e); process.exitCode = 1; }
});
