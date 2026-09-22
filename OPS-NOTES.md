# 服务器运维台账 /opt/OPS-NOTES.md

> 这份文件是给「未来的我（Dog）」和 Vic 看的。每次改动请往下追加，别覆盖。
> 目的：任何一次新会话读完这个文件，就能接上上下文，不用重新摸机器。

## 机器

- IP：`188.166.250.14`，hostname `ubuntu-s-1vcpu-512mb-10gb-sgp1`（DigitalOcean 新加坡 SGP1）
- 规格：1 vCPU / 512MB / 10GB SSD，Ubuntu 24.04.4，已有 1GB swap
- 登录：本机 `id_ed25519` 免密 root（Vic 的 Windows 上 `ssh root@188.166.250.14` 即可）
- 磁盘：8.7G 总，用 43%

## 域名

- **vic-jianhua.me**，阿里云（万网）注册，2026-09-21 注册，**2027-09-21 到期**（1 年，记得续费）
- 实名认证：已通过（`.me` 也要实名，否则会被 Serverhold）
- DNS 托管：**Cloudflare** — `maisie.ns.cloudflare.com` / `thaddeus.ns.cloudflare.com`
  （阿里云侧 Nameserver 已改；TLD 委托刷新可能要几十分钟到几小时）
- 服务器在新加坡，**不需要 ICP 备案**（只有大陆服务器才要）

## 端口占用（改端口前先看这里）

| 端口 | 谁在用 | 备注 |
|---|---|---|
| 22 | sshd | 唯一管理入口，别动 |
| 443 | **xray**（VLESS + Reality） | Vic 的代理，**绝对不能抢**；ufw 已放行 |
| 3000 | billboard（仅 `127.0.0.1`） | **不对外**，外部访问一律走 Cloudflare Tunnel |

ufw 状态：active，仅放行 22 / 443。**隧道方案不需要再开任何端口**（cloudflared 主动外连）。

## 机器上跑的东西

| 目录 / 服务 | 是什么 | 谁在驱动 |
|---|---|---|
| `/opt/billboard` | 个人看板（Node + Express + SQLite） | systemd `billboard.service`，监听 127.0.0.1:3000 |
| `cloudflared.service` | Cloudflare Tunnel 连接器 | systemd，约 2026.9.1 版 |
| `/opt/etf-monitor` | Python 抓 515450 ETF、日经225ETF(513880) | cron（4 条任务） |
| `/opt/fng-bark` | 恐惧贪婪指数 → Bark 推送 | cron |
| xray | VLESS Reality 代理 | systemd `xray.service` |

### Cloudflare Tunnel 关键信息

- 隧道名 `billboard`，ID `538a181e-56b9-47c4-846c-b16d6ccb941e`
- 配置：`/root/.cloudflared/config.yml`（指向 `http://127.0.0.1:3000`，关了自动更新）
- **授权证书 `/root/.cloudflared/cert.pem` —— 丢失或泄露都要重新授权，别外传**
- 凭据 json：`/root/.cloudflared/538a181e-56b9-47c4-846c-b16d6ccb941e.json`
- DNS：`vic-jianhua.me` 的 CNAME 由 `cloudflared tunnel route dns` 自动写入，指向 `<uuid>.cfargotunnel.com`
- 边缘节点：连到新加坡（2xsin07 / 2xsin17），延迟最优

重装/迁移时：新机器上装 cloudflared → 把 `cert.pem` 和 `<uuid>.json` 拷过去 →
`cloudflared service install`。**隧道 ID 不变，DNS 记录不用改。**

## 运维规矩（Vic 与 Dog 的约定）

1. **不碰 xray 与 443**。那是翻墙生命线，改动前必须 Vic 明确同意。
2. **破坏性操作先说后做**：删库、重装、`ufw` 改规则、动别人的脚本 —— 先讲清楚会怎样，
   等 Vic 点头。**改之前能备份就备份。**
3. **每次改动追加记录到本文件**（时间 / 做了什么 / 怎么回滚）。
4. **密码、token、私钥、cert.pem 不进聊天记录**，也不写进本文件。要改看板密码用
   `ssh -t root@188.166.250.14 /opt/billboard/scripts/set-login-password.sh`（Vic 自己输入）。
5. Dog 只在对话期间存在，不 7×24 值守。要长期自动化的东西必须落成 cron + 脚本 + 告警。
6. **测试脚本不许全表扫删**。清理逻辑只能删"自己刚创建的那几条"（按 id 精确匹配）。
   在真实库上跑任何会写数据的脚本前，先 `node scripts/db-counts.mjs` 存一份基线，
   跑完再对一次。违反过一次，见 2026-09-21 17:30 事故复盘。
7. **Vic 自己录入的数据（to-do / 随想 / 单词 / 句子 / 自选股）属于生产数据**，
   不是测试环境。任何"顺手清一下"的念头都要先问。
8. **push 前扫明文凭据**。本仓库挂在 GitHub 上（曾经是 public），任何密码 / token /
   私钥 / 含凭据的配置都不许写进会被提交的文件。**连本文件也不行**——
   2026-09-21 就是在这里写了看板密码然后推上去，泄露了一天多。
   台账里只写"密码已换 / 已确认"，不写密码本身。
9. **密码泄露 = 两步**：① 改密码（`scripts/set-password.js`）；
   ② `node scripts/rotate-session-secret.mjs` + 重启，把已发出的旧 cookie 全部作废。
   只做第 ① 步，旧 cookie 还能用满 `SESSION_DAYS` 天。

## 常用命令

```bash
# billboard
systemctl status billboard
journalctl -u billboard -f --no-pager        # 实时日志
bash /opt/billboard/scripts/deploy-verify.sh '密码'   # 自检

# 隧道
systemctl status cloudflared
journalctl -u cloudflared -f --no-pager
HOME=/root cloudflared tunnel info billboard
HOME=/root cloudflared tunnel list

# 本机开隧道后访问 http://127.0.0.1:3000（直连调试用）
ssh -N -L 3000:127.0.0.1:3000 root@188.166.250.14
```

