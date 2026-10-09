/**
 * vocab-api —— 词汇实验室后端（挂载点 /api/vocab，挂在 authGuard 之后）。
 *
 * 【为什么必须有后端，不能前端直连】
 *  1. vocabulary.com 的词典页和语料接口都没有 CORS 头，浏览器直连拿不到数据；
 *  2. 发音音频在 audio.vocabulary.com / *.sdcdns.com，从国内直连不稳；
 *  3. 页面是服务端渲染的 HTML，本来就得抓下来解析。
 * 所以统一由 VPS 抓 → 解析成我们自己的 JSON → 前端全程同源。
 *
 * 【数据来源（都是公开页面/接口，不涉及登录态）】
 *  A. 词典页 HTML（服务端渲染）→ 音标 / 发音 / 词形 / 简明释义 / 长释义 / 义项+同义词
 *     https://www.vocabulary.com/dictionary/<word>
 *  B. 语料库接口 → 例句（来自书和文章），支持按来源筛选与翻页
 *     https://corpus.vocabulary.com/api/1.0/examples?query=&maxResults=&startOffset=[&domain=]
 *
 * 【路由】
 *   GET /api/vocab/meta                 来源筛选项（给前端渲染下拉）
 *   GET /api/vocab/word/:word           词条（解析后）
 *   GET /api/vocab/examples?q=&domain=&offset=&limit=
 *   GET /api/vocab/audio/:word?lang=us|uk
 *
 * 【踩过的点，别改回去】
 *  - 词典页里 IPA 块出现两次（一次在 .ipa-section，一次在下方发音视频区），
 *    只取 .ipa-section 到 <a class="ipa-guide"> 之间那段，否则音标会拿到重复的四份。
 *  - 语料接口「不带 domain」和「带 domain」是两个不同的池子：前者是「书和文章」精选样本
 *    （engage 只有 191 句），后者是全量语料检索（domain=F 时 5600 句）。
 *    原来的 examplebrowser 对不带 domain 的情况走 random.json（每次结果随机、没法翻页），
 *    这里统一用 /examples，翻页才是稳定的。
 *  - 义项块里 <div class="definition"> 里面还嵌着 <div class="pos-icon">，
 *    用非贪婪匹配到第一个 </div> 会把释义截断成空，必须匹配到 <div class="defContent"> 为止。
 */
import express from 'express';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const ENTRY_TTL = 6 * 60 * 60 * 1000; // 词条 6 小时
const EX_TTL = 60 * 60 * 1000; // 例句 1 小时
const CACHE_MAX = 300;

/** 例句来源分类，与 vocabulary.com 下拉一致（code 就是它接口的 domain 参数） */
const DOMAINS = [
  { code: '', label: 'All sources' },
  { code: 'F', label: 'Literature' },
  { code: 'A', label: 'Arts / culture' },
  { code: 'N', label: 'News' },
  { code: 'B', label: 'Business' },
  { code: 'S', label: 'Sports' },
  { code: 'M', label: 'Science / Med' },
  { code: 'T', label: 'Technology' },
];
const DOMAIN_CODES = new Set(DOMAINS.map((d) => d.code));

const entryCache = new Map();
const exCache = new Map();

function cacheGet(map, key, ttl) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) {
    map.delete(key);
    return null;
  }
  return hit.data;
}
function cacheSet(map, key, data) {
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value);
  map.set(key, { at: Date.now(), data });
}

/* ---------------- 取数 ---------------- */
async function fetchText(url, ms = 15000) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
async function fetchJson(url, ms = 15000) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ---------------- HTML 小工具 ---------------- */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

