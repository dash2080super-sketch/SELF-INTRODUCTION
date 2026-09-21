import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

let db = null;

export function initDB(modules) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);

  // WAL 提升并发读写；FULL 保证断电/强杀时不丢数据（数据量小，性能无感）
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');

  // 通用键值表：给 finance 这类"还没想好结构"的模块预留草稿位
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  for (const mod of modules) {
    if (mod.ddl) db.exec(mod.ddl);
  }
  return db;
}

export function getDB() {
  if (!db) throw new Error('数据库尚未初始化');
  return db;
}
