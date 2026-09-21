/* 本地冒烟测试：验证鉴权 + 各模块 CRUD + kv。用法：node scripts/smoke-test.mjs <密码>
 *
 * ⚠️ 清理原则（2026-09-21 修正）
 * 早期版本第 [9] 步是「把 4 个模块的条目全部删掉」，在真实数据库上跑一次
 * 就会把 Vic 自己录入的 todo / 随想 / 单词 / 句子一起清空。已改成
 * **只删本次测试自己创建的条目**（按 id 精确匹配），kv 也只还原原值。
 * 以后不要再写「全表扫删」这种清理逻辑。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const PW = process.argv[2] || process.env.BB_PW;
if (!PW) {
  console.error('缺少登录密码。用法：node scripts/smoke-test.mjs <密码>，或设环境变量 BB_PW。');
  console.error('（之前这里写死了一个开发期默认密码，密码一改就整片假失败，已移除。）');
  process.exit(2);
}
let cookie = '';
let pass = 0;
let fail = 0;

/** 本次测试创建的条目 id，清理时只动这些 */
const created = { todos: [], thoughts: [], words: [], sentences: [] };
let kvOriginal = null;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  [OK]   ${name}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name} ${extra}`);
  }
}

async function req(path, { method = 'GET', body, raw = false, redirect = 'follow' } = {}) {
  const r = await fetch(BASE + path, {
    method,
    redirect,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  for (const c of sc) if (c.startsWith('bb_session=')) cookie = c.split(';')[0];
  if (raw) return { status: r.status, headers: r.headers, body: await r.text() };
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  return { status: r.status, data, headers: r.headers };
}

(async () => {
  console.log('\n[1] 健康检查与未登录拦截');
  let r = await req('/api/health');
  check('health 200', r.status === 200);
  r = await req('/index.html', { redirect: 'manual' });
  check('未登录访问首页被重定向到登录页', r.status === 302 && (r.headers.get('location') || '').includes('login'), `status=${r.status}`);
  r = await req('/api/m/todos');
  check('未登录调 API 返回 401', r.status === 401);

  console.log('\n[2] 登录');
  r = await req('/api/login', { method: 'POST', body: { password: 'wrong-password' } });
  check('错误密码被拒', r.status === 401);
  r = await req('/api/login', { method: 'POST', body: { password: PW } });
  check('正确密码登录成功', r.status === 200 && r.data.ok === true);
  check('拿到会话 cookie', cookie.startsWith('bb_session='));
  r = await req('/index.html');
  check('登录后能取到首页', r.status === 200 && r.data._raw.includes('Billboard'), `status=${r.status}`);

  console.log('\n[3] 模块注册表');
  r = await req('/api/modules');
  const ids = (r.data.modules || []).map((m) => m.id);
  const expectIds = ['todos', 'thoughts', 'words', 'sentences', 'finance', 'dividend'];
  check('模块注册表齐全: ' + ids.join(','), expectIds.every((x) => ids.includes(x)));
  for (const v of ['finance', 'dividend']) {
    check(`${v} 标记为 virtual`, (r.data.modules || []).find((m) => m.id === v)?.virtual === true);
  }

  console.log('\n[4] To-Do CRUD');
  r = await req('/api/m/todos', { method: 'POST', body: { content: '冒烟测试用条目·请勿保留', priority: '高', due_date: '2026-09-30' } });
  const todo = r.data.item;
  if (todo && todo.id > 0) created.todos.push(todo.id);
  check('创建 todo', r.status === 200 && todo && todo.id > 0, JSON.stringify(r.data));
  check('默认 done=0', todo.done === 0);
  r = await req(`/api/m/todos/${todo.id}`, { method: 'PATCH', body: { done: 1 } });
  check('标记完成', r.data.item && r.data.item.done === 1, `status=${r.status} data=${JSON.stringify(r.data)}`);
  r = await req('/api/m/todos?q=冒烟测试用条目');
  check('搜索命中', (r.data.items || []).some((x) => x.id === todo.id));
  r = await req('/api/m/todos?q=zzz绝对不存在的词zzz');
  check('搜索无结果', r.data.items.length === 0);
  r = await req('/api/m/todos?done=1');
  check('按字段过滤', (r.data.items || []).every((x) => x.done === 1) && (r.data.items || []).some((x) => x.id === todo.id));
  r = await req(`/api/m/todos/${todo.id}`, { method: 'DELETE' });
  check('删除', r.data.ok === true && r.data.deleted === 1);
  if (r.data.ok === true) created.todos = created.todos.filter((x) => x !== todo.id);

  console.log('\n[5] 随想 / 单词 / 句子');
  r = await req('/api/m/thoughts', { method: 'POST', body: { content: '冒烟测试用随想·请勿保留', tag: '测试' } });
  check('创建随想', r.status === 200 && r.data.item.id > 0);
  if (r.data.item && r.data.item.id > 0) created.thoughts.push(r.data.item.id);
  r = await req('/api/m/words', { method: 'POST', body: { word: 'smoketestword', phonetic: '/sməʊk/', meaning: 'n. 冒烟测试用词' } });
  const word = r.data.item;
  if (word && word.id > 0) created.words.push(word.id);
  check('创建单词', word && word.word === 'smoketestword');
  r = await req(`/api/m/words/${word.id}`, { method: 'PATCH', body: { mastered: 1 } });
  check('单词标记已掌握', r.data.item.mastered === 1);
  r = await req('/api/m/sentences', { method: 'POST', body: { content: 'Markets can remain irrational longer than you can remain solvent.', kind: '佳句' } });
  if (r.data.item && r.data.item.id > 0) created.sentences.push(r.data.item.id);
  check('创建句子', r.data.item.kind === '佳句');
  r = await req('/api/m/sentences', { method: 'POST', body: { content: '' } });
  if (r.data.item && r.data.item.id > 0) created.sentences.push(r.data.item.id);
  check('空内容仍能插入（校验在前端）', r.status === 200);

  console.log('\n[6] required 校验由前端做，后端写入空串不报错 — 确认列表能取回');
  r = await req('/api/m/sentences?limit=1000');
  check('句子列表可取到本次创建的条目', (r.data.items || []).some((x) => created.sentences.includes(x.id)));

  console.log('\n[7] finance virtual 模块与 kv');
  r = await req('/api/m/finance');
  check('finance 是 virtual 且无占位槽（真数据走 /api/finance）', r.data.virtual === true && (r.data.slots || []).length === 0);
  r = await req('/api/m/finance', { method: 'POST', body: { foo: 1 } });
  check('finance 写入被拒（还没表）', r.status === 400);
  r = await req('/api/kv/finance.draft');
  kvOriginal = r.status === 200 ? (r.data.value ?? null) : null;
  r = await req('/api/kv/finance.draft', { method: 'PUT', body: { value: '想看回撤节奏' } });
  check('kv 写入', r.data.ok === true);
  r = await req('/api/kv/finance.draft');
  check('kv 读回', r.data.value === '想看回撤节奏');

  console.log('\n[8] 导出');
  r = await req('/api/m/todos/export');
  check('导出含 items 数组', Array.isArray(r.data.items));

  console.log('\n[9] 清理测试数据（只删本次创建的条目）');
  let removed = 0;
  for (const m of ['todos', 'thoughts', 'words', 'sentences']) {
    for (const id of created[m]) {
      const d = await req(`/api/m/${m}/${id}`, { method: 'DELETE' });
      if (d.data && d.data.ok === true) removed++;
      else console.log(`  [WARN] ${m}/${id} 未删除：${JSON.stringify(d.data)}`);
    }
  }
  await req('/api/kv/finance.draft', { method: 'PUT', body: { value: kvOriginal == null ? '' : kvOriginal } });
  console.log(`  已清理本次创建的 ${removed} 条，kv 已还原为原值`);

  console.log('\n[10] 退出登录');
  r = await req('/api/logout', { method: 'POST', body: {} });
  check('logout 200', r.status === 200);
  cookie = '';
  r = await req('/api/m/todos');
  check('退出后 API 再变 401', r.status === 401);

  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})();