const normalizeWord = (w) => String(w || '').trim().toLowerCase().slice(0, 60);
/** 只放行字母、撇号、连字符、空格（短语） */
const WORD_OK = /^[a-z][a-z'\- ]*$/;
/** 别把本站变成任意 URL 的代理：音频只允许这几个域 */
const AUDIO_HOSTS = new Set([
  'audio.vocabulary.com',
  'sd-pronunciation-processed-videos.sdcdns.com',
]);

/* ---------------- 词条解析 ---------------- */
function parseEntry(html, word) {
  const out = { word, forms: '', short: '', long: '', ipa: { us: '', uk: '' }, audio: { us: '', uk: '' }, senses: [] };

  const forms = /<p class="word-forms">Other forms:\s*<b>([\s\S]*?)<\/b><\/p>/.exec(html);
  if (forms) out.forms = stripTags(forms[1]);

  const shortM = /<p class="short">([\s\S]*?)<\/p>/.exec(html);
  const longM = /<p class="long">([\s\S]*?)<\/p>/.exec(html);
  out.short = shortM ? stripTags(shortM[1]) : '';
  out.long = longM ? stripTags(longM[1]) : '';

  // 音标 / 发音：只取 .ipa-section 这一段（页面下方发音视频区还有一份重复的）
  const ipaSec = (/<div class="ipa-section">([\s\S]*?)<a class="ipa-guide"/.exec(html) || [])[1] || '';
  for (const chunk of ipaSec.split('<div class="ipa-with-audio">').slice(1)) {
    const lang = /us-flag-icon/.test(chunk) ? 'us' : /uk-flag-icon/.test(chunk) ? 'uk' : null;
    if (!lang) continue;
    const ipaText = (/class="span-replace-h3">\s*([^<]*?)\s*<\/span>/.exec(chunk) || [])[1] || '';
    if (ipaText && !out.ipa[lang]) out.ipa[lang] = ipaText.trim();
    const token = (/data-audio="([^"]+)"/.exec(chunk) || [])[1] || '';
    if (token) out.audio[lang] = `https://audio.vocabulary.com/1.0/${lang}/${token}.mp3`;
    else {
      // 英式没有 data-audio 令牌，只有一个 mp4
      const src = (/<(?:audio|source)[^>]*\ssrc="([^"]+)"/.exec(chunk) || [])[1] || '';
      if (src) out.audio[lang] = src;
    }
  }

  // 义项（编号 + 词性 + 释义 + 同义词 + 词条自带例句）
  const defIdx = html.indexOf('Definitions of');
  if (defIdx >= 0) {
    const olStart = html.indexOf('<ol>', defIdx);
    const olEnd = olStart >= 0 ? html.indexOf('</ol>', olStart) : -1;
    if (olStart >= 0 && olEnd > olStart) {
      const ol = html.slice(olStart, olEnd);
      for (const raw of ol.split('<li class="sense').slice(1)) {
        const head = raw.split('<div class="more-info-section">')[0];
        // 注意属性顺序是 <div name="s85100" class="pos-icon">，不能要求 class 打头
        const pos = stripTags((/<div[^>]*class="pos-icon"[^>]*>([\s\S]*?)<\/div>/.exec(head) || [])[1] || '');
        let defRaw = (/<div class="definition">([\s\S]*?)<div class="defContent">/.exec(head) || [])[1];
        if (defRaw == null) defRaw = (/<div class="definition">([\s\S]*?)<\/li>/.exec(head) || [])[1] || '';
        const def = stripTags(defRaw.replace(/<div[^>]*class="pos-icon"[^>]*>[\s\S]*?<\/div>/, ''));
        if (!def) continue;
        const synBlock = (/<span class="detail">synonyms:<\/span>([\s\S]*?)<\/div>/.exec(head) || [])[1] || '';
        const synonyms = [...synBlock.matchAll(/<a[^>]*class="word"[^>]*>([^<]+)<\/a>/g)].map((m) =>
          decodeEntities(m[1]).trim()
        );
        const ex = (/<div class="example">([\s\S]*?)<\/div>/.exec(head) || [])[1] || '';
        out.senses.push({ pos, def, synonyms, example: ex ? stripTags(ex) : '' });
      }
    }
  }
  return out;
}