## 变更记录

### 2026-09-21 10:50 — billboard 首次部署

- 代码经 scp（tar 包）放到 `/opt/billboard`，依赖 106 包，`npm ci` 完成。
- 装了 Node 22.23.2（nodesource）。建了 `billboard` 运行用户（home `/home/billboard`）。
- `billboard.service` 已 enable + active，**常驻内存约 21MB**。监听 `127.0.0.1:3000`。
- 自检全过：health / 登录 / 5 个分区 / 写入删除。
- **回滚**：`systemctl stop billboard && systemctl disable billboard && rm -rf /opt/billboard`
  （数据库在 `/opt/billboard/data/billboard.db`，删之前先备份它）

### 2026-09-21 12:02 — 域名接入 + Cloudflare Tunnel

- 装 cloudflared 2026.9.1（pkg.cloudflare.com 官方 apt 源）。
- Vic 在浏览器完成 CF 授权，证书落到 `/root/.cloudflared/cert.pem`。
- 建隧道 `billboard`（ID 538a181e…），`route dns` 自动写入 CNAME 记录。
- `cloudflared` 服务已 enable + active，连到新加坡边缘。
- **选择隧道而非端口反代的原因**：443 被 xray 占用，常规反代要让 CF 回源到 80/8443，
  还得配证书和改 ufw；隧道让服务器主动外连，零端口、不碰 xray、证书由 CF 管。
- **回滚**：`systemctl stop cloudflared && systemctl disable cloudflared`
  （DNS 记录仍在 CF，域名会解析失败；要彻底删：`cloudflared tunnel delete billboard`）

### 2026-09-21 12:40 — 正式上线 + 每日备份

- NS 委托生效（1.1.1.1 已返回 `maisie/thaddeus.ns.cloudflare.com`）。
- 通过 `https://vic-jianhua.me` 自检全过：health 200 / 登录 / 5 个分区 / 写入删除。
- Vic 本机直连 Cloudflare **1.3 秒**（走代理反而 5.4 秒，建议直连）。
- 加了每日备份：`0 20 * * *`（**UTC 20:00 = 北京 04:00**）跑
  `node scripts/backup-db.mjs`，备份到 `/opt/backup/billboard-YYYY-MM-DD.db`，保留 14 天。
  用 SQLite 官方 backup API，**服务不用停，也不会拷到半个文件**。
- **没有改 crontab 的时区**：Vic 原有任务 etf-monitor `5 15 * * 1-5`（UTC 15:05 =
  美股盘中）和 fng-bark `30 8 * * *` 依赖 UTC，加 `CRON_TZ` 会打乱它们，所以改用
  UTC 20:00 表达北京时间凌晨 4 点。改 crontab 前已备份到 `/root/crontab.bak-2026-09-21`。

### 2026-09-21 13:38 — 修复红利低波50ETF 的 Bark 推送

**现象**：Vic 反馈 515450 的 Bark 推送不是每天来。

**结论：脚本、cron 机制、时间配置全都正常。** 只是这条任务是周末才加进 crontab 的，
还没轮到它的执行窗口（周一至周五 15:05 本地时间）——所以 Vic 此前一次都没收到。

**证据链**：
- `--debug` 试跑完全正常（腾讯 K 线 261 条、现价 1.388、策略建议齐全）。
- 埋了一条 13:45 的临时 cron，跑通并写出日志 → **cron 机制没问题**（已清理该临时条目）。
- `journalctl -u cron` 里 `monitor_515450` 历史执行 **0 次**，`run.log` 不存在 → 只是没到过点。
- 立即真实推送一次，返回 `[BARK] 推送成功`（Vic 手机收到）。

**时区（重要，别再搞错）**：
- 服务器 `Time zone: Asia/Singapore (+08)`，和北京时间一致。
- **cron 按系统本地时区跑，不是 UTC。** 所以 `5 15 * * 1-5` = 新加坡/北京 15:05
  = A股收盘后 5 分钟，**原本就是对的**。我一度误判成 UTC 改成 07:05，已改回。
- 坑：`/etc/timezone` 文件里写的是 `Etc/UTC`（过时，**与 timedatectl 不一致**），
  **以 `timedatectl` 为准**。
- 同理 `fng_bark` 的 `30 8 * * *` 是本地 08:30，不是 UTC 08:30。

**备份**：脚本 `monitor_515450.py.bak-20260921`，crontab `/root/crontab.bak-2026-09-21`。

**其他**：
- 脚本用**腾讯行情接口**（web.ifzq.gtimg.cn），不是东方财富。
- 有兜底：抓取或计算异常走 except 分支，会推一条「异常」通知，**不会静默失败**。
- 周末/节假日按 `1-5` 不推；想每天都收到就改成 `*`。

### 2026-09-21 14:35 — finance 看板上线（24 项指标 / 6 个分区）

**做了什么**：把原来只有 4 个占位槽的 finance 模块，换成真正的全球行情看板。

新增文件：
- `src/finance-catalog.js` — **指标目录，全站唯一数据源**。6 分区 / 31 指标 / 44 条报价腿，
  含每个指标的详细注解文案。改指标或改文案只动这个文件。
- `src/finance-data.js` — 取数器。CNBC 批量 + Yahoo 单查 + CNN 恐惧贪婪，结果缓存 60 秒。
- `src/finance-api.js` — `GET /api/finance`（`?refresh=1` 强制）、`PUT|GET /api/finance/manual`。
- `public/js/modules/finance.js` — 前端渲染器（分区卡片 + 注解 + 手动录入）。
- `public/css/app.css` — 追加 `.fin-*` 样式。

