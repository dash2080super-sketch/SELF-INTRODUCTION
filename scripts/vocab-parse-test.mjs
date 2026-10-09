/**
 * vocab 解析器回归。
 *
 * 用法（在 /opt/billboard 下）：node scripts/vocab-parse-test.mjs
 *
 * 抓几个结构上不太一样的词，断言解析结果的关键字段不为空。
 * 改 src/vocab-api.js 的解析正则之后跑一遍，比拿眼睛翻页面快得多。
 * vocabulary.com 的 HTML 结构一变，这里会先炸，而不是等用户看到空白。
 */
import { parseEntry } from '../src/vocab-api.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 挑词的理由：engage 义项最多（10 条）；ephemeral 同义词多；ubiquitous 英美音标不同；
// serendipity 没有同义词（验证空值不炸）；run 是不规则动词、义项特别碎。
const WORDS = ['engage', 'ephemeral', 'ubiquitous', 'serendipity', 'run'];

let fail = 0;
for (const w of WORDS) {
  let e;
  try {
    const r = await fetch(`https://www.vocabulary.com/dictionary/${w}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    e = parseEntry(await r.text(), w);
  } catch (err) {
    console.log(`✗ ${w}: 取数失败 ${err.message}`);
    fail++;
    continue;
  }

  const checks = [
    ['音标(us)', !!e.ipa.us],
    ['音标(uk)', !!e.ipa.uk],
    ['发音(us)', !!e.audio.us],
    ['简明释义', !!e.short],
    ['长释义', !!e.long],
    ['义项>=1', e.senses.length >= 1],
    ['义项有词性', e.senses.some((s) => s.pos)],
  ];
  const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (bad.length) {
    console.log(`✗ ${w}: 缺 ${bad.join(' / ')}`);
    fail++;
  } else {
    const syn = e.senses.reduce((n, s) => n + s.synonyms.length, 0);
    console.log(
      `✓ ${w.padEnd(12)} 义项 ${String(e.senses.length).padStart(2)} · 同义词 ${String(syn).padStart(2)} · ` +
        `us ${e.ipa.us} / uk ${e.ipa.uk} · forms "${e.forms || '-'}"`
    );
  }
}

console.log(fail ? `\n${fail}/${WORDS.length} 个词条解析异常` : `\n全部 ${WORDS.length} 个词条解析正常`);
process.exit(fail ? 1 : 0);
