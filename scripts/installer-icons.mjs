import * as resedit from 'resedit';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd(), out = path.join(root, 'artifacts/installer-v042');
const hash = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
// ICO and PE icon-group headers encode a 256px dimension as a zero byte.
const describe = icons => icons.map(icon => ({ width: icon.width || 256, height: icon.height || 256, sha256: hash(icon.bin) }))
  .sort((a, b) => a.width - b.width || a.height - b.height);
const report = { passed: false, at: new Date().toISOString(), checks: [] };
try {
  const reference = describe(resedit.Data.IconFile.from(await readFile(path.join(root, 'assets/QuotaGlass.ico'))).icons.map(item => item.data));
  assert.deepEqual(reference.map(item => item.width), [16, 24, 32, 48, 64, 128, 256]);
  const runtime = JSON.parse(await readFile(path.join(out, 'installer-report.json'), 'utf8'));
  for (const executable of [
    path.join(root, 'release/installer/win-unpacked/Quota Glass.exe'),
    runtime.installer, runtime.payloadExecutable
  ]) {
    const resource = resedit.NtExecutableResource.from(resedit.NtExecutable.from(await readFile(executable)));
    const groups = resedit.Resource.IconGroupEntry.fromEntries(resource.entries);
    assert.ok(groups.length > 0, 'executable must contain icon groups');
    assert.ok(groups.some(group => JSON.stringify(describe(group.getIconItemsFromEntries(resource.entries))) === JSON.stringify(reference)), 'all seven embedded icons must match the custom ICO byte for byte');
    report.checks.push({ executable, sizes: reference.map(item => item.width), matched: true });
  }
  report.passed = true;
} catch (error) { report.error = error.stack || String(error); process.exitCode = 1; }
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'icon-resource-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