**取数策略（重要，别改坏）**：
- 每条腿声明 `cnbc` / `yahoo` 两个候选源，**先 CNBC 批量（一次 8 个符号），
  拿不到或变化为 `UNCH` 再回落 Yahoo 单查**。某个源挂掉只会降级，不会整片空白。
- Yahoo 的涨跌用**收盘序列算**（`closes[-1]` vs `closes[-2]`），
  **不要用 `meta.chartPreviousClose`** —— 它是「图表窗口开始前」的收盘价（5 天前），
  期货还会串到旧合约，用它会算出荒谬的涨跌幅。
- CNBC 对 `.VIX` / `.DAX` / `.CAC` 返回 `UNCH`（不给变化值），这几个已配 Yahoo 兜底。

**已验证的数据源（新加坡出网）**：
- ✅ Yahoo chart — 指数、波动率、个股、期货（ES/NQ/NKD）、金银油、汇率
- ✅ CNBC quote（`partnerId=2`）— **美债 3M/2Y/5Y/10Y/30Y、日债 2Y/5Y/10Y/30Y、德/英国债、
  TOPIX 现货、CAC 与 FTSE 期货、Brent、黄金现货、美元指数**
- ✅ CNN `production.dataviz.cnn.io/index/fearandgreed/graphdata`（需带 `Referer`）
- ❌ **不可用**：FRED CSV（空/超时）、stooq、AAII（403）、McClellan（403）、
  **NAAIM（2026-08-01 起改订阅制，公开数据已下线）**、Yahoo 无 TOPIX/欧股期货/日债 symbol、
  **DAX 期货**（CNBC/Yahoo 都没有，已标「源暂缺」）

**因此需要手动录入的 4 项**（都是周度/事件型慢变量，本来就不需要实时）：
AAII、NAAIM、McClellan、兴登堡凶兆。前端每张卡自带输入框，值存 `kv` 表 `finance.manual`。

**实测**：`GET /api/finance` 200 / 46KB / 6 分区，**31 个指标 0 缺口，耗时 2.2 秒**。
外网 `https://vic-jianhua.me/api/health` 200，登录页 200。

**顺手改的**：`express.static` 的 `maxAge` 从 1 小时改成 0（靠 ETag 协商）。
原因：个人小站改动频繁，1 小时强缓存会让 Vic 每次部署后都看到旧文件。

**调试技巧**：不知道看板密码时，可以用 `scripts/mint-cookie.mjs`（在服务器上跑，读
`/opt/billboard/.env` 的 SESSION_SECRET 自签一个 10 分钟会话）直接 curl 接口，
**不用改 Vic 的密码**。

**回滚**：删掉 `server.js` 里 `app.use('/api/finance', financeRouter)` 一行 +
恢复旧的 `modules/finance.js` 和 `public/js/modules/finance.js`，重启即可。
目录文件留着不影响。

### 2026-09-21 15:00 — billboard 静态资源版本号（根治"改了没反应"）

**现象**：Vic 打开 finance 栏看到的还是几小时前的占位面板。原因是
`express.static` 之前用 `maxAge: '1h'`，浏览器把旧的 `finance.js` 缓存住了。

**做法**（不需要任何手动 bump 版本号）：
1. `server.js` 启动时扫描 `public/` 下所有文件的 mtime，算一个 8 位短哈希 `ASSET_V`；
2. `/index.html` 由专门的路由返回，把 HTML 里的 `__ASSET_V__` 占位符替换成该哈希
   （响应头带 `Cache-Control: no-cache`）；
3. `index.html` 里 `app.css` / `app.js` 都带 `?v=__ASSET_V__`；
4. `public/js/app.js` 动态 import 模块时也带上 `window.__ASSET_V__`。

**效果**：任何前端文件一改，重启服务后 URL 自动变化，浏览器不可能再吃到旧文件。
Vic 只需要这一次硬刷（Ctrl+Shift+R），以后都不用管。

### 2026-09-21 15:00 — 日经225ETF(513880) Bark 推送：从零新建

**现象**：Vic 说日经225 的 Bark 推送一直不来。

**根因（不是坏掉，是从来就没装过）**：
- `crontab` 里**根本没有日经相关的条目**，只有 515450 / fng / billboard 备份三条。
- `/opt/etf-monitor/` 下**没有** `monitor_nikkei225.py`，只有一个
  `test_nikkei_sources.py`（数据源探测脚本）和一份 2026-09-17 15:04 的
  `nikkei225_monitor.log` —— 那次是**手动跑了一次"自检"**，推了一条"观望"就没了，
  脚本没落盘、cron 也没配。所以"一直不推送"是必然的。

**新建的脚本**：`/opt/etf-monitor/monitor_nikkei225.py`（工作区留了一份源：
`vps/etf-monitor/monitor_nikkei225.py`，改完记得同步过去）。

标的 **sh513880 日经225ETF华安**（注意：513880 是**华安**的，易方达是 513000，
之前脚本注释写错了）。结构参考 515450 那份，保持风格一致。

**数据源（全部在新加坡实测通过）**：
| 用途 | 源 | 备注 |
|---|---|---|
| 513880 实时行情 / 日K | 腾讯 `qt.gtimg.cn` / `web.ifzq.gtimg.cn` | GBK 编码 |
| 513880 单位净值 | 东方财富 `api.fund.eastmoney.com/f10/lsjz` | 需带 Referer `https://fundf10.eastmoney.com/` |
| 净值兜底 | 腾讯 `qt.gtimg.cn/q=jj513880` | 无需 Referer，一个请求就够 |
| 外围参考 | Yahoo chart API | ^N225 / NKD=F / JPY=X / CNYJPY=X / ^SOX / NVDA / ^TNX / ^KS11 |

**这次新增的核心指标——溢价率**。日经ETF 是 QDII，常年溢价，这是它最大的隐性风险
（买在高溢价上，溢价一收敛就是实亏）。算法两种口径都给：
- **口径一**：市价 / 最新已公布净值（和数据商口径一致，方便核对）→ 今天 +3.87%
- **口径二**：把净值用「指数+汇率」折算到当前再算（判断用这个）→ 今天 +3.14%

