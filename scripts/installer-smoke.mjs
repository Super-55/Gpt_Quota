import { _electron as electron } from 'playwright';
import asar from '@electron/asar';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const setup = path.join(root, 'release/installer', `QuotaGlass-Setup-${version}-x64.exe`);
const output = path.join(root, `artifacts/installer-v${version.replaceAll('.', '')}`);
const work = path.join(root, '.cache', `installer-check-${Date.now()}`, '接收者 环境');
const report = { passed: false, at: new Date().toISOString(), version, checks: [], installer: setup,
  method: 'Extract the actual NSIS installer embedded 7z application payload, then run it with a fresh isolated userData and CODEX_HOME. Does not execute installation/uninstallation or change registry/desktop shortcuts. Account polling disabled; only synthetic logs used.' };
await mkdir(output, { recursive: true });
await mkdir(work, { recursive: true });
let app;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function findFile(directory, predicate) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isFile() && predicate(entry.name)) return filename;
    if (entry.isDirectory()) { const found = await findFile(filename, predicate); if (found) return found; }
  }
}
async function sevenZipPath() {
  if (process.env.QUOTA_7ZIP) return process.env.QUOTA_7ZIP;
  const cache = path.join(root, '.cache/builder/7zip@1.0.0');
  for (const entry of await readdir(cache, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const executable = path.join(cache, entry.name, 'bin/7za.exe');
    try { await access(executable); return executable; } catch {}
  }
  throw new Error('No cached 7za.exe available');
}
try {
  const sevenZip = await sevenZipPath();
  const setupFiles = path.join(work, 'installer-files');
  execFileSync(sevenZip, ['x', setup, '-y', `-o${setupFiles}`], { windowsHide: true, stdio: 'pipe' });
  // The minimal builder 7za recognizes the embedded application archive directly;
  // full 7-Zip can instead expose it as an app-64.7z entry in the NSIS container.
  let appDirectory = setupFiles;
  try { await access(path.join(appDirectory, 'Quota Glass.exe')); }
  catch {
    const payload = await findFile(setupFiles, name => /^app-(?:64|x64)\.7z$/.test(name));
    assert.ok(payload, 'offline x64 runtime must be embedded in installer');
    appDirectory = path.join(work, '应用程序');
    execFileSync(sevenZip, ['x', payload, '-y', `-o${appDirectory}`], { windowsHide: true, stdio: 'pipe' });
  }
  report.checks.push('actual NSIS installer contains complete offline x64 payload');
  const archive = path.join(appDirectory, 'resources/app.asar');
  const builtArchive = path.join(root, 'release/installer/win-unpacked/resources/app.asar');
  report.asarSha256 = digest(await readFile(archive));
  assert.equal(report.asarSha256, digest(await readFile(builtArchive)));
  const names = asar.listPackage(archive).map(name => name.replaceAll('\\', '/'));
  assert.ok(names.includes('/assets/QuotaGlass.ico') && names.includes('/assets/QuotaGlass.png'));
  assert.ok(!names.some(name => /(?:^|\/)(?:quota\.sqlite(?:-wal|-shm)?|auth\.json|\.codex|\.cache|artifacts)(?:\/|$)|\.jsonl$/i.test(name)));
  report.checks.push('installer payload matches verified app.asar and includes icons without personal logs/settings/auth');
  const recipientHome = path.join(work, '个人目录');
  const codexHome = version === '0.4.3' ? path.join(recipientHome, '.codex') : path.join(work, '个人 Codex');
  const profile = path.join(work, '用户配置');
  const executable = path.join(appDirectory, 'Quota Glass.exe');
  const errors = [];
  const start = async () => {
    app = await electron.launch({ executablePath: executable, args: [], env: {
      ...process.env, ...(version === '0.4.3' ? { USERPROFILE: recipientHome } : {}),
      CODEX_HOME: codexHome, QUOTA_TEST_USER_DATA: profile,
      QUOTA_DEV_URL: '', QUOTA_TEST_DISABLE_ACCOUNT_POLL: '1'
    }, timeout: 30000 });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.getByTestId('app-ready').waitFor();
    return page;
  };
  let page = await start();
  const native = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, profile: app.getPath('userData') }));
  assert.equal(native.version, version); assert.equal(native.packaged, true);
  assert.equal(path.normalize(native.profile), path.normalize(profile));
  let data = await page.evaluate(() => window.quota.getDashboard());
  assert.equal(data.source, 'local');
  assert.equal(path.normalize(data.settings.sessionsDir), path.join(codexHome, 'sessions'));
  assert.equal(data.summary.lifetime.total, 0); assert.equal(data.quota5h, null);
  report.checks.push('fresh profile opens with local source, recipient CODEX_HOME, zero usage and unknown quota');
  await app.evaluate(async ({ app }, destination) => {
    const icon = await app.getFileIcon(process.execPath, { size: 'large' });
    if (icon.isEmpty()) throw new Error('Missing embedded executable icon');
    process.getBuiltinModule('fs').writeFileSync(destination, icon.toPNG());
  }, path.join(output, 'embedded-app-icon.png'));
  report.checks.push('embedded executable icon loads from extracted application');
  const sessions = path.join(codexHome, 'sessions');
  await mkdir(sessions, { recursive: true });
  const timestamp = new Date().toISOString();
  const record = (type, payload) => JSON.stringify({ timestamp, type, payload });
  const records = [
    record('session_meta', { id: 'recipient-fixture', cwd: path.join(work, '示例项目') }),
    record('turn_context', { model: 'recipient-model', cwd: path.join(work, '示例项目') }),
    record('event_msg', { type: 'token_count', info: { total_token_usage: {
      input_tokens: 1600, cached_input_tokens: 1200, output_tokens: 200, total_tokens: 1800
    } } })
  ];
  await writeFile(path.join(sessions, 'recipient-only.jsonl'), records.join('\n') + '\n');
  data = await page.evaluate(() => window.quota.refresh());
  assert.equal(data.summary.lifetime.total, 1800);
  assert.equal(data.models.find(model => model.name === 'recipient-model')?.lifetime.total, 1800);
  report.checks.push('recipient logs discovered without selecting a developer-specific directory');
  if (version === '0.4.3') {
    const archive = path.join(codexHome, 'archived_sessions');
    await mkdir(archive);
    const historical = new Date(); historical.setDate(historical.getDate() - 60);
    const historicalDay = [historical.getFullYear(), String(historical.getMonth() + 1).padStart(2, '0'), String(historical.getDate()).padStart(2, '0')].join('-');
    const historicalRecords = records.map(line => ({ ...JSON.parse(line), timestamp: historical.toISOString() }));
    historicalRecords[0].payload.id = 'recipient-archive';
    await writeFile(path.join(archive, 'old.jsonl.zst'), zstdCompressSync(historicalRecords.map(entry => JSON.stringify(entry)).join('\n')));
    data = await page.evaluate(() => window.quota.refresh());
    assert.equal(data.days.find(day => day.date === historicalDay)?.total, 1800);
    assert.equal(data.summary.lifetime.total, 3600);
    report.checks.push('embedded Electron reads a Zstandard archived rollout and restores the historical heatmap day');

    const ccSwitch = path.join(recipientHome, '.cc-switch');
    await mkdir(ccSwitch);
    const db = new DatabaseSync(path.join(ccSwitch, 'cc-switch.db'));
    const missing = new Date(historical); missing.setDate(missing.getDate() - 1);
    const missingDay = [missing.getFullYear(), String(missing.getMonth() + 1).padStart(2, '0'), String(missing.getDate()).padStart(2, '0')].join('-');
    try {
      db.exec('CREATE TABLE usage_daily_rollups (date TEXT, app_type TEXT, provider_id TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_creation_tokens INTEGER, input_token_semantics INTEGER)');
      const insert = db.prepare("INSERT INTO usage_daily_rollups VALUES (?, 'codex', '_codex_session', 100, 20, 150, 0, 2)");
      insert.run(missingDay); insert.run(historicalDay);
    } finally { db.close(); }
    data = await page.evaluate(() => window.quota.refresh());
    assert.equal(data.heatmapDays.find(day => day.date === missingDay)?.total, 270);
    assert.equal(data.heatmapDays.find(day => day.date === historicalDay)?.total, 1800);
    assert.equal(data.summary.lifetime.total, 3600);
    await page.getByRole('button', {name: new RegExp(`^${missingDay} `)}).click();
    await page.getByRole('dialog').getByText('CC Switch 的 Codex 每日汇总', {exact: false}).waitFor();
    await page.keyboard.press('Escape');
    report.checks.push('CC Switch daily total fills only the missing heatmap day, with source shown in the UI');
  }
  const expectedTotal = data.summary.lifetime.total;
  for (const [label, id] of [['今日任务', 'page-tasks'], ['用量趋势', 'page-trends'], ['项目排行', 'page-projects'], ['Skill', 'page-skills'], ['模型用量', 'page-models']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByTestId(id).waitFor();
  }
  await page.screenshot({ path: path.join(output, 'recipient-models.png') });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: '设置', exact: true });
  await settingsDialog.waitFor();
  if (version === '0.4.3') {
    const interval = settingsDialog.getByLabel('账户额度刷新');
    assert.equal(await interval.inputValue(), '5');
    assert.deepEqual(await interval.locator('option').allTextContents(), ['5 秒', '10 秒', '30 秒', '1 分钟']);
    await interval.selectOption('30');
    await settingsDialog.getByRole('button', { name: '保存设置' }).click();
    await page.getByRole('button', {name: '用量趋势', exact: true}).click();
    await page.getByTestId('quota-five-hour').getByText('每 30 秒自动更新', { exact: false }).waitFor();
    report.checks.push('quota interval setting presents all four choices and takes effect in the 5h card');
  } else await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  report.checks.push('all five pages and settings work in extracted installed runtime');
  const pinned = await page.evaluate(() => window.quota.saveSettings({ alwaysOnTop: true, theme: 'graphite' }));
  assert.equal(pinned.settings.alwaysOnTop, true);
  const opened = app.waitForEvent('window');
  await page.evaluate(() => window.quota.openCompact());
  const compact = await opened;
  compact.on('pageerror', error => errors.push(error.message));
  await compact.getByTestId('app-ready').waitFor();
  assert.equal((await compact.evaluate(() => window.quota.getDashboard())).summary.lifetime.total, expectedTotal);
  if (version === '0.4.3') await compact.getByTestId('quota-five-hour').getByText('每 30 秒自动更新', { exact: false }).waitFor();
  const compactState = () => app.evaluate(({ BrowserWindow }) => {
    const compactWindow = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('compact=1'));
    return {visible: compactWindow.isVisible(), pinned: compactWindow.isAlwaysOnTop()};
  });
  let nativeState = await compactState();
  for (let attempt = 0; attempt < 10 && !nativeState.pinned; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    nativeState = await compactState();
  }
  assert.equal(nativeState.pinned, true, `compact native state ${JSON.stringify(nativeState)}`);
  report.checks.push('compact window shares recipient data and native always-on-top works');
  await app.close(); app = undefined;
  page = await start();
  data = await page.evaluate(() => window.quota.getDashboard());
  assert.equal(data.summary.lifetime.total, expectedTotal);
  assert.equal(data.settings.theme, 'graphite'); assert.equal(data.settings.alwaysOnTop, true);
  if (version === '0.4.3') assert.equal(data.settings.quotaRefreshSeconds, 30);
  assert.deepEqual(errors, []);
  report.checks.push('recipient settings and cache persist after restart without renderer errors');
  report.installerBytes = (await readFile(setup)).length;
  report.installerSha256 = digest(await readFile(setup));
  report.payloadExecutable = executable;
  report.passed = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  await writeFile(path.join(output, 'installer-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
