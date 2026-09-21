/* Billboard 前端框架：负责登录态、模块导航、通用列表与表单。
   各模块的"长得什么样"由 public/js/modules/<id>.js 决定，没有就用默认渲染。 */

const state = {
  modules: [],
  current: null,
  renderers: new Map(),
  cache: new Map(), // moduleId -> items
};

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtTime(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d)) return String(s);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    location.href = '/login.html';
    throw new Error('unauthorized');
  }
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!r.ok) throw new Error(data.error || `请求失败 (${r.status})`);
  return data;
}

const apiHelpers = {
  list: (id, q) => api('GET', `/api/m/${id}` + (q ? `?q=${encodeURIComponent(q)}` : '')),
  create: (id, body) => api('POST', `/api/m/${id}`, body),
  update: (id, itemId, body) => api('PATCH', `/api/m/${id}/${itemId}`, body),
  remove: (id, itemId) => api('DELETE', `/api/m/${id}/${itemId}`),
  kvGet: (k) => api('GET', `/api/kv/${k}`),
  kvSet: (k, v) => api('PUT', `/api/kv/${k}`, { value: v }),
  load: (id) => api('GET', `/api/m/${id}?limit=500`),
};

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

/* ---------------- 模块渲染器注册 ---------------- */
const renderers = new Map();
window.Billboard = {
  register(id, impl) {
    renderers.set(id, impl);
  },
  esc,
  fmtTime,
  toast,
  api: apiHelpers,
};

/* ---------------- 导航 ---------------- */
function buildTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  for (const m of state.modules) {
    const b = el('button', 'tab', `${esc(m.icon)} ${esc(m.name)}`);
    b.dataset.id = m.id;
    b.onclick = () => switchTo(m.id);
    tabs.appendChild(b);
  }
}

async function loadRenderer(id) {
  if (renderers.has(id)) return renderers.get(id);
  try {
    await import(`/js/modules/${id}.js`);
  } catch (e) {
    console.warn(`模块 ${id} 没有前端渲染器，使用默认`, e);
  }
  return renderers.get(id) || null;
}

async function switchTo(id) {
  state.current = id;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.id === id));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.id === id));
  location.hash = id;

  const panel = document.querySelector(`.panel[data-id="${id}"]`);
  if (panel.dataset.ready) return;

  const mod = state.modules.find((m) => m.id === id);
  const r = await loadRenderer(id);
  const ctx = { mod, panel, api: apiHelpers, toast, esc, fmtTime, refresh: () => refresh(mod, panel, r) };

  if (r && typeof r.mount === 'function') {
    panel.innerHTML = '';
    await r.mount(ctx);
  } else {
    buildDefaultPanel(mod, panel, r);
  }
  panel.dataset.ready = '1';
  if (!r || !r.mount) refresh(mod, panel, r);
}

/* ---------------- 默认面板（列表 + 快速添加 + 搜索） ---------------- */
function buildDefaultPanel(mod, panel, r) {
  panel.innerHTML = '';
  const head = el('div', 'panel-head');
  head.innerHTML = `<h2>${esc(mod.name)}</h2><span class="desc">${esc(mod.desc || '')}</span><div class="grow"></div>`;

  const exportBtn = el('button', 'ghost', '导出 JSON');
  exportBtn.onclick = async () => {
    const data = await api('GET', `/api/m/${mod.id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${mod.id}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  head.appendChild(exportBtn);
  panel.appendChild(head);

  const bar = el('div', 'quickbar');
  if (mod.quickAdd) {
    const main = (mod.fields || []).find((f) => f.required) || (mod.fields || [])[0];
    if (main) {
      const inp = el('input');
      inp.placeholder = main.placeholder || `快速添加：${main.label}（回车保存）`;
      inp.onkeydown = async (e) => {
        if (e.key !== 'Enter') return;
        const v = inp.value.trim();
        if (!v) return;
        try {
          await apiHelpers.create(mod.id, { [main.key]: v });
          inp.value = '';
          refresh(mod, panel, r);
          toast('已添加');
        } catch (err) {
          toast(err.message);
        }
      };
      bar.appendChild(inp);
    }
  }
  const addBtn = el('button', 'primary', '+ 完整添加');
  addBtn.onclick = () => openForm(mod, null, () => refresh(mod, panel, r));
  bar.appendChild(addBtn);

  const search = el('input', 'search');
  search.placeholder = '搜索…';
  let timer;
  search.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => refresh(mod, panel, r, search.value.trim()), 250);
  };
  bar.appendChild(search);
  panel.appendChild(bar);

  const list = el('div', 'list');
  list.id = `list-${mod.id}`;
  panel.appendChild(list);
}

async function refresh(mod, panel, r, q = '') {
  const list = panel.querySelector('.list') || $(`#list-${mod.id}`);
  if (!list) return;
  try {
    const { items } = await apiHelpers.list(mod.id, q);
    state.cache.set(mod.id, items);
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el('div', 'empty', '还没有内容。上面那一栏，敲完回车就存下了。'));
      return;
    }
    for (const item of items) {
      const node = el('div', 'item');
      if (item.done || item.mastered) node.classList.add('done');
      const html = r && r.renderItem ? r.renderItem(item, { esc, fmtTime }) : defaultRender(mod, item);
      node.innerHTML = html;
      node.onclick = (e) => {
        const act = e.target.closest('[data-act]');
        if (act) {
          e.stopPropagation();
          handleAct(act, mod, item, () => refresh(mod, panel, r, q));
          return;
        }
        if (r && r.itemClick && r.itemClick(item) === false) return;
        openForm(mod, item, () => refresh(mod, panel, r, q));
      };
      list.appendChild(node);
    }
  } catch (err) {
    toast(err.message);
  }
}