为什么要口径二：净值日期通常滞后市价一天以上（今天是 9/21，最新净值是 9/18），
直接相除会把"这期间指数涨的"算进溢价里，虚高。

**同样新增的是「汇率影响」**。513880 用人民币计价但标的是日元资产，
日元贬值会直接吃掉指数涨幅，这层最容易被忽略：
> 今天日经225 日元计价 +1.38%，日元对人民币贬值 0.66%，换算成人民币只剩 +0.70%。
> 513880 实际 +0.00%，比"指数+汇率"推算的低 0.70 个点 —— 这部分是溢价在收敛，不是跟踪失效。

这条正好解释了 Vic 观察到的"日经涨它不涨"。

**溢价阈值**（比普通 ETF 严，因为 QDII 溢价是纯损失）：
`<1%` 健康 / `1~2%` 小仓位 / `2~4%` 偏高建议等 / `≥4%` 危险暂停加仓。

**溢价趋势**：存档 `/opt/etf-monitor/state_nikkei225.json`，按**净值日**比较，
净值日没变就不重复报警（避免同一天重复提示）。判断用的是口径二的值。

**cron**：`15 15 * * 1-5`（本地/北京时间 15:15，A股收盘后 15 分钟，
错开 515450 的 15:05）。日志 `/opt/etf-monitor/nikkei225_monitor.log`。
crontab 已备份到 `/root/crontab.bak-2026-09-21-1500`。

**验证**：`--debug` 干跑通过（不推送）；真实推送一次返回 `[BARK] 推送成功`。

**已知局限（诚实记录）**：
- 净值折算是用「指数 + 汇率」近似，没考虑 ETF 的现金拖累、成分差异和汇率对冲，
  所以是**估算**不是精确值；两个口径都给出了，心里有数。
- 日本市场祝日（A股开市但日本休市）时，日经数据是上一交易日的，推送会显得"没反应"。
- 美债 / 半导体 / 英伟达在 15:15 拿到的是**最近一个美股交易日收盘**，已在推送里标注。

**回滚**：`crontab -l | grep -v nikkei225 | crontab -` 去掉条目即可；
脚本和 state 文件留着不影响任何东西。

### 2026-09-21 15:30 — finance 看板：分级实时刷新（含实测开销）

**需求**：Vic 要"实时变动的数据能自动更新，比如期货"，同时担心 512MB 小机器的资源。

**为什么不能简单地"每秒全量重刷"**：真正的风险不是 CPU，是**上游限流**。
我在这台机器上密集探测时被 Yahoo 返回过 429。真被限流，整个看板会瞎。

**方案：分级 + 自适应 + 请求合并**

指标在 `finance-catalog.js` 里加了 `tier` 字段：
- **fast（9 个）**：VIX / VXN / S&P500+ES / NDX+NQ / 日经225+NKD / USDCNY / USDJPY / 黄金 / 原油
  → 约 **20 秒**
- **slow（22 个）**：收益率、波动率家族、全球股指、SOX、NVDA、DXY 等 → 约 **120 秒**
- **daily**：CNN 恐惧贪婪（本身日更）、4 个手动项 → 15~30 分钟

关键机制（`src/finance-data.js`）：
1. **刷新只在客户端请求时触发**。没人看 → 一个上游请求都不发，开销是 **0**，
   不是"慢速刷新"。这点是实测确认的，不是设计假设。
2. **自适应 TTL**：90 秒内有客户端请求 → active（20s/120s）；否则 idle（180s/600s）。
3. **请求合并**：并发的客户端请求共用一个 `inFlight` Promise，多开标签页不会翻倍。
4. **失败保留旧值**：上游抖一下不清空数据 —— 看板闪空白比显示旧值更糟。
5. **每日预算 60000 次**作保险丝，防"标签页开着忘了关跑一星期"。

**实测数据**（`scripts/bench-finance.mjs`，读 `/proc/<pid>/stat` 的 CPU 时间 + RSS）：

| 场景 | 上游请求 | CPU（单核） | 内存 |
|---|---|---|---|
| 盯着看（20s 一次，100 秒） | 28 次 = **0.28 次/秒** | **0.54%** | 堆 13 MB |
| 停手 110 秒后 | **0 次** | **0.02%** | 稳定 |

- `/api/finance/stats` 实时暴露这些数（mode / requests / errors / lastCycleMs / heapMB）。
- **前端页面上也直接显示了**，Vic 随时能自己看开销，不用问我。
- systemd 记账的 `MemoryCurrent` 约 **36 MB**；整机 458MB 里 available 255MB，没压力。
  （`/proc` 的 VmRSS 显示 72~88MB 是因为它把 **共享页**也算了，
  node 二进制/libc 与其他进程共享的部分会重复计入 —— **记账看 systemd，不要看 VmRSS**。）

**前端**（`public/js/modules/finance.js`）：
- 刷新频率可选 **10s / 20s（推荐）/ 60s / 不自动**，选择存 kv（`finance.refreshMs`）
- 每秒本地倒计时 + 跳动的绿点，直观知道"还有几秒刷新"
- 快速档卡片带 `实时` 标签 + 每条数据的年龄（"12 秒前"），颜色随新鲜度变化
- 切到后台（`document.hidden`）自动停轮询；切回来立刻补一次
- 拉取失败保留旧数据，只弹 toast，不清面板

**回滚**：前端把频率选成"不自动"就是老行为；后端改回统一 TTL 只需动
`src/finance-data.js` 的 `stale` 过滤条件。

**坑（这次踩到的，记下来）**：
- **不要用 node -e 里的 `fs.writeFileSync` 去改源码**——这次把 `finance-data.js`
  写进了 NUL 字节，文件直接变二进制。要改就用编辑工具整体重写，改完用
  `file.includes(0)` 验一遍没有 NUL。
