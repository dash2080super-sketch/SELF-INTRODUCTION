#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第五轮：挖中债官网 queryGjqxInfo 的真实调用参数并打通。"""
import json, re, ssl, time, gzip, urllib.request, urllib.parse

CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
BASE = "https://yield.chinabond.com.cn/cbweb-cbrc-web"


def fetch(url, headers=None, timeout=20, decode="utf-8"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    return raw.decode(decode, errors="replace")


page = fetch(BASE + "/", headers={"Referer": BASE + "/"})
print("=== 页面大小:", len(page), "===")

for fn in ["queryGjqxInfo", "queryChartInfo"]:
    m = re.search(r"function\s+" + fn + r"\s*\([^)]*\)\s*\{", page)
    if m:
        seg = page[m.start(): m.start() + 1400]
        print(f"\n--- {fn}() 函数体 ---\n{seg}\n")
    else:
        print(f"\n--- {fn}: 未找到函数定义 ---")

print("\n=== 页面里所有 ajax/url 调用 ===")
for m in re.finditer(r"url\s*:\s*[^,;\n]{0,160}", page):
    print("  ", m.group(0).replace("\n", " ")[:170])

print("\n=== 直接调用 queryGjqxInfo 试探 ===")
today = time.strftime("%Y-%m-%d")
for params in [
    {"workTime": today},
    {"workTime": "2026-09-19"},
    {"workTime": "2026-09-21"},
    {"workTime": today, "qx": "10", "zblx": "1", "gjqx": "10", "locale": "zh_CN"},
]:
    url = BASE + "/cbrc/queryGjqxInfo?" + urllib.parse.urlencode(params)
    try:
        t0 = time.time()
        t = fetch(url, headers={"Referer": BASE + "/", "X-Requested-With": "XMLHttpRequest",
                                "Accept": "application/json, text/javascript, */*; q=0.01"})
        ms = int((time.time() - t0) * 1000)
        if t.strip().startswith("<"):
            print(f"  HTML({ms}ms) {params} -> {t[:90]!r}")
        else:
            print(f"  JSON({ms}ms) {params} -> {t[:600]}")
    except Exception as e:
        print(f"  ERR {params} -> {type(e).__name__}: {str(e)[:80]}")
