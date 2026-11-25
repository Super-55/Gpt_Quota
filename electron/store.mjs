import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export { DEFAULT_SETTINGS } from './defaults.mjs';

export class Store {
  constructor(dbPath = ':memory:') {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS file_cache(path TEXT PRIMARY KEY, signature TEXT NOT NULL, offset INTEGER NOT NULL, carry TEXT NOT NULL, state_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
    this.fileSelect = this.db.prepare('SELECT * FROM file_cache WHERE path=?');
    this.fileUpsert = this.db.prepare('INSERT INTO file_cache(path,signature,offset,carry,state_json) VALUES(?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET signature=excluded.signature,offset=excluded.offset,carry=excluded.carry,state_json=excluded.state_json');
  }
  getSettings() { const row = this.db.prepare('SELECT json FROM settings WHERE id=1').get(); return row ? JSON.parse(row.json) : {}; }
  saveSettings(settings) { const merged = { ...this.getSettings(), ...settings }; this.db.prepare('INSERT INTO settings(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(JSON.stringify(merged)); return merged; }
  listFiles() { return this.db.prepare('SELECT path FROM file_cache').all().map(row => row.path); }
  getFile(path) { const row = this.fileSelect.get(path); return row ? { signature: row.signature, offset: row.offset, carry: row.carry, state: JSON.parse(row.state_json) } : null; }
  setFile(path, record) { this.fileUpsert.run(path, record.signature, record.offset, record.carry || '', JSON.stringify(record.state)); }
  removeFile(path) { this.db.prepare('DELETE FROM file_cache WHERE path=?').run(path); }
  getMetadata(key) { const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  setMetadata(key, value) { this.db.prepare('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  close() { this.db.close(); }
}