- `pgrep -f "node server.js"` 会抓到 pgrep 自己，拿 PID 用
  `systemctl show -p MainPID --value billboard`。
- `stats.mode` 只在 `refresh()` 里更新，而 refresh 只在客户端请求时跑。
  所以 `/api/finance/stats` 必须现算（已加 `modeNow()`），否则模式显示会停在旧值。

### 2026-09-21 16:10 — 新增「高股息」板块（红利择时）

**需求**：Vic 看到 `https://chixi.qdiitracker.cn/`（吃息佬·红利择时助手），想
①做一个高股息板块 ②把那个网站整站搬过来 ③学它的选股思路，复刻一个低占用版本
④能保存自己日常关注的个股。

**关于"整站搬过来"——没做，原因记录在案（别再有人试）**：

那个站是 **vinxi / vite-rsc 服务端渲染应用**，每个数字都是它的服务器算好塞进 HTML 的。
我把 4 个前端 bundle 全扒下来搜过：**一个 fetch / API 调用都没有**（只有 RSC 的
Server Action 框架代码）。所以"扒下来"得到的是空壳 —— 所有数字都会是 `—`，
因为算数字的服务器不会跟着搬。加上那是人家的产品（品牌、文案、80KB 样式表），
整站复制既侵权又脆弱（他改个接口你的副本立刻死）。

**改走复刻路线，而且验证过是精确复刻不是"大概像"**：拿招行 600036 用我自己的
数据源重算，得到 3× 国债锚 = **5.046%**，参考站页面显示 **5.05%** —— 同一个数。

**方法论**（都是公开的标准做法，不是抄来的）：
- 估值锚：**当前股息率 ≥ 3 × 十年期国债收益率** 才算便宜。
  国债 = 无风险利率；乘 3 = 索要股权风险补偿。
- 买点网格：`目标价 = 每股分红 ÷ 目标股息率`，档位 **3.0/3.3/3.6/3.9/4.2/4.5 × 国债**。
- 技术位置：价格在**布林带（20期/2σ）下轨上方**多少 —— ≤3% 进入、3~5% 临近
  （周月放宽到 5%/8%，大周期波动本就更大）。
- 信号：估值达标 + 日周月技术位置同时到位 = **买入共振**；只到一边 = 临近/等待。
- 质量检测（先选对再等到）：连续分红年数 ≥5、市值 ≥100 亿、PE>0、分红未断崖下滑。

**数据源（实测，海外 VPS 上跑的结论）**：

| 数据 | 源 | 结果 |
|---|---|---|
| 实时价 / PE / PB / 市值 | **腾讯 `qt.gtimg.cn`**（GBK） | ✅ 192ms |
| 前复权 日/周/月 K 线 | **腾讯 `web.ifzq.gtimg.cn/appstock/app/fqkline/get`** | ✅ 227ms |
| 分红送转历史 | **东财 `datacenter-web` RPT_SHAREBONUS_DET** | ✅ 405ms |
| 十年国债收益率 | **中债官网 `queryGjqxInfo`** | ✅ 2.5s |

**⚠️ 东财 push2 / push2his 对海外 IP 已封**：`push2` 返回 502，`push2his` 直接
`RemoteDisconnected`（社区记录 2026-08-22 起）。**行情和 K 线一律走腾讯**，
不要再用 `push2his.eastmoney.com`。`datacenter-web` 不受影响。

**踩坑（血泪，都在代码注释里复述了一遍）**：
1. **东财 `PRETAX_BONUS_RMB` 是「每 10 股派息（含税）」，不是每股** —— 要 `/10`。
   证据：招行 `10派20.00元(含税)` 对应字段值 `20`。
2. **`REPORT_DATE` 形如 `2025-12-31 00:00:00`** —— 判断年末必须用
   `slice(5,10)==='12-31'`，用 `endsWith('12-31')` 会永远为 false，
   导致"完整财年"判定失效、连续分红年数误报成 0。
3. **中债接口不是 JSON**：`POST /cbweb-cbrc-web/cbrc/queryGjqxInfo?&workTime=YYYY-MM-DD&locale=zh_CN`，
   返回 **HTML 表格片段**。要按**表头里「10年」那一列的序号**去数据行取值
   （数据行首列是「中债国债收益率曲线」）。列数对不齐时用倒数第二列兜底。
4. 中债是**日终**数据，当天可能还没发布 → 要往前找最近工作日。
   **串行找要 5 秒**（每天一次请求各 2.5s），改成前 3 个候选工作日**并发**试。
5. 腾讯返回 **GBK**，`decode: 'gbk'`，否则股票名全是乱码。
6. **`custom` 里缓存 null 是灾难**：`once()` 里必须判断
   `if (value != null && !(数组且为空))` 才写缓存 —— 否则一次网络抖动
   会把「国债锚」锁死 6 小时。
7. **行情要按「单只」缓存，不能按「整批」缓存**：`getDividend` 先批量拉一次，
   紧接着每只标的自己又查一次，key 不一致的话 3 只股票白打 3 次请求。

**性能（实测，3 只标的）**：

| 场景 | 上游请求 | 耗时 |
|---|---|---|
| 首次冷启动（磁盘无缓存） | 16 | 6043 ms |
| 紧接着再来（内存命中） | **0 新增** | **3 ms** |
| 重启服务后（磁盘恢复） | 10 | 591 ms |
| 新增一只标的 | — | 1872 ms |

- **长周期数据落盘**：国债锚（6h）和分红（12h）写
  `data/dividend-cache.json`，重启后直接恢复。不加这个，每次部署后第一个
  访问者要重付 ~10 秒。行情（30s）和日线（15min）只在内存里。
- 每只标的 **9 次上游**（1 行情 + 3 K线 + 1 分红 + 复用锚）。
- 东财那条线有**自己的串行队列**（间隔 1.6s），所以并发处理多只股票也不会打爆东财。
- 记账内存 **32 MB**，整机 available 256 MB。

