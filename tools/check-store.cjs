// Distribution checks shared by local development and CI. No network or writes.
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), src = path.join(root, 'src');
const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const key of ['name','slug','version','author','author_link','description','preview','betterncm_version']) assert(m[key], 'Missing ' + key);
assert.equal(m.slug, 'jp-furigana-plus'); assert.equal(m.fork_of, 'jp-furigana'); assert.equal(m.version, pkg.version);
assert.equal(m.require_restart, true); assert(!m.native_plugin, 'No bundled native executable');
assert(/^[a-zA-Z0-9_-]+$/.test(m.slug)); assert(/^\d+\.\d+\.\d+$/.test(m.version));
assert(!['force-install','force-update','force-uninstall'].some(k => m[k]), 'No forced market actions');
const image = fs.statSync(path.join(src, m.preview)); assert(image.size <= 200 * 1024, 'Preview must stay small');
for (const n of ['LICENSE','NOTICE.md','LICENSE-kuromoji.txt']) assert(fs.readFileSync(path.join(root,n)).equals(fs.readFileSync(path.join(src,n))), 'License drift: ' + n);
for (const item of m.injects.Main) assert(fs.statSync(path.join(src,item.file)).isFile(), 'Missing injected file');
for (const p of ['README.md','docs/external-lyrics.md','docs/distribution.md']) {
	const text = fs.readFileSync(path.join(root,p),'utf8');
	for (const link of text.matchAll(/\]\(([^)]+)\)/g)) if (!/^https?:|^#/.test(link[1])) assert(fs.existsSync(path.resolve(root,path.dirname(p),link[1].split('#')[0])), 'Broken link: ' + link[1]);
}
const main = fs.readFileSync(path.join(src,'main.js'),'utf8');
assert(main.includes('betterncm.ncm.openUrl')); assert(main.includes('反馈问题')); assert(main.includes('源码仓库'));
console.log('Store checks passed: independent identity, fork attribution, version, restart, small preview, license copies, scripts, support links and documentation.');
