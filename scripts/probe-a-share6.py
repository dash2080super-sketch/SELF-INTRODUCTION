#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""第六轮：中债 queryGjqxInfo 返回 HTML 片段，解析出 10Y 国债收益率。"""
import re, ssl, time, gzip, urllib.request

CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
BASE = "https://yield.chinabond.com.cn/cbweb-cbrc-web"


def post(url, headers=None, timeout=25, decode="utf-8"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip",
                                               "Content-Type": "application/x-www-form-urlencoded", **(headers or {})})
    req.data = b""
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
    return raw.decode(decode, errors="replace")


url = BASE + "/cbrc/queryGjqxInfo?&workTime=2026-09-18&locale=zh_CN"
html = post(url, headers={"Referer": BASE + "/"})
print("响应长度:", len(html))
print("=" * 70)

# 去掉 script/style，把表格结构打印出来
body = re.sub(r"<script.*?</script>", "", html, flags=re.S)
body = re.sub(r"<style.*?</style>", "", body, flags=re.S)

# 逐行提取所有 <tr> 的文本
rows = re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S)
print(f"共 {len(rows)} 个 tr")
for i, r in enumerate(rows[:24]):
    cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]
    cells = [c for c in cells if c]
    if cells:
        print(f"  r{i}: {cells}")

print("=" * 70)
print("含 '10' 的行:")
for i, r in enumerate(rows):
    cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]
    cells = [c for c in cells if c]
    if any(c in ("10", "10.0", "10年", "10Y") for c in cells):
        print(f"  r{i}: {cells}")

print("=" * 70)
print("所有看起来像收益率的小数（3~6位小数）:")
nums = re.findall(r"\b(\d\.\d{4})\b", body)
print(" ", nums[:40])
