#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""探测第二轮：修 K线源 + 找 10 年国债收益率锚 + 校准分红字段单位。"""
import json, re, ssl, time, urllib.request, urllib.parse, urllib.error

CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"


def get(url, headers=None, timeout=15, decode="utf-8"):
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read().decode(decode, errors="replace")


def post(url, data, headers=None, timeout=20, decode="utf-8"):
    h = {"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", **(headers or {})}
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), headers=h)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read().decode(decode, errors="replace")


def probe(name, fn):
    t0 = time.time()
    try:
        ok, info = fn()
        print(f"{'OK ' if ok else 'FAIL'} | {name} | {int((time.time()-t0)*1000)}ms | {info}")
    except Exception as e:
        print(f"FAIL | {name} | {int((time.time()-t0)*1000)}ms | {type(e).__name__}: {str(e)[:140]}")


CODE = "600036"

# ---------- K线源候选 ----------
def k_tx(period, n):
    txt = get(f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh{CODE},{period},,,{n},qfq")
    d = json.loads(txt)
    data = d.get("data", {}).get(f"sh{CODE}", {})
    kl = data.get(f"qfq{period}") or data.get(period) or []
    if not kl:
        return False, f"空 keys={list(data.keys())}"
    return True, f"{period} {len(kl)}根 最新={kl[-1]}"


def k_tx_day():
    return k_tx("day", 260)


def k_tx_week():
    return k_tx("week", 120)


def k_tx_month():
    return k_tx("month", 60)


def k_baidu():
    url = ("https://finance.pae.baidu.com/selfselect/getstockquotation"
           "?all=1&isIndex=false&isBk=false&isBlock=false&isFutures=false&isStock=true"
           f"&newFormat=1&group=quotation_kline_ab&finClientType=pc&code={CODE}&ktype=1")
    d = json.loads(get(url, headers={"Accept": "application/vnd.finance-web.v1+json",
                                     "Origin": "https://gushitong.baidu.com",
                                     "Referer": "https://gushitong.baidu.com/"}))
    md = (d.get("Result") or {}).get("newMarketData") or {}
    keys = md.get("keys") or []
    rows = (md.get("marketData") or "").split(";")
    if not rows or not rows[0]:
        return False, str(d)[:180]
    return True, f"keys含MA={'ma20avgprice' in keys} 行数={len(rows)} 末行={rows[-1][:90]}"


# ---------- 10Y 国债收益率候选 ----------
def y_em_cjsj_page():
    """抓东财中美国债收益率页面，从 HTML/JS 里抠出真实接口"""
    txt = get("https://data.eastmoney.com/cjsj/zmgzsyl.html", headers={"Referer": "https://data.eastmoney.com/"})
    hits = re.findall(r"reportName[=\"':\s]+([A-Za-z0-9_]+)", txt)
    urls = re.findall(r"https://datacenter[^\"'\s)]+", txt)
    return (bool(hits or urls), f"reportName候选={sorted(set(hits))[:6]} urls={[u[:90] for u in urls[:3]]}")


def y_em_report(rn):
    def f():
        url = ("https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=" + rn +
               "&columns=ALL&pageNumber=1&pageSize=8&sortColumns=SOLAR_DATE&sortTypes=-1&source=WEB&client=WEB")
        d = json.loads(get(url, headers={"Referer": "https://data.eastmoney.com/"}))
        rows = (d.get("result") or {}).get("data") or []
        if not rows:
            return False, str(d.get("message") or d)[:120]
        return True, f"共{len(rows)} 最新={json.dumps(rows[0], ensure_ascii=False)[:260]}"
    return f


def y_chinabond_page():
    """看中债官网页面里真实的数据接口"""
    txt = get("https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/gjqx", headers={"Referer": "https://yield.chinabond.com.cn/"})
    hits = re.findall(r"[\"'](/cbweb-cbrc-web/[^\"']*|query[A-Za-z]+)[\"']", txt)
    return (bool(hits), f"候选接口={sorted(set(hits))[:12]} len={len(txt)}")


def y_chinabond_post():
    body = post("https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/queryGjqxInfo",
                {"startDate": "2026-09-14", "endDate": "2026-09-21", "qx": "10",
                 "zblx": "1", "gjqx": "10", "locale": "zh_CN", "qxid": "ycqx2"},
                headers={"Referer": "https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/gjqx",
                         "X-Requested-With": "XMLHttpRequest",
                         "Accept": "application/json, text/javascript, */*; q=0.01"})
    if body.strip().startswith("<"):
        return False, "返回HTML（需登录/JS）" + body[:100].replace("\n", "")
    return True, body[:300]


def y_sina_v2():
    url = ("https://finance.sina.com.cn/mac/api/jsonp_v2.php/SINAREMOTECALLCALLBACK"
           "/MacPage_Service.get_pagedata?cate=price&event=8&from=0&num=31&condition=")
    txt = get(url, headers={"Referer": "https://finance.sina.com.cn/mac/"})
    m = re.search(r"\((\{.*\})\)", txt, re.S)
    return (bool(m), txt[:200].replace("\n", ""))


def y_sina_event():
    url = ("https://finance.sina.com.cn/mac/api/jsonp.php/SINAREMOTECALLCALLBACK"
           "/MacPage_Service.get_pagedata?cate=price&event=8&from=0&num=31&condition=")
    txt = get(url, headers={"Referer": "https://finance.sina.com.cn/mac/"})
    m = re.search(r"\((\{.*\})\)", txt, re.S)
    if not m:
        return False, txt[:200].replace("\n", "")
    d = json.loads(m.group(1))
    arr = d.get("data") or []
    if isinstance(arr, dict):
        arr = arr.get("data") or []
    return (bool(arr), f"条数={len(arr)} 末条={json.dumps(arr[-1], ensure_ascii=False)[:240] if arr else ''}")


def y_investing_proxy():
    """英为财情 中国10年国债 简易探测"""
    txt = get("https://cn.investing.com/rates-bonds/china-10-year-bond-yield",
              headers={"Referer": "https://cn.investing.com/"})
    m = re.search(r'"last":([\d.]+)', txt) or re.search(r'last[^0-9]{0,20}([\d.]{4,7})', txt)
    return (bool(m), f"match={m.group(1) if m else 'none'} len={len(txt)}")


# ---------- 分红字段校准 ----------
def div_dump():
    url = ("https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET"
           "&columns=ALL&filter=" + urllib.parse.quote(f'(SECURITY_CODE="{CODE}")') +
           "&pageNumber=1&pageSize=12&sortColumns=EX_DIVIDEND_DATE&sortTypes=-1&source=WEB&client=WEB")
    d = json.loads(get(url, headers={"Referer": "https://data.eastmoney.com/"}))
    rows = (d.get("result") or {}).get("data") or []
    if not rows:
        return False, "空"
    out = []
    for r in rows[:12]:
        out.append({
            "除权日": str(r.get("EX_DIVIDEND_DATE"))[:10],
            "报告期": str(r.get("REPORT_DATE"))[:10],
            "PRETAX_BONUS_RMB": r.get("PRETAX_BONUS_RMB"),
            "BONUS_IT_RATIO": r.get("BONUS_IT_RATIO"),
            "计划": r.get("ASSIGN_PROGRESS"),
            "方案": str(r.get("IMPL_PLAN_PROFILE"))[:40],
        })
    return True, "\n     " + "\n     ".join(json.dumps(x, ensure_ascii=False) for x in out)


print("=== K线源 ===")
probe("腾讯日线 qfq", k_tx_day)
probe("腾讯周线 qfq", k_tx_week)
probe("腾讯月线 qfq", k_tx_month)
probe("百度K线带MA", k_baidu)
print("=== 10Y 国债收益率 ===")
probe("东财页面抠接口", y_em_cjsj_page)
for rn in ["RPT_BOND_ZGZSYL", "RPT_BOND_YIELD", "RPT_BOND_CBINDEX", "RPT_BOND_YIELD_CURVE"]:
    probe(f"东财 {rn}", y_em_report(rn))
probe("中债官网页面抠接口", y_chinabond_page)
probe("中债 queryGjqxInfo(POST+AJAX头)", y_chinabond_post)
probe("新浪 jsonp_v2", y_sina_v2)
probe("新浪 jsonp event=8", y_sina_event)
probe("英为财情 中国10Y", y_investing_proxy)
print("=== 分红字段校准 600036 ===")
probe("分红明细 dump", div_dump)
