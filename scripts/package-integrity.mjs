import asar from '@electron/asar';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const archive = path.resolve(process.env.QUOTA_ASAR || path.join(root, 'release/win-unpacked/resources/app.asar'));
const report = { passed: false, at: new Date().toISOString(), files: [], mismatches: [] };
async function checkDirectory(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await checkDirectory(relative);
    else if (entry.isFile()) {
      const source = await readFile(path.join(root, relative));
      const packed = asar.extractFile(archive, path.normalize(relative));
      if (!source.equals(packed)) report.mismatches.push(relative);
      report.files.push(relative);
    }
  }
}
try {
  for (const directory of ['electron', 'shared', 'dist', 'assets']) await checkDirectory(directory);
  const sourcePackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const packedPackage = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(packedPackage.version, sourcePackage.version);
  assert.equal(packedPackage.main, sourcePackage.main);
  assert.deepEqual(report.mismatches, [], 'all application files must match the tested source');
  report.version = packedPackage.version;
  report.asarSha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  const reportPath = path.resolve(process.env.QUOTA_INTEGRITY_REPORT || path.join(root, 'artifacts/package-integrity-report.json'));
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