async function getEntry(word) {
  const key = normalizeWord(word);
  if (!WORD_OK.test(key)) throw Object.assign(new Error('词形不合法'), { status: 400 });
  const cached = cacheGet(entryCache, key, ENTRY_TTL);
  if (cached) return cached;

  const html = await fetchText(`https://www.vocabulary.com/dictionary/${encodeURIComponent(key)}`);
  const entry = parseEntry(html, key);
  if (!entry.short && !entry.senses.length) {
    throw Object.assign(new Error('没有查到这个词'), { status: 404 });
  }
  entry.source = 'vocabulary.com';
  entry.url = `https://www.vocabulary.com/dictionary/${encodeURIComponent(key)}`;
  entry.fetchedAt = new Date().toISOString();
  cacheSet(entryCache, key, entry);
  return entry;
}

/* ---------------- 例句 ---------------- */
async function getExamples(q, domain, offset, limit) {
  const word = normalizeWord(q);
  if (!WORD_OK.test(word)) throw Object.assign(new Error('词形不合法'), { status: 400 });
  const dom = DOMAIN_CODES.has(domain) ? domain : '';
  const key = `${word}|${dom}|${offset}|${limit}`;
  const cached = cacheGet(exCache, key, EX_TTL);
  if (cached) return cached;

  const url =
    'https://corpus.vocabulary.com/api/1.0/examples' +
    `?query=${encodeURIComponent(word)}&maxResults=${limit}&startOffset=${offset}` +
    (dom ? `&domain=${dom}` : '');
  const j = await fetchJson(url);
  const data = {
    word,
    domain: dom,
    offset,
    limit,
    totalHits: j?.totalHits ?? null,
    sentences: (j?.sentences || []).map((s) => ({
      text: s.sentence || '',
      offsets: Array.isArray(s.offsets) ? s.offsets : [],
      title: s.volume?.title || '',
      author: s.volume?.author || '',
      corpus: s.volume?.corpus?.name || '',
      corpusId: s.corpusId || '',
      domains: s.volume?.domains || (s.volume?.domain ? [s.volume.domain] : []),
    })),
  };
  cacheSet(exCache, key, data);
  return data;
}

/* ---------------- 路由 ---------------- */
const router = express.Router();

router.get('/meta', (req, res) => {
  res.json({ domains: DOMAINS });
});

router.get('/word/:word', async (req, res, next) => {
  try {
    res.json(await getEntry(req.params.word));
  } catch (e) {
    next(e);
  }
});

router.get('/examples', async (req, res, next) => {
  try {
    const offset = Math.max(0, Math.min(2000, parseInt(req.query.offset, 10) || 0));
    const limit = Math.max(1, Math.min(20, parseInt(req.query.limit, 10) || 8));
    res.json(await getExamples(req.query.q, String(req.query.domain || ''), offset, limit));
  } catch (e) {
    next(e);
  }
});

router.get('/audio/:word', async (req, res, next) => {
  try {
    const lang = req.query.lang === 'uk' ? 'uk' : 'us';
    const entry = await getEntry(req.params.word);
    const src = entry.audio?.[lang];
    if (!src) return res.status(404).json({ error: '该词没有这个发音' });
    const u = new URL(src);
    if (!AUDIO_HOSTS.has(u.hostname)) return res.status(400).json({ error: '不允许的音频源' });
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return res.status(502).json({ error: '音频源 ' + r.status });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (e) {
    next(e);
  }
});

// 统一把上游/解析错误转成 JSON，前端好显示原因
router.use((err, req, res, next) => {
  if (!err) return next();
  const status = err.status || 502;
  if (status >= 500) console.warn('[vocab]', req.path, err.message);
  res.status(status).json({ error: err.message || 'upstream failed' });
});

export default router;
// 导出解析器便于离线回归（scripts/vocab-parse-test.mjs 用），改解析逻辑后跑一遍
export { parseEntry };
