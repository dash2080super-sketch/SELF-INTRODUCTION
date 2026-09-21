#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第四轮：专攻 10Y 国债收益率锚。中债官网 JS / 中国货币网 / 其他第三方。"""
import json, re, ssl, time, gzip, io, urllib.request, urllib.parse

CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"


def fetch(url, headers=None, timeout=18, decode="utf-8"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    return raw.decode(decode, errors="replace")


def probe(name, fn):
    t0 = time.time()
    try:
        ok, info = fn()
        print(f"{'OK ' if ok else 'FAIL'} | {name} | {int((time.time()-t0)*1000)}ms | {info}")
    except Exception as e:
        print(f"FAIL | {name} | {int((time.time()-t0)*1000)}ms | {type(e).__name__}: {str(e)[:120]}")


print("=== 中债官网：找页面 + JS 里的真实数据接口 ===")
CB_PAGES = [
    "https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/gjqx?locale=zh_CN",
    "https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/queryGjqx?locale=zh_CN",
    "https://yield.chinabond.com.cn/cbweb-cbrc-web/",
]
for p in CB_PAGES:
    def f(p=p):
        t = fetch(p, headers={"Referer": "https://yield.chinabond.com.cn/"})
        js = re.findall(r'src=["\']([^"\']+\.js[^"\']*)["\']', t)
        q = re.findall(r'["\']([^"\']*(?:query|Query|yield|Yield|gjqx)[^"\']*)["\']', t)
        return (bool(js or q), f"len={len(t)} js={js[:6]} cand={sorted(set(q))[:8]}")
    probe(f"中债 {p.split('/')[-1][:40]}", f)

print("=== 中国货币网 国债收益率曲线 ===")
CM = [
    "https://www.chinamoney.com.cn/ags/ms/cm-u-bond-treasury-yield/getTreasuryYieldCurve?lang=CN&pageNum=1&pageSize=10",
    "https://www.chinamoney.com.cn/ags/ms/cm-u-bond-treasury-yield/getYieldCurve?lang=CN",
    "https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/bond/yield-curve.json",
]
for u in CM:
    def f(u=u):
        t = fetch(u, headers={"Referer": "https://www.chinamoney.com.cn/"})
        if t.strip().startswith("<"):
            return False, "HTML " + t[:70].replace("\n", "")
        return True, t[:250]
    probe("货币网 " + u.split("/")[-1][:45], f)

print("=== 和讯 / 其他第三方 ===")
THIRD = [
    ("和讯 中国10Y", "https://webforex.hermes.hexun.com/forex/quotelist?code=FXXAU&column=code,name,price"),
    ("同花顺 债券", "https://d.10jqka.com.cn/v6/line/48_CN10Y/01/last.js"),
    ("同花顺 10Y国债", "https://d.10jqka.com.cn/v6/realhead/48_CN10Y/defer/last.js"),
]
for nm, u in THIRD:
    def f(u=u):
        t = fetch(u, headers={"Referer": "https://www.10jqka.com.cn/"}, decode="gbk")
        return (len(t.strip()) > 10), t[:200].replace("\n", " ")
    probe(nm, f)

print("=== 东财 datacenter 更多报表名试探 ===")
for rn in ["RPT_BOND_YIELD_CURVE_CN", "RPT_ECONOMY_BOND_YIELD", "RPT_BOND_CN_YIELD",
           "RPTA_WEB_BOND_YIELD", "RPT_BOND_ZGZSYL_DET", "RPT_BOND_YIELD_DET"]:
    def f(rn=rn):
        u = ("https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=" + rn +
             "&columns=ALL&pageNumber=1&pageSize=3&source=WEB&client=WEB")
        d = json.loads(fetch(u, headers={"Referer": "https://data.eastmoney.com/"}))
        if d.get("success") and (d.get("result") or {}).get("data"):
            return True, json.dumps(d["result"]["data"][0], ensure_ascii=False)[:200]
        return False, str(d.get("message"))[:70]
    probe(f"datacenter {rn}", f)

print("=== 中债 直连数据导出（Excel/CSV 通道）===")
def f_x():
    u = ("https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/queryGjqxInfoExcel"
         "?startDate=2026-09-14&endDate=2026-09-21&qx=10&zblx=1&gjqx=10&locale=zh_CN")
    t = fetch(u, headers={"Referer": "https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/gjqx?locale=zh_CN"})
    if t.strip().startswith("<"):
        return False, "HTML"
    return True, t[:200]
probe("中债 Excel 导出", f_x)
