import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './config.js';

const MODULE_DIR = path.join(ROOT, 'modules');

/**
 * 模块注册表：扫描 modules/ 目录下所有 .js 文件。
 * 想加新分区？往 modules/ 里丢一个 .js + 往 public/js/modules/ 里丢一个同名 .js，重启即可。
 */
export async function loadModules() {
  const files = fs
    .readdirSync(MODULE_DIR)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_') && !f.startsWith('.'))
    .sort();

  const mods = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(path.join(MODULE_DIR, f)).href)).default;
    if (!mod || !mod.id) {
      console.warn(`[billboard] 跳过无效模块文件: ${f}`);
      continue;
    }
    mods.push(mod);
  }
  mods.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return mods;
}

export function findModule(mods, id) {
  return mods.find((m) => m.id === id);
}

/** 给前端的元信息（字段 schema + 展示配置），不含任何数据 */
export function publicMeta(mods) {
  return mods.map((m) => ({
    id: m.id,
    name: m.name,
    icon: m.icon || '',
    desc: m.desc || '',
    virtual: !!m.virtual,
    fields: m.fields || [],
    orderBy: m.orderBy || 'created_at DESC',
    searchFields: (m.fields || []).filter((f) => f.search).map((f) => f.key),
    quickAdd: !!m.quickAdd,
    slots: m.slots || [],
  }));
}