**新增文件**：
- `src/dividend-catalog.js` — 策略参数 + 大白话注解 + 初始关注池（改策略只动这个）
- `src/dividend-data.js` — 取数 + 引擎（BOLL、股息率网格、信号判定、磁盘缓存）
- `src/dividend-api.js` — `/api/dividend`、`/stats`、`/watchlist` 增删改
- `modules/dividend.js` — 模块元数据 + `dividend_watchlist` 表 ddl
- `public/js/modules/dividend.js` + `app.css` 的 `.dv-*`
- `server.js` 加了一行 `app.use('/api/dividend', dividendRouter)`

**自检脚本**（以后怀疑坏了就跑）：
- `node scripts/check-dividend.mjs` — 免密签 cookie，打接口，打印每只的
  股息率/买点/距买点/信号 + meta（请求数、缓存命中、耗时）
- `node scripts/test-dividend.mjs 600036` — 不开服务器，直接跑引擎，逐项打印
- `node scripts/smoke-dividend-ui.mjs` — **迷你 DOM 跑前端渲染**。这个救过一次命：
  它抓到 `fiscal.perShare` 漏字段导致 `toFixed` 崩，浏览器里只会表现为面板空白。
- `bash scripts/accept-dividend.sh`（服务器上跑）— 公网资源 + 关注列表增删端到端

**回滚**：删 `modules/dividend.js` 重启即消失（`dividend_watchlist` 表留着不碍事）；
数据源出问题就先看 `/api/dividend/stats` 的 `lastError`。

### 2026-09-21 16:35 — DAX / TOPIX 期货接入（新增第三个数据源 TradingView）

**起因**：Vic 问「为什么 DAX 没有期货？不是有 FDXM1!、TOPIXM1! 吗？」
上面 16:10 那条把 DAX 期货写成「公开免费源里没有」——**品种确实存在，是源没有**，
措辞会让人以为没这个品种，已改正。

**结论：CNBC、Yahoo、stooq、OnVista、新浪 `hf_*` 全都没有 DAX / TOPIX 期货。**
只有 TradingView 的公开只读端点拿得到，而且是 **`delayed_streaming_900` ≈ 15 分钟延迟**。

| 源 | DAX 期货 | TOPIX 期货 | 说明 |
|---|---|---|---|
| CNBC | ❌ code=1 | ❌ code=1 | 只有 `@FCE.1`（CAC）、`@FFI.1`（FTSE）|
| Yahoo | ❌ 404 | ❌ 404 | 只有 `NKD=F`（日经 / CME）|
| stooq | ❌ | ❌ | 整个接口 404，连 `^spx` 都拿不到 |
| 新浪 `hf_*` | ❌ 空串 | ❌ 空串 | 外盘期货不含欧洲股指 |
| 新浪 `znb_*` | 只有现货 | 只有现货 | 见下方「副产品」|
| OnVista | ❌ | ❌ | search 不按关键词过滤，也不覆盖 Eurex |
| **TradingView** | ✅ `EUREX:FDAX1!` | ✅ `OSE:TOPIX1!` | **≈15 分钟延迟** |

**实现**：腿（leg）新增第三种源 `tv`，优先级 `cnbc(有涨跌) → yahoo → tv → cnbc`。
`fetchTradingView()` 单查、并发 4，和 Yahoo 一样「失败只降级、绝不清空」。
TradingView 的 `change` 字段本身就是百分比，反推昨收再算绝对变化。

**为什么用 FDAX 而不是 Vic 提到的 FDXM**：FDAX 是 Eurex 标准合约、成交量更大
（FDAX 6605 vs FDXM 5552），和看板里其他指数期货（ES / NKD / FCE / FFI）口径一致。
FDXM 是 1/5 合约价值的迷你版，走势完全一致，要换只改一个字符串。

**副产品（未采用，先记着）**：新浪 `znb_DAX` / `znb_TOPIX` / `znb_CAC` / `znb_UKX` /
`znb_HSI` / `znb_SPX` 能给出**带涨跌幅**的全球指数现货，是纯中文源、无 ToS 顾虑。
以后想给现货腿加第三源降级可以用它。

**连带修掉的三个老问题**：
1. `src/finance-data.js` 整个文件是 **GBK 编码**（不是 UTF-8），中文注释在 Node 里全是乱码。
   已按 GBK 解码重写为 UTF-8，**逐字符校验一致**后才替换。
2. `scripts/syntax-check.mjs` 升级为**编码体检 + 语法解析**双检（非法 UTF-8 / NUL 字节 /
   GBK 残留），不给参数就全项目扫描。以后这类问题不会再漏。
3. `scripts/smoke-test.mjs` 三处过期断言已修：写死的开发密码（改为必须传参）、
   「返回 5 个模块」（现 6 个）、「finance 返回 4 个 slots」（现在 `slots: []`）。现 **30 通过 / 0 失败**。

**验收**（`scripts/verify-futures.mjs`）：
- DAX 现货 25527.65（cnbc, +0.88%）／期货 25714（tv, +0.93%）
- TOPIX 现货 4091.14（cnbc, -0.07%）／期货 4101（tv, +0.44%）
- 全盘 31 指标 / 整块无数据 0 / 单腿无价 0 / errors 0
- 公网 `finance.js` 已更新（资源版本 `f96366f6`，含 TradingView 字样）

**回滚**：删掉 `src/finance-catalog.js` 里 dax / topix 的 `{ label: '期货', tv: ... }` 那两行，
重启服务即可。`tv` 源留着不影响任何现有腿。

**注意**：TradingView 的公开端点属于其 ToS 的灰色地带（禁止自动化抓取）。本看板是私人、
按需触发的（慢档 120 秒、无人访问时 0 请求），风险很低；**若哪天被封或想彻底规避，
删掉这两个期货腿即可**，其余 31 项指标完全不受影响。