async function handleAct(node, mod, item, done) {
  const field = node.dataset.field;
  if (node.dataset.act === 'toggle') {
    try {
      await apiHelpers.update(mod.id, item.id, { [field]: item[field] ? 0 : 1 });
      done();
    } catch (e) {
      toast(e.message);
    }
  }
}

function defaultRender(mod, item) {
  const f = mod.fields || [];
  const title = f.find((x) => x.search) || f[0];
  const sub = f.filter((x) => x.type === 'textarea' && x !== title)[0];
  const rest = f.filter((x) => x !== title && x !== sub && item[x.key]);
  return (
    `<div class="item-title">${esc(item[title.key])}</div>` +
    (sub && item[sub.key] ? `<div class="item-sub">${esc(item[sub.key])}</div>` : '') +
    `<div class="item-meta">` +
    rest.map((x) => `<span class="chip">${esc(x.label)}：${esc(item[x.key])}</span>`).join('') +
    `<span class="chip">${fmtTime(item.created_at)}</span></div>`
  );
}

/* ---------------- 表单弹窗 ---------------- */
let formCtx = null;

export function openForm(mod, item, onDone) {
  const modal = $('#modal');
  const body = $('#modal-body');
  $('#modal-title').textContent = (item ? '编辑' : '新建') + ' · ' + mod.name;
  $('#modal-del').style.display = item ? '' : 'none';
  body.innerHTML = '';

  for (const f of mod.fields || []) {
    const wrap = el('div', 'field');
    if (f.type === 'boolean') {
      wrap.innerHTML = `<label class="check"><input type="checkbox" data-k="${f.key}" ${
        item?.[f.key] ? 'checked' : ''
      }> ${esc(f.label)}</label>`;
    } else if (f.type === 'select') {
      wrap.innerHTML = `<label>${esc(f.label)}</label><select data-k="${f.key}">${(f.options || [])
        .map(
          (o) =>
            `<option value="${esc(o)}" ${String(item?.[f.key] ?? f.default ?? '') === String(o) ? 'selected' : ''}>${esc(
              o
            )}</option>`
        )
        .join('')}</select>`;
    } else if (f.type === 'textarea') {
      wrap.innerHTML = `<label>${esc(f.label)}</label><textarea data-k="${f.key}" rows="3" placeholder="${esc(
        f.placeholder || ''
      )}">${esc(item?.[f.key] ?? '')}</textarea>`;
    } else {
      wrap.innerHTML = `<label>${esc(f.label)}</label><input type="${f.type === 'date' ? 'date' : 'text'}" data-k="${
        f.key
      }" value="${esc(item?.[f.key] ?? f.default ?? '')}" placeholder="${esc(f.placeholder || '')}">`;
    }
    body.appendChild(wrap);
  }
  const meta = el('div', 'item-meta');
  meta.innerHTML = item ? `<span class="chip">创建于 ${fmtTime(item.created_at)}</span>` : '';
  body.appendChild(meta);

  formCtx = { mod, item, onDone };
  modal.hidden = false;
  const first = body.querySelector('input:not([type=checkbox]),textarea');
  if (first) first.focus();
}

function collectForm() {
  const body = $('#modal-body');
  const out = {};
  body.querySelectorAll('[data-k]').forEach((n) => {
    const k = n.dataset.k;
    out[k] = n.type === 'checkbox' ? (n.checked ? 1 : 0) : n.value;
  });
  return out;
}

function closeForm() {
  $('#modal').hidden = true;
  formCtx = null;
}

/* ---------------- 启动 ---------------- */
async function boot() {
  let data;
  try {
    data = await api('GET', '/api/modules');
  } catch {
    location.href = '/login.html';
    return;
  }
  state.modules = data.modules;
  buildTabs();

  const main = $('#main');
  for (const m of state.modules) {
    const p = el('div', 'panel');
    p.dataset.id = m.id;
    main.appendChild(p);
  }

  $('#modal-close').onclick = closeForm;
  $('#modal-cancel').onclick = closeForm;
  $('#modal').onclick = (e) => {
    if (e.target.id === 'modal') closeForm();
  };
  $('#modal-save').onclick = async () => {
    if (!formCtx) return;
    const { mod, item, onDone } = formCtx;
    const values = collectForm();
    const missing = (mod.fields || []).find((f) => f.required && !String(values[f.key] ?? '').trim());
    if (missing) return toast(`「${missing.label}」不能为空`);
    try {
      if (item) await apiHelpers.update(mod.id, item.id, values);
      else await apiHelpers.create(mod.id, values);
      closeForm();
      toast(item ? '已保存' : '已添加');
      onDone && onDone();
    } catch (e) {
      toast(e.message);
    }
  };
  $('#modal-del').onclick = async () => {
    if (!formCtx || !formCtx.item) return;
    if (!confirm('确定删除这条？删了就没了。')) return;
    const { mod, item, onDone } = formCtx;
    try {
      await apiHelpers.remove(mod.id, item.id);
      closeForm();
      toast('已删除');
      onDone && onDone();
    } catch (e) {
      toast(e.message);
    }
  };
  $('#logout').onclick = async () => {
    await api('POST', '/api/logout', {});
    location.href = '/login.html';
  };

  const start = location.hash.slice(1);
  await switchTo(state.modules.find((m) => m.id === start) ? start : state.modules[0].id);

  const tick = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    $('#clock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  tick();
  setInterval(tick, 30000);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').hidden) closeForm();
  });
}

boot();
