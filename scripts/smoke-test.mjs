/* 本地冒烟测试：验证鉴权 + 各模块 CRUD + kv。用法：node scripts/smoke-test.mjs <密码> */
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const PW = process.argv[2] || 'testpass123';
let cookie = '';
let pass = 0;
let fail = 0;

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
  check('返回 5 个模块: ' + ids.join(','), ids.length === 5);
  check('finance 标记为 virtual', (r.data.modules || []).find((m) => m.id === 'finance')?.virtual === true);

  console.log('\n[4] To-Do CRUD');
  r = await req('/api/m/todos', { method: 'POST', body: { content: '给房东转房租', priority: '高', due_date: '2026-09-30' } });
  const todo = r.data.item;
  check('创建 todo', r.status === 200 && todo && todo.id > 0, JSON.stringify(r.data));
  check('默认 done=0', todo.done === 0);
  r = await req(`/api/m/todos/${todo.id}`, { method: 'PATCH', body: { done: 1 } });
  check('标记完成', r.data.item && r.data.item.done === 1, `status=${r.status} data=${JSON.stringify(r.data)}`);
  r = await req('/api/m/todos?q=房租');
  check('搜索命中', r.data.items.length === 1);
  r = await req('/api/m/todos?q=不存在的词');
  check('搜索无结果', r.data.items.length === 0);
  r = await req('/api/m/todos?done=1');
  check('按字段过滤', r.data.items.length === 1);
  r = await req(`/api/m/todos/${todo.id}`, { method: 'DELETE' });
  check('删除', r.data.ok === true && r.data.deleted === 1);

  console.log('\n[5] 随想 / 单词 / 句子');
  r = await req('/api/m/thoughts', { method: 'POST', body: { content: '今天想到一个加仓节奏的点子', tag: '投资' } });
  check('创建随想', r.status === 200 && r.data.item.id > 0);
  r = await req('/api/m/words', { method: 'POST', body: { word: 'resilient', phonetic: '/rɪˈzɪliənt/', meaning: 'adj. 有韧性的' } });
  const word = r.data.item;
  check('创建单词', word && word.word === 'resilient');
  r = await req(`/api/m/words/${word.id}`, { method: 'PATCH', body: { mastered: 1 } });
  check('单词标记已掌握', r.data.item.mastered === 1);
  r = await req('/api/m/sentences', { method: 'POST', body: { content: 'Markets can remain irrational longer than you can remain solvent.', kind: '佳句' } });
  check('创建句子', r.data.item.kind === '佳句');
  r = await req('/api/m/sentences', { method: 'POST', body: { content: '' } });
  check('空内容仍能插入（校验在前端）', r.status === 200);

  console.log('\n[6] required 校验由前端做，后端写入空串不报错 — 确认列表能取回');
  r = await req('/api/m/sentences');
  check('句子列表可取', r.data.items.length >= 1);

  console.log('\n[7] finance virtual 模块与 kv');
  r = await req('/api/m/finance');
  check('finance 返回 slots', (r.data.slots || []).length === 4);
  r = await req('/api/m/finance', { method: 'POST', body: { foo: 1 } });
  check('finance 写入被拒（还没表）', r.status === 400);
  r = await req('/api/kv/finance.draft', { method: 'PUT', body: { value: '想看回撤节奏' } });
  check('kv 写入', r.data.ok === true);
  r = await req('/api/kv/finance.draft');
  check('kv 读回', r.data.value === '想看回撤节奏');

  console.log('\n[8] 导出');
  r = await req('/api/m/todos/export');
  check('导出含 items 数组', Array.isArray(r.data.items));

  console.log('\n[9] 清理测试数据');
  for (const m of ['todos', 'thoughts', 'words', 'sentences']) {
    const list = await req(`/api/m/${m}?limit=1000`);
    for (const it of list.data.items) await req(`/api/m/${m}/${it.id}`, { method: 'DELETE' });
  }
  await req('/api/kv/finance.draft', { method: 'PUT', body: { value: '' } });
  console.log('  已清空');

  console.log('\n[10] 退出登录');
  r = await req('/api/logout', { method: 'POST', body: {} });
  check('logout 200', r.status === 200);
  cookie = '';
  r = await req('/api/m/todos');
  check('退出后 API 再变 401', r.status === 401);

  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})();