### 2026-09-21 17:20 — 新增「风险偏好」分区（信用比价 / 市场广度 / 比特币）+ 台湾加权

**起因**：Vic 问「还能加什么指标让看板更丰富」。我先跑了一轮**全面的源可得性探测**
（`scripts/probe-candidates.mjs`，全部实测过再说话），然后按"填的是哪个洞"给建议——
而不是罗列一堆"能拿到"的东西。

**诊断**：原 31 项里波动率占了 6 项（近 1/5），但**「信用」维度是 0 项**，这是最大的结构缺口。
VIX 只是"保险的报价"（容易被短期对冲需求扰动），信用利差才是"真实的违约定价"。
因此新增分区 **「风险偏好」**（id `appetite`）放在「情绪与仓位」之后，
原二~六分区编号顺延为三~七。

**新增 4 项指标**：

| id | 名称 | 做法 | 源 |
|---|---|---|---|
| `credit` | 信用风险偏好 | HYG ÷ IEF ×100（**派生比价**） | Yahoo |
| `breadth` | 市场广度 | RSP ÷ SPY ×100（**派生比价**） | Yahoo |
| `btc` | 比特币 | 现货 + CME 期货两腿，fast 档 | Yahoo / CNBC |
| `twii` | 台湾加权指数 | 加进「全球股指」分区 | CNBC / Yahoo |

**新机制：派生比价（`ratio` 字段）**。有些指标"比价本身才是信号"，不该展示分子分母。
catalog 里写 `ratio: { num, den, scale, label }`，`compose()` 把两条腿合成**一个展示腿**
（`src: 'derived'`）。涨跌幅用两边涨跌幅相减近似——一阶就够，日内 <1% 波动下误差可忽略。
**取不到分母时自动退回显示原始两腿**，不会变空白。

**上游成本：这 4 项几乎不花钱。** CNBC 一次批量 8 个符号，唯一符号从 33 增到 35，
`ceil(33/8)` 和 `ceil(35/8)` **都是 5 批 —— 边际请求精确为 0**。新增的 Yahoo 单查
只有 credit 2 次 + breadth 2 次 + btc 现货 1 次，且只在 slow 档（120 秒）走一次 ≈ 0.04 次/秒。
冷启动实测 **23 次上游请求**（上次 31 项时是 24 次，没有增加）。

**`breadth` 顺手替掉了一个死项**：原来用麦克莱伦摆动指标看广度，但它要手工录入，
实际常年是空的；RSP/SPY 能自动算出来，直接补上这个位置。

**验收**（`scripts/verify-appetite.mjs`）—— 关键是比值不能只信自己算的：
- 独立去 Yahoo 拉 HYG/IEF、RSP/SPY 反算对账，**偏差 0.000%**
- 7 分区 / 35 指标 / 整块无数据 0 / 单腿无价 0 / errors 0
- 冒烟 30/0、期货回归通过、高股息回归通过

**前端**：新增 `SRC_NAME` 映射，数据源统一显示成人话（CNBC / Yahoo / TradingView / 本站计算），
不再出现 `cnbc`、`derived` 这类内部代号。

**回滚**：删掉 `finance-catalog.js` 里 `id: 'appetite'` 整个分区对象和 `id: 'twii'` 条目，
把分区注释编号改回二~六，重启即可。`ratio` 机制留着不影响其他指标。

**探测到但这次没用上的**（`scripts/probe-candidates.mjs` 可复现）：白银 `@SI.1`、铂金 `@PL.1`、
澳洲 `.AXJO`、印度 `.NSEI`、中概 `KWEB`/`FXI`/`ASHR`、`TLT`/`LQD`；
A 股与港股指数腾讯全通（`sh000300` / `sh000001` / `sh000922` / `sz399006` / `hkHSTECH` / `hkHSCEI`）；
新浪 `znb_` 系列含 **AH 溢价 `znb_HSAHP`**（现 124.0）、`znb_SHCOMP`、`znb_CAC`（均带涨跌幅）。

### 2026-09-21 17:30 — 【事故复盘】smoke-test 会清空真实数据，已修

**现象**：Vic 反馈自己录入的部分 to-do 内容"会消失"。

**根因（是我的锅）**：`scripts/smoke-test.mjs` 第 [9] 步「清理测试数据」写的是

```js
for (const m of ['todos','thoughts','words','sentences']) {
  const list = await req(`/api/m/${m}?limit=1000`);
  for (const it of list.data.items) await req(`/api/m/${m}/${it.id}`, { method: 'DELETE' });
}
```

即**把这 4 个模块的条目全部删光**，而不是只删测试自己建的。今天为验证财务看板改动，
我在真实库上跑了 3 次，于是 Vic 的内容被连带清掉。同时 `kv/finance.draft` 也被无条件写成空串。

**修复**（`scripts/smoke-test.mjs`）：
- 新增 `created` 记录本次测试创建的每个 id，第 [9] 步**只按 id 精确删除自己建的条目**；
  删除失败会打 `[WARN]` 而不是静默。
- kv 改成先读原值 → 写入测试值 → 结束时还原原值。
- 顺带修了几个会被真实数据干扰的断言：搜索/过滤/句子列表不再用 `length === 1`、
  `>= 1` 这种绝对数字，改为判断"本次创建的那条 id 在不在结果里"；测试数据文案统一加
  `冒烟测试用…请勿保留` 前缀，便于人工识别。

**验证**：改动前后各跑一次 `scripts/db-counts.mjs` 对账 —— 行数
`todos 2 / thoughts 1 / words 4 / sentences 0 / dividend_watchlist 4 / kv 4`
**前后完全一致**；测试自身 30 通过 / 0 失败；`kv` 与自选股内容逐条核对未变。

**新增只读工具**（以后动库前后都先跑一遍）：
- `node scripts/db-counts.mjs` — 各表行数
- `node scripts/db-peek.mjs` — kv 键值与 dividend_watchlist 内容（值做截断）
两者都用 `readonly: true` 打开 SQLite，不可能写坏数据。

