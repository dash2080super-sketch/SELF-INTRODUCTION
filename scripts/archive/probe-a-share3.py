#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第三轮：锁定 10 年国债收益率源的最终方案 + 确认 push2 是否可用。"""
import json, re, ssl, time, urllib.request, urllib.parse

CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
H_EM = {"Referer": "https://quote.eastmoney.com/"}


def get(url, headers=None, timeout=15, decode="utf-8"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read().decode(decode, errors="replace")


def probe(name, fn):
    t0 = time.time()
    try:
        ok, info = fn()
        print(f"{'OK ' if ok else 'FAIL'} | {name} | {int((time.time()-t0)*1000)}ms | {info}")
    except Exception as e:
        print(f"FAIL | {name} | {int((time.time()-t0)*1000)}ms | {type(e).__name__}: {str(e)[:130]}")


print("=== 候选 A: 东财 push2 全球国债行情 171.CN10Y ===")
for secid in ["171.CN10Y", "171.US10Y", "171.CN2Y", "171.CN30Y"]:
    def f(sid=secid):
        url = (f"https://push2.eastmoney.com/api/qt/stock/get?secid={sid}"
               "&fields=f43,f57,f58,f59,f60,f169,f170,f171&fltt=2&invt=2")
        d = json.loads(get(url, headers=H_EM))
        data = d.get("data")
        if not data:
            return False, "data=null"
        return True, json.dumps(data, ensure_ascii=False)
    probe(f"push2 stock/get {secid}", f)

print("=== 候选 B: 171.CN10Y 的历史K线（算中枢/趋势用）===")
def f_b():
    url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=171.CN10Y"
           "&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&beg=0&end=20500101&lmt=30")
    d = json.loads(get(url, headers=H_EM))
    kl = (d.get("data") or {}).get("klines") or []
    if not kl:
        return False, str(d)[:130]
    return True, f"{len(kl)}根 最新={kl[-1]}"
probe("push2his kline 171.CN10Y", f_b)

print("=== 候选 C: push2 是否已对海外IP断连（对照 A股K线）===")
def f_c():
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600036&fields1=f1&fields2=f51,f53&klt=101&fqt=1&lmt=5&beg=0&end=20500101"
    d = json.loads(get(url, headers=H_EM))
    return True, str(d)[:120]
probe("push2his A股K线 1.600036", f_c)

print("=== 候选 D: 新浪中债收益率（akshare bond_gb_zh_sina 路线）===")
def f_d():
    url = ("https://finance.sina.com.cn/mac/api/jsonp.php/SINAREMOTECALLCALLBACK"
           "/MacPage_Service.get_pagedata?cate=price&event=8&from=0&num=31&condition=")
    txt = get(url, headers={"Referer": "https://finance.sina.com.cn/mac/"})
    m = re.search(r"\((\{.*\})\)", txt, re.S)
    if not m:
        return False, txt[:150].replace("\n", " ")
    d = json.loads(m.group(1))
    arr = d.get("data") or []
    if isinstance(arr, dict):
        arr = arr.get("data") or []
    return True, f"条数={len(arr)} 末条={json.dumps(arr[-1], ensure_ascii=False)[:200] if arr else ''}"
probe("新浪 mac jsonp", f_d)

def f_d2():
    url = "https://hq.sinajs.cn/list=gb_$CN10Y,gb_$CN2Y,gb_$CN30Y"
    txt = get(url, headers={"Referer": "https://finance.sina.com.cn/"}, decode="gbk")
    return ("cn10y" in txt.lower() or "CN10Y" in txt), txt[:300].replace("\n", " ")
probe("新浪 hq gb_$CN10Y", f_d2)

def f_d3():
    url = "https://hq.sinajs.cn/list=USDCNY,fx_susdcny"
    txt = get(url, headers={"Referer": "https://finance.sina.com.cn/"}, decode="gbk")
    return bool(txt.strip()), txt[:200].replace("\n", " ")
probe("新浪 hq 可用性对照", f_d3)

print("=== 候选 E: 腾讯是否有国债收益率 ===")
for sym in ["cn10y", "us10Y", "CN10Y"]:
    def f_e(s=sym):
        txt = get(f"https://qt.gtimg.cn/q={s}", decode="gbk")
        if '="' not in txt or len(txt) < 20:
            return False, txt[:100].strip()
        return True, txt[:200].replace("\n", " ")
    probe(f"腾讯 q={sym}", f_e)

print("=== 候选 F: 中债官网 GET 版 ===")
def f_f():
    url = ("https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/queryGjqxInfo"
           "?startDate=2026-09-14&endDate=2026-09-21&qx=10&zblx=1&gjqx=10&locale=zh_CN")
    txt = get(url, headers={"Referer": "https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/gjqx?locale=zh_CN",
                            "X-Requested-With": "XMLHttpRequest",
                            "Accept": "application/json, text/javascript, */*; q=0.01"})
    if txt.strip().startswith("<"):
        return False, "HTML " + txt[:80].replace("\n", "")
    return True, txt[:250]
probe("中债 GET queryGjqxInfo", f_f)

print("=== 候选 G: 中债 收益率曲线 页面真实接口 ===")
def f_g():
    txt = get("https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/gjqx?locale=zh_CN",
              headers={"Referer": "https://yield.chinabond.com.cn/"})
    hits = re.findall(r"[\"']([^\"']*query[^\"']*)[\"']", txt)
    js = re.findall(r'src=[\"\']([^\"\']+\.js)[\"\']', txt)
    return (bool(hits or js), f"query接口={sorted(set(hits))[:8]} js={js[:4]} len={len(txt)}")
probe("中债 gjqx 页面抠接口", f_g)
