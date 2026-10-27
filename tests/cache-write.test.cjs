// Windows-only atomic persistence test. Synthetic data under ignored tests/private.
'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const { browserTransport } = require('../src/external.js');
(async () => {
 if (process.platform !== 'win32') throw new Error('Windows test');
 const privateRoot = path.resolve(__dirname, 'private'); await fs.mkdir(privateRoot, { recursive: true });
 const dir = await fs.mkdtemp(path.join(privateRoot, '纠音保存-'));
 const children = new Set();
 const storage = browserTransport({ app: { exec: async command => {
  const match = /-EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(command); assert(match);
  const child = spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',match[1]], { windowsHide:true, stdio:'ignore' });
  children.add(child); child.on('exit', () => children.delete(child));
  return new Promise((resolve,reject) => { child.once('spawn', () => resolve(true)); child.once('error', reject); });
 } }, fs: {
  exists: async p => { try { await fs.access(p); return true; } catch { return false; } }, readFileText: p => fs.readFile(p,'utf8'),
  writeFile: async (p, blob) => { await fs.writeFile(p, Buffer.from(await blob.arrayBuffer())); return true; },
  remove: async p => { assert.equal(path.dirname(p), dir); await fs.unlink(p); return true; }
 } }, { pluginPath:path.resolve(__dirname,'../src') }).fs;
 try {
  const file = path.join(dir,'1.json'), initial = JSON.stringify({ original:'空', userEdits:[] }), next = JSON.stringify({ original:'空', userEdits:[{ reading:'うみ' }] });
  await storage.atomicWrite(file, initial, null); assert.equal(await fs.readFile(file,'utf8'), initial);
  await storage.atomicWrite(file, next, initial); assert.equal(await fs.readFile(file,'utf8'), next);
  await assert.rejects(storage.atomicWrite(file, initial, initial), /Cache changed/); assert.equal(await fs.readFile(file,'utf8'), next);
  await assert.rejects(storage.atomicWrite(file, 'invalid-json', next)); assert.equal(await fs.readFile(file,'utf8'), next);
  assert.deepEqual(await fs.readdir(dir), ['1.json']);
  console.log('Actual Windows save passed: Unicode paths, atomic replace, concurrent-change rejection, invalid-write protection, one final JSON and helper cleanup.');
 } finally {
  for (const child of children) child.kill();
  for (const name of await fs.readdir(dir)) { const file = path.join(dir,name); assert.equal(path.dirname(file),dir); await fs.unlink(file); }
  await fs.rmdir(dir);
 }
})().catch(e => { console.error(e); process.exitCode = 1; });