**规矩（补进上面的运维规矩）**：任何脚本的"清理"逻辑，只能删自己创建的数据，
禁止全表扫删；在真实库上跑破坏性脚本前，必须先 `db-counts.mjs` 存一份基线。

**Vic 的决定**：不恢复已丢失的条目（内容量小，重录不值当）。已丢弃的临时文件
`scripts/smoke-test.mjs.bak-<ts>` 保留在本地作为对照，已在 `.gitignore` 里排除。

### 待办 / 下一步候选

- [x] NS 生效后验证 `https://vic-jianhua.me` 可访问（登录 + 建一条数据）
- [x] 每日自动备份 `billboard.db`（cron，保留 14 天）
- [ ] CF 面板：SSL/TLS 加密模式设为 **Full**；Edge Certificates 打开 **Always Use HTTPS**
- [x] finance 看板（24 项指标 / 6 分区 / 实时拉取 / 详细注解）— 2026-09-21 已上线
- [x] 日经225ETF(513880) Bark 推送 — 2026-09-21 新建脚本 + 装 cron（15:15 工作日）
- [x] 前端静态资源缓存问题 — 2026-09-21 改为自动版本号
- [x] 密码已确认是 Vic 自己的（登录验证过 200）。
      ⚠️ **2026-09-22 事故**：这一行原来把明文密码写进来了，而本仓库是**公开仓库**，
      已随 2026-09-21 18:15 的 push 泄露到 GitHub。**按已泄露处理：密码必须换。**
      明文已于 2026-09-22 抹除，永远不要再写进任何文件、提交、聊天记录。
- [ ] **Vic 侧一次硬刷**（Ctrl+Shift+R）才能看到新 finance 看板（旧缓存需手动清一次）
- [x] finance 看板分级实时刷新（fast 20s / slow 120s，无人观看 0 请求）
- [x] **高股息板块（红利择时）** — 2026-09-21 上线：国债锚 / 股息率网格 /
      日周月布林带位置 / 质量检测 / 关注列表存 SQLite
- [ ] 高股息：把「红利指数」（中证红利 000922 等）也接进来，看整体位置
- [ ] 高股息：模拟盘（前向交易记录 + 策略复盘）—— 参考站有这块，我还没做
- [x] **DAX / TOPIX 期货接入** — 2026-09-21 上线（第三数据源 `tv` = TradingView，约 15 分钟延迟）
- [x] **「风险偏好」分区** — 2026-09-21 上线：信用比价（HYG/IEF）+ 市场广度（RSP/SPY）+
      比特币，另加台湾加权指数，全看板 35 项
- [ ] 可选：A 股与港股指数（腾讯 `sh000300` / `hkHSTECH`，已实测可得）+ AH 溢价（新浪 `znb_HSAHP`，
      需给腿新增 `sina` 源）—— 这次 Vic 没选这组
- [ ] 可选：给现货腿加新浪 `znb_*` 作第三源（带涨跌幅、中文源、无 ToS 顾虑）
- [ ] finance 模块接入 `etf-monitor` 已抓的行情数据
- [ ] 想更快？把 `TTL.fast.active` 调到 10_000 即可，前端同步加个选项
      （注意上游请求会翻倍到 ~0.55 次/秒，仍在安全区，但别再往下压）
- [ ] todo 到期 / 提醒 → 复用 `fng-bark` 的 Bark 推送通道
- [ ] 内存与磁盘告警（512MB 机器）
- [ ] 域名 2027-09-21 到期前提醒续费
- [x] **修复 smoke-test 清空真实数据的隐患** — 2026-09-21 17:30：清理改为按 id 精删自己建的数据，
      新增只读对账工具 `scripts/db-counts.mjs` / `scripts/db-peek.mjs`，运维规矩加第 6、7 条
- [x] **清理 `scripts/`** — 2026-09-22：25 个一次性脚本（12 个 `probe*.mjs`、5 个
      `probe-a-share*.py`、3 个 `patch-*.mjs`、`diag-data` / `fin-direct` / `fin-test.sh`
      以及根目录草稿 `_boot.mjs` / `_t50.mjs`）挪进 `scripts/archive/`，并写了
      `scripts/archive/README.md` 说明每一类是干嘛的。`scripts/` 根下只留能复跑的。
      `.gitignore` 改为忽略所有 `_` 开头的草稿文件，避免再被误提交。
- [x] **换掉看板登录密码** — 2026-09-22 09:50 已换（新密码只给 Vic，**不写进任何文件**）。
      实测：新密码 200、旧（泄露的）密码 401、错误密码 401。
      换密码前先备份了 `.env` 到 `/root/billboard-env-before-pwrotate-<ts>`。
- [x] **把所有旧会话踢下线** — 光改密码不够：`set-password.js` 会**沿用**旧的
      `SESSION_SECRET`（注释里说是"免得把已登录设备踢下线"），所以泄露期间发出去的
      cookie 本来还能用满 30 天。已跑 `node scripts/rotate-session-secret.mjs` 轮换密钥，
      实测旧密钥签的 cookie → 401，新密钥 → 200。**以后凡是"密码泄露"，改密码 + 轮换
      SESSION_SECRET 两步都要做。**
- [ ] **【Vic 做】把 GitHub 仓库转成 private** — `dash2080super-sketch/SELF-INTRODUCTION`
      目前是 **public**。路径：仓库页 → Settings → 最下方 Danger zone →
      **Change repository visibility** → Make private。10 秒的事，我没 token 改不了。
- [ ] 已决定**不做** git 历史重写（不 force push）。意味着 `ac2ca2c`～`d4e18d3` 这几个
      旧提交里的明文密码**仍在仓库里**，只是仓库转 private 后不再对外。
      如果哪天要把仓库重新公开，必须先重写历史。
