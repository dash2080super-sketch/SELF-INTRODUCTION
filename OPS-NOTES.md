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

### 2026-09-22 10:00 — 登录页改为真表单提交（修 Safari 不提示保存密码）

**现象**：Vic 问"为什么 Safari 之类不会自动记下这个网站的密码"。

**根因三条**（`public/login.html` 原实现）：
1. **主因**：`form.addEventListener('submit', e => { e.preventDefault(); fetch('/api/login', …) })`。
   Safari / iCloud 钥匙串靠「**浏览器原生表单提交 + 之后发生页面跳转**」识别登录，
   fetch 提交它认不出来。Chrome 启发式宽松（会看后续跳转倒推），所以 Chrome 上
   偶尔会弹、Safari 上从来没有。
2. 密码框只有 `autocomplete="on"`（在 form 上，密码场景基本是废值），
   缺 `autocomplete="current-password"`。
3. 只有密码框没有用户名框 —— 密码管理器天生按「用户名 + 密码」配对存，
   纯密码表单命中率低。

**改动**：
- `public/login.html`：`<form method="post" action="/api/login">`；密码框加
  `autocomplete="current-password"`；新增一个**屏幕外**的
  `autocomplete="username"` 固定值框（用 `left:-9999px` 而不是 `display:none`——
  后者会被 Safari 直接忽略）；删掉 fetch，错误改由服务端重定向带回
  （`/login.html?e=1|2|3`，页面读 query 显示）。
- `server.js`：加 `app.use(express.urlencoded({ extended:false, limit:'1mb' }))`。
- `src/auth.js` `handleLogin`：**按 Content-Type 分流**——
  `req.is('json')` 为真就照旧返回 JSON（脚本与 `smoke-test` 依赖 `200 + {ok:true}`），
  否则是浏览器表单，成功 `303 → /index.html`、失败 `303 → /login.html?e=N`。

**验证**：本机起一次性实例（`_verify-login.mjs`，临时改 `.env` 用完还原）跑 11 项全过；
线上实测 表单正确 `303 → /index.html`、表单错误 `303 → /login.html?e=1`、
JSON 正确 `200 {"ok":true}`；线上 `smoke-test` **30 通过 / 0 失败**。

**部署注意（重要）**：这次**没有**用 `deploy.sh`（git pull）。
服务器上还压着**没进 git 的活代码**——`server.js` 多了 36 行
（`/timing` 静态页 + Global Radar 反代 + `import http`），
`modules/globalradar.js`、`modules/timing.js` 及对应前端文件全是 untracked。
直接 `git checkout -f` / `git pull` 会把这些冲掉。所以只 scp 了
`login.html` 与 `src/auth.js`，`server.js` 用补丁脚本**只插一行**并校验
`/global-radar` 与 `/timing` 仍在。**以后动 server.js 前先看 `git status`。**

**回滚**：把 `login.html` 换回 fetch 版、`auth.js` 的 `handleLogin` 改回一律 JSON 即可，
`express.urlencoded` 留着无害。

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
- [ ] **【要紧】服务器上有一批活代码从来没进 git**：`modules/globalradar.js`、
      `modules/timing.js`、两个对应前端文件，以及 `server.js` 里那 36 行
      （`/timing` 静态页 + Global Radar 反代）。**VPS 一挂就全没了，GitHub 上也没有。**
      下次动 `server.js` 之前先把这批拉回来提交。
- [ ] **【Vic 做】把 GitHub 仓库转成 private** — `dash2080super-sketch/SELF-INTRODUCTION`
      目前是 **public**。路径：仓库页 → Settings → 最下方 Danger zone →
      **Change repository visibility** → Make private。10 秒的事，我没 token 改不了。
- [ ] 已决定**不做** git 历史重写（不 force push）。意味着 `ac2ca2c`～`d4e18d3` 这几个
      旧提交里的明文密码**仍在仓库里**，只是仓库转 private 后不再对外。
      如果哪天要把仓库重新公开，必须先重写历史。

## 2026-09-22 11:45 修复 /global-radar/ 404（Cannot GET /global-radar/）

**现象**：https://vic-jianhua.me/global-radar/ 报 Express 默认 404 `Cannot GET /global-radar/`。

**原因**：10:40 那次 life 模块补丁，是从一份**不含 radar 反代**的基线重写了 server.js，
把 `/global-radar` → `http://127.0.0.1:8787` 的转发整段弄丢了。
上游 Python 服务（globalradar.service，127.0.0.1:8787）一直是 healthy，纯粹是没人转发过去。

**修复**：
- 脚本 `/opt/billboard/patch-radar.mjs`（幂等：已打过直接退出；自动备份 `server.js.bak-radar-<ts>`；
  `node --check` 不通过自动回滚）。把 `import http from 'node:http'` 和 `/global-radar` 反代插回
  `/timing` 静态挂载之后（在 authGuard 之后，所以必须登录）。
- `systemctl restart billboard`；commit `de85536`。

**验证**：带 cookie 访问 `/global-radar/` → 200 / 11187B；`static/style.css` 200；
`api/overview` 200（234KB，数据时间 11:45 新鲜）；未登录 → 302。

**教训（重要）**
1. 补丁脚本必须基于**当前线上 server.js / git HEAD** 改，绝不能用旧基线整体覆盖 ——
   这次就是基线老化把别人的路由抖掉了。以后打补丁前先 `grep` 确认 `/timing`、`/life`、
   `/global-radar` 三条挂载都还在。
2. 改完立刻 `git add server.js && commit`。deploy.sh 现在是 `git pull --ff-only`，
   本地 commit 是安全的；但任何 `git checkout -f` 都会把未推送的改动清空。
3. VPS 本地目前领先 `origin/main` **3 个 commit**（`65f1619` n225 / `3aac480` life / `de85536` radar），
   **全都还没 push**（GitHub 部署 key 待 Vic 贴公钥）。VPS 一挂就全没了。

## 2026-09-22 12:05 Global Radar 铺满屏幕（后续调整）

**诉求**：雷达嵌在 billboard 里只占中间一条（main 默认 max-width:1040px），也没铺满。

**实测数据（Chrome CDP，1664x905 视口）**
| 指标 | 修前 | 修后 |
|---|---|---|
| `main` 宽度 | 1040px | **1600px** |
| iframe 宽度 | 1004px | **1564px** |
| `.tech-layout` 列 | `1fr`（被压塌） | **`1130px 380px`** |
| K线图容器 | 0×0 | **1130×581** |
| ECharts 实例 | null | **1128×579** |

**改动**
1. `public/css/app.css` 末尾加 `main:has(> .panel[data-id="globalradar"].active){max-width:1600px}`。
2. `/opt/globalradar/static/index.html` 末尾注入 `#bb-embed-css` + `#bb-embed-js`：
   仅在 iframe 嵌入时生效（referrer 含 `global-radar`，或宽度超过 screen.availWidth），
   直接访问 `/global-radar/` 不受影响。注入内容：tech-layout 改 1fr+380px；
   `.chart/.chart.big/.chart.huge` 高度改 `clamp(...,vh,...)` 随视口长；ResizeObserver + resize 时 `echarts.resize()`。

**踩的坑（重要，同类错误犯了两次）**
- 第一版把注释写成 `…（和 life 同理） /* billboard-embed-fill */ */` —— 注释里又开了 `/*`，
  CSS 一吃到第一个 `*/` 就结束，多出来的 `*/` 是非法 token，**整条 :has() 规则被丢弃**，
  所以规则「看起来写进去了」但 `main` 仍是 1040px。修法：注释里永远不要再写注释符号，
  并加配平自检（注释数、花括号数必须相等）。
- 同一错误在 `<style>` 注入块里又犯一次，导致 tech-layout 覆盖样式整块失效。
  第二版改为**注入段零注释**，CSS 用 `JSON.stringify` 生成，脚本里加 `window.__BB_EMBED_OK` 便于远程断言。
- 结论：往别人页面注入 CSS/JS 时，注释一律不写；用 id 标记 + 运行时标志位做可验证性。

**验证工具**：本机 `cdp-verify2.cjs`（纯 node，手搓 WebSocket 连系统 Chrome 的 CDP，
`Network.setCookie` 登录 → 点 tab → `Runtime.evaluate` 取跨 iframe 尺寸 → `Page.captureScreenshot`）。
注意 agent-browser 的 win32 原生二进制在这台机器上 **os error 216**（版本不兼容），
且 VPS 只有 458MB 内存不适合装 Chromium，所以走「系统 Chrome + CDP」这条路。

**提交**：`3c6095f`（第一版）→ `dd8ce31`（修注释 bug + 重写注入段），均在 VPS 本地，未 push。

## 波段工作台（swing）

新 tab：监控想做波段的 A 股 / 港股自选，低于买点 / 高于卖点整行换色。

**组成**（virtual 模块，不用通用 CRUD）：

- `modules/swing.js` —— 模块声明（`virtual: true`）
- `src/swing-tables.js` —— `initSwingTables(db)` 建 `swing_watch`（含 columns repairs）
- `src/swing-api.js` —— `/api/swing/{quotes,watch,resolve}`，写操作负责 code → secid 归一化
- `src/swing-data.js` —— 东财取价 + 信号计算
- `public/js/modules/swing.js`、`public/css/swing.css` —— 前端渲染
- `server.js` —— `app.use('/api/swing', swingRouter)`

**踩过的坑（都是会静默出错的那种，改之前先看这里）：**

1. **海外 VPS 访问东财会被 302**。`push2.eastmoney.com` 返回 302 到 `push2delay.eastmoney.com`，
   Node 的 fetch 跟跳转时不时会直接报 `fetch failed`（页面整屏变「无行情」）。
   所以 `EM_HOSTS` 把**延时节点排第一**、push2 当备用：实测 5/5 成功，约 2 秒，
   比绕跳转还快一倍（绕跳转约 4 秒）。
2. **小数位只有单股接口可信**。`ulist.np` 返回的 `f59` 是脏数据（实测 81.29 / 64.04 这种），
   只有 `stock/get` 的 f59 能用。策略：首次见到某标的时用单股问一次并把 `decimals` 落库，
   之后一律走批量（一次请求拉全部，与标的数量无关）。`decimals = 0` 表示「还没问过」，**不猜**——
   猜错一个数量级，港股 454.6 会变 45.46，而且错得很像真的。
3. **空价格会被判成买点**。JS 里 `null <= 420` 是 `true`，不拦住的话行情一断，
   整屏齐刷刷变「到买点」——这是会让人真下单的假信号。`signalOf` 必须先判 `price != null && Number.isFinite(price)`。
4. **`div.innerHTML = '<tr>...'` 是无效的**。解析器的 div 上下文会把 `<tr>` `<td>` 当垃圾丢掉，
   只剩里面的内容，于是 `class="sw-editing"` 这个外壳凭空消失，保存时 `querySelector('.sw-editing')` 拿到 null。
   新增表单插进 `#sw-body`（div）→ 用 div 版；行内编辑替换 tbody 里的 tr（上下文是 tbody）→ 用 tr 版。
5. **`@import` 必须写在所有规则之前**。追加到 app.css 末尾会被浏览器**静默忽略**，
   控制台一句警告都没有，表现就是「CSS 明明传上去了却完全没生效」。
   现在 swing.css 的 import 位于 app.css 第一行。

**刷新策略**：间隔存 `localStorage['swing:interval']`（默认 5 分钟，可选 30 秒 / 1 分钟 / 5 分钟 / 10 分钟 / 仅手动），
只在「页面可见 + 该 tab active」时轮询。后端 25 秒缓存窗口 + 请求合并 + 60 秒后台预热，
10 分钟没人访问自动停预热（不白烧 VPS）。

**拉价失败时**：回退上一次的快照并标 `stale`，前端在价格后面显示一个灰色「旧」字，
而不是让价格突然变成「—」。

---

## ndxspx · NASDAQ & S&P 加仓决策（2026-09-24 上线）

**是什么**：把投资大师圆桌报告里的多因子加仓系统，做成了 billboard 的一个新 tab「🇺🇸 NASDAQ & S&P 决策」。
回答三件事：今天能不能加、加哪条腿（SPY / QQQ）、加多少。

**目录**

| 路径 | 作用 |
|------|------|
| `/opt/ndxspx/daily_decide.py` | 判定引擎（唯一一份判定逻辑，改规则只改这里） |
| `/opt/ndxspx/latest.json` | 最新判定结果（前端读它） |
| `/opt/ndxspx/history.jsonl` | 每次判定追加一行（前端历史表用它） |
| `/opt/ndxspx/state.json` | CB-2 冷却的持久化状态 |
| `/opt/ndxspx/config.json` | 可选。覆盖默认参数，不存在就用代码里的 DEFAULT_CONFIG |
| `/opt/billboard/modules/ndxspx.js` | virtual 模块定义（不建表） |
| `/opt/billboard/src/ndxspx-data.js` | 取数 + 真刷新 |
| `/opt/billboard/src/ndxspx-api.js` | `GET /api/ndxspx`（`?refresh=1` 真重跑） |
| `/opt/billboard/public/js/modules/ndxspx.js` | 前端渲染器 |

**cron**（北京时间，VPS 时区 = Asia/Singapore = UTC+8，与北京一致）

```
30 8  * * * cd /opt/ndxspx && /usr/bin/python3 daily_decide.py --quiet >> /opt/ndxspx/run.log 2>&1
30 15 * * * cd /opt/ndxspx && /usr/bin/python3 daily_decide.py --quiet >> /opt/ndxspx/run.log 2>&1
```

美股收盘是北京时间 04:00；财政部曲线约 02:30 出，Yahoo 点位 08:00 前到位，
所以 08:30 主跑一遍；15:30 再跑一遍补 CBOE 这种会滞后 1~5 个交易日的源。

**数据源（全免费、无 key、VPS 海外直连）**

| 数据 | 来源 |
|------|------|
| 10Y / 2Y / 3M | 美国财政部日度国债收益率曲线 CSV |
| TIPS 实际收益率 | 美国财政部 real_yield_curve CSV（**2026-09-24 新打通**，之前标「不可得」） |
| VIX / VXN | CBOE 官方 History CSV |
| Fear & Greed | CNN dataviz（**必须带 Referer，否则 418**） |
| ^GSPC / ^NDX / SPY / QQQ / USDCNY | Yahoo chart API |

**PE(TTM) 的处理**：指数级 TTM PE 是付费数据，免费源全废。按 Vic 拍板的
「基准 PE + 价格递推」：每季度财报后填一次 `base_date` + `pe_spx_base` / `pe_ndx_base`，
季度内假设 EPS 不变，每天用指数点位递推盈利收益率。超过 90 天没重填，页面黄字告警。

**改参数**：编辑 `/opt/ndxspx/config.json`（只写要覆盖的键），下次 cron 自动生效，不用改代码。

**手跑一次**：`cd /opt/ndxspx && python3 daily_decide.py`（约 25~35 秒）

**回退**：改动前的备份在 `/root/billboard-backup-ndxspx-*.tar.gz`；
server.js / app.css 另有 `.bak-ndxspx-<时间戳>` 就地备份。

---

## 2026-09-26 新增 tab：🌏 日/德/法宏观（`jdemacro`）

一份自包含静态手册页（日本/德国/法国「恐慌指数」与情绪指标全景），**纯增量，server.js 一行没改**。

### 落位（3 个新增文件）

| 文件 | 作用 |
|---|---|
| `/opt/billboard/public/jde-macro/index.html` | 手册本体（48KB，自带完整 `<style>` + 内联 JS） |
| `/opt/billboard/public/jde-macro/vendor/echarts.min.js` | ECharts 5，**已本地化不走 CDN**（境外机房加载 jsdelivr 不稳，照 GlobalRadar 先例） |
| `/opt/billboard/modules/jdemacro.js` | virtual 模块定义：order **60**（排最后），virtual:true，不建表 |
| `/opt/billboard/public/js/modules/jdemacro.js` | iframe 渲染器，src = `/jde-macro/index.html` |

### 为什么不用改 server.js

`publicDir` 的 `express.static` 本来就在 `authGuard` 之后 → **登录保护自动继承**，和 `/etf/index.html` 一个待遇。
不需要像 GlobalRadar（有 Python 后端）那样手写反代。

**两个坑（下次照抄时注意）：**
1. `publicDir` 的 static 是 `index: false`，所以 iframe 的 src **必须写全 `/jde-macro/index.html`**，
   写 `/jde-macro/` 会 404。（`life` 用的是独立目录 + `index:'index.html'`，所以它能用目录形式）
2. 必须用 iframe，不能 innerHTML 注入：手册的 `<script>` 需要执行（ECharts），
   且它自带 `.card` / `.tbl` 类名会和 app.css 互相覆盖。

### 验证记录（2026-09-26）

| 检查项 | 结果 |
|---|---|
| `/api/modules` | ✅ 16 个模块，jdemacro 排最后，icon 🌏 |
| 登录后 `/jde-macro/index.html` | ✅ 200，48,497B，text/html |
| 登录后 `/jde-macro/vendor/echarts.min.js` | ✅ 200，1,034,102B，application/javascript |
| **未登录**访问同路径 | ✅ 302 → `/login.html`（认证已继承，没有裸奔） |
| 响应头 | ✅ 无 `X-Frame-Options`、无 CSP，iframe 不被拦 |
| 回归 index/timing/global-radar/life/api/health | ✅ 全 200 |
| 内存 | ✅ 458MB 总量，部署后 264MB |

### 回滚

纯新增，删掉 3 个文件 + `systemctl restart billboard` 即可，无残留、无备份依赖。

### 更新页面内容

直接覆盖 `/opt/billboard/public/jde-macro/index.html`（属主 `billboard:billboard`），
静态资源 `maxAge: 0` + ETag，刷新浏览器即可，不用重启服务。

---

## 2026-09-26 移动端体验优化（含一个存在已久的隐藏 bug）

用 Chromium 模拟 iPhone 14（390×844, isMobile）逐个点开 16 个模块实测后动手。**桌面端零回归**（1440×900 复查）。

### 一、先体检，结论是「站点主体健康，只有 tab 栏是坏的」

16 个模块在 390px 下 `document.scrollWidth` 全部 = 390，**零横向溢出**。
（drawdown / ndxspx / n225 内部有 10–27 个超宽元素，但都在各自的滚动容器里，不外溢。）
所以**不要**去动各模块的布局 —— 真正的问题只有一个：tab 栏。

### 二、tab 栏（本次主要修复）

**症状**：390px 下 `.tabs` 只拿到 **212px**，而内容宽 1769px。16 个 tab 里 **14 个在屏外**，
右侧没有任何提示，等于把后面 14 个模块藏起来了。

**根因**：`.tabs{flex:1}` 是 `flex:1 1 0%`，而 640px 媒体查询里写的是 `width:100%`。
**flex 项目的 flex-basis（非 auto）优先于 width**，所以那条 `width:100%` 从来没生效过。

**修法**（`public/css/app.css` 末尾新增，不动任何原有规则）：
- `.tabs{flex:1 0 100%}` —— 用 flex-basis 强制独占一行（topbar 本身已 `flex-wrap:wrap`）
- 横滑两侧渐隐遮罩：`.can-l` / `.can-r` 两个 class，只在那一侧还有内容时出现
- `.tab` 缩小内边距与字号，触屏媒体查询 `@media(hover:none)` 再放宽可点区域

`public/js/app.js` 配套：
- 新增 `syncTabsEdge()` —— 维护 can-l / can-r（绑定 scroll + resize）
- 新增 `focusTab(id)` —— `switchTo` 里调用，`scrollIntoView({inline:'center',block:'nearest'})`
  把当前 tab 滚进视野（从 URL hash 直接进来时尤其必要）

**效果**：tab 栏 212px → **366px**（占满一行），一屏可见 2 个 → 3 个，右侧有渐隐提示，
切到最后一个 tab 会自动滚到可见位置。

### 三、iframe 高度（5 个内嵌模块）

`etf / globalradar / jdemacro / life / timing` 五个渲染器原本都是 `height: calc(100vh - 140px)`
+ 各自写死的 `minHeight`（560–760px）。两个问题：
1. 移动端 topbar 会折行变高（实测 **111px**，不是 56px），140px 的预留不够；
2. **iOS Safari 的 100vh 取「地址栏收起」的大视口**，会让 iframe 底部被地址栏盖住。

改为按实测 topbar 高度算 + `100dvh` 修正（不支持 dvh 的浏览器忽略第二行，保留 vh 兜底）：

```js
const reserve = (document.querySelector('.topbar')?.offsetHeight || 56) + 84;
frame.style.height = `calc(100vh - ${reserve}px)`;
frame.style.height = `calc(100dvh - ${reserve}px)`;
```

`minHeight` 统一降到 480px —— 原来的 760px（life）在移动端比可视区还高，必然顶出屏幕。

### 四、手册页 /jde-macro/ 响应式

390px 下原本横向溢出到 **813px**。根因是 12 张表里最宽的 785px（td 内长句/长 URL 撑开列），
而 table 没有滚动容器，直接把 `.wrap` 顶宽。

- 12 张表全部包进 `<div class="tw">`（`overflow-x:auto`，容器负责横向滚动）
- `@media(max-width:720px)`：收窄 `.wrap` padding、各级字号、th/td padding
- `code{word-break:break-all}` —— 长 URL 必须能断
- 图表：`grid.left` 130px 在 390px 屏上吃掉三分之一绘图区 → `fitChart()` 窄屏收到 92px 并降字号；
  顺带补了 `resize` 监听（**原版没有**，转屏后图表不跟着变）
- `#mainChart` 内联 400px → 窄屏 320px（内联样式需 `!important` 才盖得住）

结果：**390 → 390，零溢出**；桌面端图表仍为 400px，未被影响。

### 五、⚠ 顺手修掉一个存在已久的隐藏 bug（重要）

**症状**：首页控制台报 `SyntaxError: Invalid or unexpected token`，位置 index.html 第 8 行。

**根因**：`server.js:157` 对整份 HTML 做
`html.replaceAll('__ASSET_V__', ASSET_V)`，
而 index.html 第 8 行是 `<script>window.__ASSET_V__='__ASSET_V__';</script>` ——
**变量名本身也被替换**，实际下发的是：

```html
<script>window.27dceeaa='27dceeaa';</script>   <!-- 非法标识符 -->
```

**为什么这个 bug 很要命**：不止是控制台报错。脚本解析失败 → `window.__ASSET_V__` 从未被赋值 →
`app.js` 里 `window.__ASSET_V__ || '0'` 永远拿到 `'0'` → **所有模块都以 `?v=0` 加载**。
后果是改了任何模块文件，浏览器都照旧 URL 命中缓存，**用户刷新也拿不到新版**。
（本次的 iframe 高度修复就受影响。）

**修法**（不碰 server.js 的替换逻辑，只改两个前端文件）：
- `index.html`：删掉那行内联脚本（占位符现在只剩 css link 与 app.js src 两处，都在「值」的位置，替换正确）
- `app.js:130`：`const v = new URL(import.meta.url).searchParams.get('v') || '0';`
  —— app.js 本身就是 `<script type="module">`，`import.meta.url` 里带着 `?v=<hash>`。

**验证**：模块请求已变为 `/js/modules/todos.js?v=774970ab`（此前是 `?v=0`），首页零 JS 报错。
**别再改回内联脚本那种写法。**

### 六、顺手清掉一个 404

`/opt/life-board/index.html:4` 有 `<script src="/page/page_comm/inject.js">` ——
文档平台导出页面时残留的注入标签，`/page/` 目录在服务器上从来不存在，
每次打开「生活工作台」都白跑一次 404。已删除（备份 `index.html.bak-inject404-20260926-152048`）。

### 七、改动清单与回滚

| 文件 | 改动 | 备份 |
|---|---|---|
| `public/css/app.css` | 末尾追加移动端 tab 栏段落（不改原有规则） | `.bak-mobile-20260926-151444` |
| `public/js/app.js` | +syncTabsEdge / +focusTab / 版本号改读 import.meta.url | 同上 |
| `public/index.html` | 删掉那行非法的内联版本号脚本 | 同上 |
| `public/jde-macro/index.html` | 表格滚动容器 + 窄屏 CSS + 图表 fitChart | 同上 |
| `public/js/modules/{etf,globalradar,jdemacro,life,timing}.js` | iframe 高度改 dvh + 实测 topbar | scp 覆盖，原件见本地 staging |
| `/opt/life-board/index.html` | 删残留脚本标签 | `.bak-inject404-20260926-152048` |

回滚：`cp <备份> <原文件> && systemctl restart billboard`。

### 八、⚠ 用户端需要做一次硬刷新

因为修好之前一直下发 `?v=0`，你手机浏览器里**很可能缓存着旧的 app.js / 模块文件**。
新版 CSS 会自动更新（`/css/app.css?v=<hash>` 一直是对的），但 JS 模块要等这一版生效后才会换 URL。
Safari 上如果 tab 栏还是老样子，下拉刷新一次，或到「设置 → Safari → 清除历史记录与网站数据」。

---

## 2026-09-26 全站体检（第 2 轮）：数据源断供 + 一处误导性时间戳

Vic 要求「仔细检查，认真修复」。按五层扫：服务/端口 → 路由/资源 → 浏览器运行时 → 数据源健康 → 数据准确性。
**结论：站点结构是健康的（16 模块零控制台报错、零失败请求、路由全 200），问题全在「数据来源」这一层。**

### 一、最要命的：波段工作台（swing）整个模块拿不到行情

**症状**：6 只标的现价 / 昨收 / 涨跌幅**全是 null**，表格整片显示「无行情」，顶部挂一个 `HTTP 502`。

**根因**：东方财富从境外 IP 全通道封禁。实测这台机器（新加坡）：

| 主机 | stock/get | ulist.np |
|---|---|---|
| `push2.eastmoney.com` | 502 | 502 |
| `push2delay.eastmoney.com` | 502 | 502 |

但同一个问题**在 2026-09-25 晚就已经发生了** —— `src/etf-data.js` 的注释里明确记过
（「push2/push2delay 的 clist、stock/get 全部 502」），ETF 模块当时就改成腾讯为主源活了下来。
**只有 swing-data.js 没跟着改**，仍然只认东财，所以它单独挂了。

**一个必须记住的坑**：修的时候我一度以为「给 EM_HOSTS 加数字子域（1.push2 / 2.push2 …）」就够了 ——
15:38 实测那批子域确实全部 200，`ulist.np` 也能正常返回真实数据。
**但 15:50 再测，全部变成 timeout（000）。12 分钟就失效了。**
所以：**东财的子域可用性是完全飘忽的，不能作为唯一依赖。** 只打补丁必然再次翻车。

**实际修法**（`src/swing-data.js`，东财优先、腾讯兜底）：
1. `EM_HOSTS` 补上数字子域当第三～五顺位（裸域保留在前，万一日后放开仍然优先走官方延时节点）
2. **新增 `txBatch()`** —— 腾讯 `qt.gtimg.cn` 批量行情，返回结构与 `fetchBatch` 完全同构
   （内部把带小数的报价串反乘 `10**decimals`，调用侧一行不用改）
3. **新增 `txFetchOne()`** —— 单只兜底，主要为了拿可信的小数位
   （东财那个 `f59` 已经问不到了；腾讯反而更直接：报价串 `"2.118"` 一看就是 3 位小数）
4. 批量失败 → 自动切腾讯，并在响应里加 `source` 字段记录这一轮是谁喂出来的

**为什么腾讯是可信替代**（交叉验证，两点同价）：
贵州茅台 1237.00 / 腾讯控股 436.600 / 比亚迪 84.34 —— 东财与腾讯小数点后完全相同。
小数位也都对：ETF 与港股 3 位、A 股 2 位。

**修复后的实际效果**（截图见对话）：6 只标的全有价，"贵州茅台 → 到买点"、"日经225ETF → 到卖点" 正确触发。
⚠ 注意：修复前因为价格是 null，信号全被压成 `hold` —— 这是**对的**，code 里有注释说明
（`null <= 420` 在 JS 里是 true，不拦住的话整屏会齐刷刷变成「到买点」，那是会让人真下单的假信号）。
所以这次不是"信号算错"，是"根本没数据"。

### 二、顺手修掉我自己引入的文案不一致

swing 表格底部原本写死「数据由服务端抓取自**东方财富**延时节点」。改成腾讯兜底后这句话就过时了。
已改为读响应里的 `source` 字段动态显示（`public/js/modules/swing.js` 的 `legendHTML()`）。

### 三、ETF 看板：一处很容易骗到人的时间戳

**症状**：页面顶上写「**更新于 15:33:04**」，但同一屏的「行情时间」是 **2026/9/24 16:14:58**。

**根因**：`setStat('更新于 ' + new Date()...)` 用的是**当前时刻**，跟行情时间毫无关系。
只是"这一刻去问了一次服务器"。休市、节假日、上游没更新的时候，页面照样显示一个崭新的时间。

**这个错觉为什么要紧**：ETF 的溢价率、分位、K 线、区间表现全都是用那份`旧数据`算出来的。
顶部一个"刚刚更新"的时间，会让人以为整套数字都是新鲜的。

**修法**：新增 `stampStat()`，显示**行情自己的时间戳**，并在异常陈旧时明说：
```
行情 09/24 16:14 · 腾讯
```
阈值取 **72 小时**：正常周末跨度（周五 15:00 收 → 周一 9:30 开）约 66.5 小时，刚好不误报；
国庆、春节这种长假一定会亮出「滞后 N 天」。

### 四、⚠ 一次我自己的误判（记录下来，别重复踩）

体检时我看到 ETF 显示 9/24 数据、而当天是 9/26，第一反应是「数据滞后一天，bug」。
**核实后推翻**：2026 年中秋 A 股休市 **9/25（五）–9/27（日）**，最后一个交易日就是 9/24。
腾讯和东财两个源都停在 9/24 —— **一致即是正确**，这天本来就该是 9/24。
教训：判断"数据陈旧"前，先查交易日历，别拿自然日当交易日。

### 五、globalradar 的一个 404

`/global-radar/favicon.ico` 404 —— Python 后端不处理这个路径，浏览器每次开页面都白跑一次。
已加 `static/favicon.svg` + `<link rel="icon">`（`static/index.html`）。
**顺带更正**：billboard 主站本来就有 inline emoji 图标（`<link rel="icon" href="data:image/svg+xml,...📌">`），
不会去请求 `/favicon.ico`。我用 curl 测出来的那个 404 是假象，主站**不需要**改。

### 六、数据准确性核验（独立源交叉）

| 指标 | 站点值 | 独立源 | 判定 |
|---|---|---|---|
| VIX | 14.87 | Yahoo `^VIX` 14.87 | ✅ 一致 |
| 纳指100 | 30,608.13 | Yahoo `^NDX` 30,608.13 | ✅ 一致 |
| 美债 10Y | 5.17（财政部平价收益率口径，9/25） | Yahoo `^TNX` 5.184 | ✅ 口径差 1.4bp，正常 |
| 日经225 | 66,364.2（9/25） | globalradar 66,363.98 | ✅ 一致 |
| CNN F&G | 37（fear） | 直连 CNN 端点 37 / fear | ✅ 一致 |
| finance 35 项 | 全部 | — | ✅ 时效均为 0h，无陈旧项 |

实测过程里 **CNN 那个端点不带 `Referer` 会返回 418（反爬）**，带上是 200 —— `fng_bark.py` 一直是带对的。

**一处口径差异（不是 bug，但会影响决策，记下来）**：
「日经225 距高点回撤」两个模块给的值不同：
- `/api/drawdown`：52 周高 **72831.73** → 回撤 **-8.88%**（Yahoo `^N225` 的 `fiftyTwoWeekHigh`，**盘中**最高价）
- `/api/n225`：一年高点 **72366.34** → 回撤 **-8.29%**（`max(最近 250 个交易日**收盘价**)`）

盘中高点必然 ≥ 最高收盘价，所以 72831.73 > 72366.34 是数学必然，两个都对。
但 n225 的**金字塔加仓档位是由这个回撤决定的**，0.59pp 的差可能刚好压过某一档的门槛。
**没有擅自统一**（改任何一边都会动到既有策略行为），留给 Vic 决定要哪个口径。

### 七、端口与安全

**端口配置全部正确，没有该开未开的**：

| 端口 | 绑定 | 用途 | 判定 |
|---|---|---|---|
| 3000 | 127.0.0.1 | billboard | ✅ 只在本机，靠 Tunnel 暴露 |
| 8787 | 127.0.0.1 | globalradar | ✅ 同上 |
| 20241 | 127.0.0.1 | cloudflared metrics | ✅ |
| 22 | 0.0.0.0 | SSH | 需开放 |
| 443 | * | xray VLESS REALITY | 需开放 |

`ufw` active，默认 deny incoming，只放行 22 / 443。Tunnel 指向 `http://127.0.0.1:3000`。
**认证继承正确**：未登录访问 `/index.html`、`/jde-macro/index.html` → 302；`/api/*` → 401。

**这次新装的加固：fail2ban**
- 近 24h 有 **719 次 SSH 爆破尝试**（TOP 来源 31.77.19.10 / 195.178.110.227 / 163.179.39.202）
- 但 `passwordauthentication no` 已生效 → **爆破不可能成功**，风险等级低
- 真正的问题是日志被刷爆 + 每轮 fork 一次 sshd，对 512MB 机器是白耗
- 已安装 fail2ban + `/etc/fail2ban/jail.d/sshd.local`（`maxretry=5 / findtime=10m / bantime=1h`，刻意保守防误封）
- `PermitRootLogin` **保持不动**：密码认证已关，root 只能密钥登录，现状已安全；改它有微小锁死风险，不值当

### 八、遗留事项（未动，需要 Vic 决定）

1. **服务器需要重启**（内核从 6.8.0-139 起就挂着 reboot-required）。会中断约 1 分钟，
   所有服务都是 enabled 会自动回来，但**重启时机由 Vic 定**。
2. 23 个待安装更新（含 1 个安全更新）。
3. 上面第六节那个日经回撤口径二选一的问题。

### 九、改动清单与回滚

| 文件 | 改动 | 备份 |
|---|---|---|
| `src/swing-data.js` | EM_HOSTS 补数字子域 + 新增 txBatch/txFetchOne 腾讯兜底 + source 字段 | `.bak-fnq-20260926-154449` |
| `public/js/modules/swing.js` | 数据源文案改为动态读 `source` | `.bak-srcnote-20260926-160621` |
| `public/etf/index.html` | 新增 `stampStat()`，状态栏改显示行情时间 | 本地 staging 有 orig |
| `globalradar/static/index.html` + `favicon.svg` | 补 favicon link（新增文件） | `.bak-fav-20260926-155310` |
| `public/index.html` | 补 favicon link（**实际未改动**，主站已有） | `.bak-fav-*` |
| `/etc/fail2ban/jail.d/sshd.local` | 新增（fail2ban 配置） | 新增文件 |

回滚：`cp <备份> <原文件> && systemctl restart billboard [globalradar]`。
fail2ban 若要去掉：`systemctl disable --now fail2ban`。

## 2026-09-26 17:45 系统更新 + 重启 + 回撤口径统一（Vic 授权）

### 1. 系统更新（23 个，全部装完）
- 第一批 apt upgrade 装 19 个；剩 apparmor / libapparmor1 / libaudit-common / libaudit1 是 phased update 挡住，
  用 `apt-get -y -o APT::Get::Always-Include-Phased-Updates=true upgrade` 补齐。最终 upgradable = 0。
- 含安全更新 libpcap0.8t64（noble-security）、nodejs 22.23.3、cloudflared 2026.9.3。
- 回滚：apt 装回去不现实，出问题只能 `apt-get install <pkg>=<旧版本>`。

### 2. 重启
- `/sbin/reboot` → 内核 6.8.0-142-generic 生效，/var/run/reboot-required 已清除。
- 重启后全部 active：billboard / cloudflared / xray / globalradar / fail2ban。
- 端口仍是 127.0.0.1:3000、127.0.0.1:8787、127.0.0.1:20241，对外只有 22 / 443（xray）。

### 3. 日经回撤口径：统一为 250 交易日收盘高（决策人 Vic 授权我自己定）
**决定**：全站统一用「最近 250 个交易日收盘最高价」，弃用 Yahoo 的 fiftyTwoWeekHigh（52 周**盘中**最高）。

理由（三条）：
1. 加仓档位是收盘后决策、次日开盘执行，盘中高价是当日不可成交的价格，拿它算回撤会系统性虚高
   （日经实测：盘中高 72831.73 → -8.88%，收盘高 72366.34 → -8.29%，差 465 点 / 59bp）。
2. 虚高会让回撤在档位边界上过早跨档（PYRAMID: -10%档3.0 / -6%档2.0 / -3%档1.5），
   对求稳偏好是错方向的误差——本来该保守，结果跳进更激进那一档。
3. /api/n225 一直是 250 日收盘口径，两个接口给出两个数是实打实的自相矛盾。

改动：
- `src/drawdown-data.js`：RANGE_MONTHS 3 → 12（3 个月日线算不出一年高点，必须拉满 250 日）；
  fetchOne 新增 `peak250` / `peak250Date`（收盘序列 slice(-250) 取 max）；
  `high52` 保留但注释标明「盘中口径，仅参考，不用于回撤」。
- `public/js/modules/drawdown.js`：d52 → d250 改用 peak250；卡片文案「距 52 周高点」→「距 250 日收盘高」；
  口径说明新增一条解释为什么不用盘中高。
- 必须删 `data/drawdown-cache.json`（旧缓存只有 3 个月日线，不删会算出 3 个月的高当一年高）。

验证：7 个指数全部拿到 ~250 行日线；日经 peak250 = 72366.34 @ 2026-06-25 → -8.29%，
与 /opt/nikkei/latest.json 的「一年高点 72366.34 / 回撤 -8.29%」逐字一致。
备份：`.bak-20260926-174526`（两个文件各一份），回滚 = cp 回来 + systemctl restart billboard。

### 4. 排查中发现的残留（未擅自启用）
- `/etc/systemd/system/nikkei225-monitor.service`：**disabled + inactive(dead)**。
  它是 Type=simple + Restart=always 的常驻旧方案，已被 cron 里 6 条
  `/opt/nikkei/daily_advice.py --slot am/pm` 取代。**不要 enable**，否则会和 cron 重复触发 Bark 推送。
- etf-monitor / fng-bark 不在 systemd，是 cron 定时任务（见 crontab），ps 里看不到进程属正常：
  - `5 15 * * 1-5` monitor_515450.py
  - `15 15 * * 1-5` monitor_nikkei225.py
  - `30 8 * * *` fng_bark.py（每天）
  - 周六周日 `1-5` 的任务不跑，所以日志停在周五 9/25 是正常现象，不是挂了。

## 2026-09-27 07:00 xray(VPN) 速度/延迟调优 —— 诊断与改动

Vic 反馈 VLESS+Reality 速度慢、延迟大。**结论：两个瓶颈，一个已修、一个修不了。**

### 已修：TCP 窗口是速度天花板
- 原 `net.core.rmem_max` / `wmem_max` = 212992（208KB）。本地→VPS RTT 实测 420ms，
  吞吐上限 = 208KB / 0.42s ≈ **4Mbps**。而 VPS 出网实测 **259MB/s（约 2Gbps）**，带宽根本不是瓶颈。
- 改动 `/etc/sysctl.d/99-xray-tune.conf`（新文件）：
  `rmem_max` / `wmem_max` → 8MB；`tcp_rmem` / `tcp_wmem` max → 8MB；
  `tcp_slow_start_after_idle=0`；`tcp_mtu_probing=1`；`vm.swappiness=10`（458MB 内存已用 171MB swap）。
- 生效方式：`sysctl --system`，不需要重启任何服务。
- **回滚**：`rm /etc/sysctl.d/99-xray-tune.conf && sysctl --system`
- xray 配置微调（备份 `config.json.bak-20260927-063245`，已 `run -test` 通过 Configuration OK）：
  freedom.domainStrategy=UseIPv4、inbound sockopt tcpNoDelay + tcpKeepAliveIdle=60、
  新增 dns 段（1.1.1.1 / 8.8.8.8 / localhost，UseIPv4）。重启 xray 后 443 正常。
- 确认无需改：flow=xtls-rprx-vision 已开、reality target www.bing.com（1.6ms）、BBR+fq 已开、xray 26.3.27

### 修不了：DO 新加坡对联通/电信绕美国
Vic 出口 IP `163.179.39.157`（中国联通）。traceroute 关键跳：
`219.158.96.26`（联通国际出口，200ms）→ `207.45.219.8`（美国，250ms）→ `180.87.151.40`（DO 骨干，410ms）。
反向 mtr 走 Telia `195.219.x`（美国）也是绕。**双向绕美**。

★ **同一机房三网差 8 倍**（VPS 侧实测，目标均为非 anycast 真实机房）：
| 运营商 | 目标 | RTT | 路径 |
|---|---|---|---|
| 移动 | 211.136.192.6 | **38.5ms** | CMI 直连 `223.120.x` ✅ |
| 联通 | 61.135.169.125 | **311ms** | 绕美国 Telia ❌ |
| 电信 | 202.96.209.5 | **375ms** | 绕美国 HE `66.198.x` ❌ |

→ 换机房方向明确：需要 **AS9929 / AS10099**（联通精品线路）。移动反而是直连。
→ 待 Vic 验证：① 手机 4G/5G（若移动卡 → 快 8 倍）② IPv6
   （VPS 有 `2400:6180:0:d2:0:3:21ec:e000`，VPS 走 IPv6 到阿里 DNS 仅 32.6ms，
   暗示 IPv6 路径好得多；若成立则零成本解决，改双栈即可）。

### 现场其他发现
- Vic 家是**双 NAT**：192.168.50.1 → 192.168.1.1 → 联通 CGNAT 10.180.192.1。建议内层路由器改 AP/桥接模式。
- 联通是 **CGNAT**（无公网 IPv4），运营商 NAT 对 UDP 会话老化快 → **Hysteria2 方案已降权**。

---

## 2026-10-01 23:45 — finance 看板：新鲜度显示口径修正 + 两处上游字段坑

### 起因
Vic 反馈"finance 板块有些数据根本不是实时的"。逐项验证（美股盘中 15:22 UTC 取样）：
站点 `/api/finance` 快照 → 服务端直连 CNBC 看全字段 → 独立源交叉
（CBOE 官方延迟报价 / 美国财政部日收益率 / ECB frankfurter / Nasdaq API / TradingView scanner / Yahoo）。
**结论：数值几乎全真，CNBC 这个源很干净；坏的是"新鲜度"这套展示逻辑。**

### 缺陷 1：新鲜度按"服务端取数时刻"算，等于在骗人（主因）
`public/js/modules/finance.js` 的 `freshness()` 用的是 `item.age = now - rec.at`（服务端什么时候取的数），
不是数据自带的时间戳。于是：
| 指标 | 真实数据龄 | 改前页面显示 |
|---|---|---|
| USD/CNY | 29.9 小时 | 「刚刚」+ 「实时」chip（它是 fast 档） |
| 恒生指数 | 39.4 小时 | 「刚刚」 |
| SKEW | 18.4 小时 | 「刚刚」 |
| 日经 / TOPIX 现货 | 8.6 / 8.9 小时 | 「刚刚」 |
| DAX、TOPIX 期货（TradingView） | `time` 字段是 null，源本身 15 分钟延迟 | 「刚刚」 |

**修法**：`src/finance-data.js` 的 `compose()` 新增 `dataAt` / `dataAge`（按各腿自带时间戳算），
前端改用它。多腿指标取哪个时间戳的规则：
- 默认取**最新**那条腿（各腿都新鲜时它就是答案）
- 若最旧与最新的腿差 **30 分钟以上**，说明有条腿明显掉队（通常是那个市场已收盘：
  日经现货停在 15:45 JST、同一张卡的 CME 期货还在跑）→ 按**最旧**算，不能拿活着的腿掩盖停了的腿

阈值也放宽了一圈，因为上游有自己的推送节奏，按刷新周期卡会误判：
- live：fast ≤ 90s / slow ≤ 240s（原来 45 / 200；CNBC 金价约 60 秒一跳，会被打成"不实时"）
- aging：≤ 30 分钟（Yahoo 的 VIX 家族约 15 分钟推一次，CNBC 期货腿比现货慢几分钟）
- old：> 30 分钟 → 直接显示「数据 MM-DD HH:mm」
- "实时" chip 不再按 tier=fast 挂，改成按 `freshness().level === 'live'` 挂

### 缺陷 2：美债 2Y 涨跌幅符号是反的（上游字段坑）
CNBC `US2Y`：`last 4.81%`、`previous_day_closing 4.887%`、`change -0.077`，
但 `change_pct` 返回 **+0.1484%**（正确应为 -1.58%）。财政部官方 9/30 的 2Y = 4.88 → 实际 -7bp。
同组 3M / 5Y / 10Y / 30Y 的 change 与 change_pct 都自洽，**只有 2Y 坏**，所以换源躲不掉。

**修法**：`fetchCnbc()` 里不再信任上游的 `change_pct`。只要 `change` 和 `previous_day_closing`
两个基础字段都在，就自己算 `(change / previous_day_closing) * 100`；缺任一字段才回落上游值。
（对全组回算验证过：3M/5Y/10Y/30Y/SPX/VIX/黄金/BTC 与上游值一致到小数点后 4 位，只有 2Y 被纠正。）

### 缺陷 3：CAC 40 期货是死腿
目录里声明 `{ label: '期货', cnbc: '@FCE.1' }`，CNBC 对该符号返回 `code=None`、字段全空；
取数器拿不到就不写 store → 这条腿**静默消失**，页面上没有任何报错。
TradingView 的 `EURONEXT:CAC1!` 也取不到。
**修法**：撤掉这条腿，CAC 卡片只留现货，`srcNote` 与注解里写明"期货源已失效，暂缺"，
并在目录里留注释：要补期货先读 OPS-NOTES，别把死符号直接加回来。

### 缺陷 4：收益率涨跌用相对百分比，会读错一个数量级
卡片写「10Y 5.272 −0.40%」，那是收益率的**相对**变化（-2.1bp），不是 -40bp。
**修法**：目录给 ust / jgb / eugb 加 `chgUnit: 'bp'`，`compose()` 透传该字段，
前端新增 `chgText()` / `chgCls()`，bp 模式下显示 `chg * 100` 的基点值。

### 改动清单与备份（回滚直接 cp 回去）
| 文件 | 备份 |
|---|---|
| `src/finance-catalog.js` | `.bak-fresh-20261001-234526` |
| `src/finance-data.js` | `.bak-fresh-20261001-234526`、`.bak-fresh2-<部署时间戳>` |
| `public/js/modules/finance.js` | `.bak-fresh-20261001-234526`、`.bak-fresh2-…`、`.bak-fresh3-20261001-235121`、`.bak-fresh3-20261001-235214` |

服务端文件改完 `systemctl restart billboard`；前端文件刷新即可。

### 验证数据（改后，浏览器实测 35 张卡、零控制台错误、上游失败 0 次）
- 美债曲线：`3M -3.9bp | 2Y -8.7bp | 5Y -6.6bp | 10Y -3.8bp | 30Y -2.1bp`（2Y 已由 +0.14% 纠正为负值）
- USD/CNY → 「数据 09-30 17:31」，无"实时"标；恒指 → 「数据 09-30」；SKEW → 「数据 10-01 05:00」
- 日经 → 「数据 10-01 14:45」、TOPIX → 「数据 10-01 14:30」、KOSPI → 「数据 10-01 19:05」、台股 → 「数据 10-01 13:33」
- CAC 只剩「现货」一条腿
- 仍挂"实时"的：信用/广度/BTC/VIX/VIX期限结构/SPX/NDX/SOX/NVDA/美债/德英债/USDJPY/DXY/黄金
- etf / swing 面板复测：etf 面板是 iframe（innerText 为 0 属正常），`/api/etf/snapshot` 与 `/api/swing/quotes` 均 200 且有数据

### 顺带发现（本次未修，与改动无关）
`journalctl -u billboard` 里持续报
`[drawdown] 磁盘缓存写入失败: EACCES: permission denied, open '/opt/billboard/data/drawdown-cache.json'`
—— 文件权限问题，drawdown 的磁盘缓存一直没落盘（每次重启都要重新拉）。要修的话查该文件的属主与
billboard 服务运行用户是否一致。

### 校验用独立源（下次复核直接抄）
- CNBC 批量：`https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=<pipe分隔>&requestMethod=itv&noform=1&partnerId=2&output=json`
- CBOE 官方：`https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json`（curl 要加 `-L`）
- 财政部日收益率：`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv`（日期 MM/DD/YYYY，文件乱序要排序）
- ECB：`https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,JPY,GBP,EUR`
- Nasdaq：`https://api.nasdaq.com/api/quote/NDX/info?assetclass=index`（`isRealTime=false`，15 分钟延迟）
- TradingView：`https://scanner.tradingview.com/symbol?symbol=<X>&fields=close,change,currency,description,update_mode&no_404=true`
- ⚠ **Yahoo 从 Mac 直连被拒**（返回 sad-panda HTML），要从 VPS 打；stooq 从 Mac 也 404。
- ⚠ **别用 Yahoo `BZ=F` 校 Brent**：它 9/30 收 103.53 是换月拼接的假值，真实昨收 98.03。
  正确校准点是 CNBC `@LCO.1` 与 TradingView `ICEEUR:BRN1!`（两者互相印证 +3.8%）。

### 非缺陷，别当 bug 再查一遍
- 恒指停在 9/30：香港国庆休市。SKEW 停在 9/30 17:00 ET：CBOE 收盘后才发布当日值。
- 日经 / TOPIX / 台股时间戳是当地收盘时间；KOSPI 的 20:05 KST（收盘后）是 CNBC feed 自带。
- TOPIX 期货 -1.45% 而现货 +0.57%：现货是 10/1 日盘收盘，期货现在跑 10/2 夜盘，本来就不是一个交易日。
- CNN F&G 出现 27.1142857… 这种无限小数：是 7 个分项的均值，正常。
- USD/CNY 显示 6.7045 与 ECB 当日参考汇率完全一致 —— 值是对的，只是 CNBC 的 `last_time` 不可信。

---

## 2026-10-02 00:08 — drawdown：磁盘缓存权限修复 + 日股"当前价落后一天"修复

### A. 磁盘缓存 EACCES（2026-09-26 起一直在报）
**根因**：`data/drawdown-cache.json` 属主是 `root:root`、权限 644，而 billboard 服务以 `billboard`
用户运行（`billboard.service` 里 `User=billboard`）→ 能读不能写。
文件是 2026-09-26 17:49 有人用 root 跑过一次进程时留下的。
**影响**：`writeDisk()` 一直静默失败（只 `console.warn`，不抛），所以**每次重启都要重新拉全部上游**，
磁盘缓存形同虚设。不是正确性问题——`readDisk()` 有 `DISK_MAX_AGE = 12h` 保护，过期就不读。

**修法**：`chown billboard:billboard` + `chmod 664`，并把 `data/` 目录也统一成 `billboard:billboard 775` 兜底。
顺手扫了全树：`find /opt/billboard -not -user billboard` 出来的其余条目都是只读源码（644 全员可读），
服务不需要写，不用动。备份 `data/drawdown-cache.json.bak-20261002-000824`。
验证：`/api/drawdown?refresh=1` 后文件 mtime 变成 2026-10-02 00:08，属主 billboard，日志近 20 分钟 EACCES 计数 0。

### B. 日股当前价落后一天，回撤算错 3 个百分点（比 A 严重）
修 A 时顺手核了新缓存的内容，发现 **Yahoo 的 `^N225` 日线数组没有当天的那根**：
`meta.regularMarketPrice` 已经是当日收盘 68,956.72，但 `indicators.quote[0].close` 最后一根还停在
09-30 的 66,753.72（`^NDX` / `^GSPC` 有当天那根，只有日股落后）。`1306.T`(TOPIX) 同样。

前端 `metrics()` 里 `const last = closes[closes.length - 1]` 直接拿最后一根当"当前价"，于是：
| 标的 | 改前（错的） | 改后（对的） |
|---|---|---|
| 日经 225 | 66,753.72 → 距 250 日收盘高 **-7.76%** | 68,956.72 → **-4.71%** |
| TOPIX | 431.5 → -1.55% | 434.4 → **-0.78%** |

**这个量级会直接跨过加仓档位边界（-10% / -6% / -3%）**：-7.76% 落在"-10%→-6%"区间，
-4.71% 落在"-6%→-3%"区间 —— 按错的数字会跳进更激进那一档，对求稳偏好是错方向的误差。

**修法（口径要守住）**：
1. `src/drawdown-data.js` 的 `fetchOne()` 新增 `lastPrice / lastDate / lastIsNewer / lastChgPct`：
   `meta.regularMarketTime` 的日期 > 日线最后一根的日期时，用 `meta.regularMarketPrice` 当当前价。
   **只补分子**。`peak250` 仍然只扫收盘序列，盘中价不许污染分母（这条是本站既定口径，别破）。
2. `public/js/modules/drawdown.js` 的 `metrics()` 用 `idx.lastPrice` 当当前价（缺失回落旧逻辑）。
3. `slice()` 里：当日线缺当日那根时，把 `lastPrice` 接到序列尾巴上。不做的话连涨/连跌会漏掉今天、
   累计涨幅的基准会错一天 —— 实测修复前日经显示"连涨 1 天 累计 +5.31%"（今天其实只有 +3.30%）。
   修完是"连涨 2 天 累计 +5.31%"（09-30 +1.94% + 10-01 +3.30%），对得上。

### 改动清单与备份
| 文件 | 备份 |
|---|---|
| `data/drawdown-cache.json` | `.bak-20261002-000824`（修权限前），修 B 时又整个删掉让服务重建 |
| `src/drawdown-data.js` | `.bak-lastprice-20261002-0015xx` |
| `public/js/modules/drawdown.js` | `.bak-lastprice-20261002-0015xx`、`.bak-streak-20261002-001646` |

### 验证（浏览器实测，零控制台错误）
DAX -6.14% / CAC -10.21% / FTSE -4.42% / NDX -1.29% / SPX -2.11% / **日经 -4.71%** / **TOPIX -0.78%**
（距 250 日收盘高口径）。日经最新价 68,956.72 +3.30%、最新交易日 2026-10-01 —— 与 CNBC 的 +3.30% 一致。
缓存文件已由 billboard 用户重建（00:14:39），EACCES 归零。

### 已知残留（未修，量级小、会自愈）
美股盘中时，Yahoo 会把**当天未完成的那根**放进日线数组（close = 当前价）。
若当天正在创新高，`peak250` 会短暂被这个盘中价顶高 → 回撤虚高一点点。
只在创新高当天出现，收盘后自动归位，暂不处理（要修得判断"这根是不是最终的"，Yahoo 的 chart 接口
不给 `marketState`，得另想办法）。

---

## 2026-10-10 06:25 — clipimg 贴图收藏夹「收藏进去不显示」修复

### 真凶（日志实锤，不是猜的）
```
Oct 09 18:09:36  Error: EACCES: permission denied, open '/opt/billboard/data/clipimg/20261009100936-b34c33.png'
                 at file:///opt/billboard/src/clipimg-api.js:68:6     ← fs.writeFileSync
Oct 09 18:09:51  同上  20261009100951-c5c04f.png
Oct 09 18:10:42  同上  20261009101042-05487f.png
```
`data/clipimg/` 是 **root** 建出来的，而 billboard 服务以 `billboard` 用户运行 → 只能读不能写。
Vic 18:09–18:10 贴的 3 张截图，POST 全部 500，文件一张都没落盘。

**为什么他看到的不是"上传失败"而是"收藏进去了但不显示"**：当时的 `handleFiles()` 在循环里
`if (!r.ok) { toast('上传失败（' + r.status + '）'); continue; }`，但循环结束后又无条件
`toast('收藏完成 ✔')` —— **后一句把前一句覆盖掉了**。于是失败被报成成功。
18:16 的提交（5a4dab1）把这段改成分别统计成功/失败，只是把谎报堵上了，没治根因。

目录属主在 18:15 前后被人手工改回 billboard，所以现在能写；根因没留防护。

### 本轮做的四件事

**1. 启动自检（防复发）** `src/clipimg-api.js` 顶部加 `probeWritable()`：
启动时往 `data/clipimg/` 写一个 `.write-test` 再删掉，失败就三行大字打到 journal：
```
[clipimg] ⚠ 存储目录不可写，粘贴收藏会全部失败：/opt/billboard/data/clipimg
[clipimg] ⚠ 原因：EACCES: permission denied ...
[clipimg] ⚠ 修法：chown -R billboard:billboard /opt/billboard/data/clipimg
```
这类"root 建了目录、服务写不进去"的坑本站已经踩第二次了（上次是 `drawdown-cache.json`），
统一由自检在启动时暴露，别等用户第一次用才发现。

**2. 粘贴不再要求"先点进 iframe"（本轮最主要的手感问题）**
`public/js/modules/clipimg.js` 原来只是个 iframe 壳。iframe 没焦点时，粘贴事件只在外层文档冒泡，
里面的监听器一个都收不到 —— 用户按 Cmd+V 完全没反应、连提示都没有。
**真键盘实测**（焦点在外层页面、真实 `Meta+V`）：
| | 修复前 | 修复后 |
|---|---|---|
| 焦点在 iframe 内 | 正常上传 | 正常上传 |
| 焦点在外层页面 | **零反应**（无请求、无提示） | POST 201，正常显示 |

做法：外层渲染器在 clipimg 这一栏处于前台时挂 `paste` / `drop` 的转发器，
把图片 File 通过 `postMessage` 送进 iframe；iframe 侧加 `message` 监听调 `handleFiles()`。
只在这一栏 `active` 时才接管，避免在其他 tab 里把图片吞掉。
另外顺手加了 `hashchange → refresh`：`mount()` 一辈子只跑一次，若从别处（比如手机）传了新图，
切回这一栏会重新拉列表，不再显示旧快照。

**3. 失败原因透出** 前端 500 时不再只报状态码，把服务端 `{error}` 里的原因带进 toast；
API 侧把 POST / DELETE 的落盘包进 try/catch 返回 JSON（以前是 express 的 HTML 错误页），
并给 `express.raw` 的报错（典型是超 30MB）加了 JSON 错误中间件。
写文件成功后才动索引，避免出现"有记录没文件 / 有文件没记录"。

**4. 权限兜底** 部署脚本里带 `chown -R billboard:billboard data/` + `chmod 775`，
`data/clipimg` 目录和 index.json 一并归一。

### 改动清单与备份（`/opt/billboard`）
| 文件 | 备份 |
|---|---|
| `src/clipimg-api.js` | `.bak-paste-20261010-062522` |
| `public/js/modules/clipimg.js` | `.bak-paste-20261010-062522` |
| `public/clipimg/index.html` | `.bak-paste-20261010-062522` |

服务端改完 `systemctl restart billboard`；两个前端文件刷新即可。前端模块带 `?v=<mtime>` 版本号，不会被缓存住。

### 验证（浏览器实测，零页面错误）
- 焦点保持在外层页面 → 真实 `Cmd+V` → `POST /api/clipimg?ext=png` **201**，网格 0→1，
  显示 1 张 · 共 21 KB，图片实际宽度 1200px（真的解码出来了，不是占位框）
- 大图路径：2.9MB PNG → canvas 压到 1800px/1.2MB JPEG → 201 → 正常显示
- 索引一致性：索引条目数 == 磁盘文件数，无孤儿文件、无失效条目
- 删除：DELETE 全部 200，删完索引回到 `[]`
- 启动自检：重启后无告警（说明目录可写）

### 顺带
测试期间上传的 8 张验证图已全部清空，Vic 的收藏夹回到干净的 0 张状态。

### 下次要查这个模块，按顺序看
1. `journalctl -u billboard | grep -i clipimg` —— 有 EACCES 就是目录属主问题
2. `stat -c "%U:%G %a" /opt/billboard/data/clipimg` —— 必须是 `billboard:billboard`
3. `python3` 比对 `index.json` 与目录里的文件名是否一一对应
4. 前端"粘了没反应"先看焦点：粘贴事件归属于有焦点的那个 document，何况还隔着 iframe

---

## 2026-10-10 新增「词汇实验室」tab（scrape Vocabulary.com）

### 落位文件表

| 文件 | 作用 | 是否新增 |
|---|---|---|
| `/opt/billboard/src/vocab-api.js` | 后端：抓词典页 + corpus 例句 API + 音频代理，挂载在 `/api/vocab` | 新增 |
| `/opt/billboard/modules/vocab.js` | 模块定义（`id:'vocab'`，`virtual:true`，`order:31`） | 新增 |
| `/opt/billboard/public/js/modules/vocab.js` | 前端渲染器：iframe 指向 `/vocab/index.html` | 新增 |
| `/opt/billboard/public/vocab/index.html` | 自包含页面：搜索 / 发音 / 释义 / 义项 / 例句（带来源筛选） | 新增 |
| `/opt/billboard/scripts/vocab-parse-test.mjs` | 解析器回归测试（离线 + 在线） | 新增 |
| `/opt/billboard/server.js` | 加两行：`import vocabRouter` + `app.use('/api/vocab', vocabRouter)` | 改 |

`order:31` 是刻意选的：Word List 是 30，紧挨着放，单词相关功能聚在一起；同时不会像大 order 那样在移动端被挤出首屏。
`virtual:true` —— 这个 tab 不建表、不做 CRUD，纯读取 + 展示。

### 为什么必须有后端代理（不能前端直连）

浏览器直连 vocabulary.com 会被 CORS 挡死，本地实测 `fetch()` 直接失败。所以三条数据全走服务端：

- 词典页：`https://www.vocabulary.com/dictionary/<word>` —— 服务端渲染的 HTML，正则解析。
- 例句：`https://corpus.vocabulary.com/api/1.0/examples?query=&maxResults=&startOffset=&domain=` —— 返回 JSON。
- 音频：`https://audio.vocabulary.com/1.0/{us|uk}/<TOKEN>.mp3` —— 按字节代理，缓存 1 天。

音频代理做了 host 白名单（只允许 `audio.vocabulary.com` 和 `sd-pronunciation-processed-videos.sdcdns.com`），**不要**把 `/api/vocab/audio/:word` 改成任意 URL 代理，否则本站就变成一个开放代理了。

缓存：词条 6 小时、例句 1 小时，最多 300 条（`ENTRY_TTL` / `EX_TTL` / `CACHE_MAX` in `src/vocab-api.js`）。

### 两个坑（改解析器前必读）

**坑 1：页面里有两份 IPA 块。** 直接用全局正则抓 `ipa-section` 或音频 token 会抓到错误的那一份（实测会拿到空串或错误音标）。必须把解析窗口限定在 `.ipa-section` … `<a class="ipa-guide"` 之间。

**坑 2：带不带 domain，例句池完全不是一回事。**
- 不带 `domain`：Vocabulary.com 的**精选**语料（"books and articles"），数量小但质量高 —— `engage` 实测 191 条。
- 带 `domain=X`：全量语料库检索，数量大得多 —— `engage` 在 News(N) 下有 6,984 条，F 下 5,600 条。

所以前端的"全部来源"和"新闻"**不是同一个池子的一小部分**，是两个不同的池子，切换时条数会跳变，这是正确行为而不是 bug。
另外分页必须固定走 `/api/1.0/examples`，不要换成 `/examples/random.json`（后者每次返回随机结果，翻页会错乱）。

**坑 3（前端）：** 例句区重绘只重建右列（`state.rightCol`），切来源 / 翻页时左列不动、滚动位置不丢。如果哪天改成整块重绘，先调用 `clearGrid()` 把 `state.rightCol` 置空 —— 否则查询失败后下一次成功查询会渲染到一个已经从 DOM 里摘掉的游离节点上，界面永久卡在"正在抓取…"（这个 bug 真实发生过，`serendipity` 复现）。

### 验证记录（2026-10-10，真实浏览器 + 线上）

| 项 | 结果 |
|---|---|
| `/api/modules` | 18 个模块，顺序 `…words → vocab → sentences…`，meta `{id:'vocab', name:'词汇实验室', icon:'🔬', virtual:true}` |
| 全站路由回归（已登录） | 全部 200：`/index.html` `/api/health` `/api/modules` `/api/finance` `/api/drawdown` `/api/n225` `/api/ndxspx` `/api/etf/snapshot` `/api/clipimg` `/api/vocab/meta` `/jde-macro/` `/etf/` `/clipimg/` `/vocab/` `/timing/` `/life/` |
| 鉴权 | 未登录访问 `/vocab/index.html` → 302；`/api/vocab/*` → 401 |
| `engage` 渲染 | 词头 `engage`；`US /ɪnˈgeɪdʒ/` + `UK /ɛnˈgeɪdʒ/` 各带 ▶；Other forms `engaged; engaging; engages`；10 个义项带同义词；8 条例句且目标词加粗 |
| 来源筛选 | 全部来源 → `1–8 / 191`；切 News → `6,984 句可筛`、`1–8 / 6984`；翻页 → `9–16 / 6984` |
| 切来源时左列保留 | `kept = true`（释义区不重建） |
| 音频代理 | 200 `audio/mpeg` |
| 生造词 | 提示「查询失败：没有查到这个词」，且下一次正常查询可恢复 |
| 移动端 390×844 | 无横向溢出（`scrollWidth 366 == clientWidth 366`），单列 `346px`，iframe 底部 774 ≤ 844 |
| 解析器回归 | `node scripts/vocab-parse-test.mjs` → `parser regression OK`（覆盖 engage / ephemeral / ubiquitous / serendipity / run） |
| 服务日志 | `[billboard] 已加载模块: todos, thoughts, words, vocab, sentences, …` |

### 回滚方法

纯静态页 + 一个小后端，无数据库、无迁移，回滚很干净：

```bash
cd /opt/billboard
rm -f src/vocab-api.js modules/vocab.js public/js/modules/vocab.js scripts/vocab-parse-test.mjs
rm -rf public/vocab
cp server.js.bak-vocab-20261010-065500 server.js   # 或手工删掉那两行 vocab 挂载
systemctl restart billboard
```

备份：`server.js.bak-vocab-20261010-065500`（挂载前）。前端 `public/js/modules/*.js` 的备份惯例是 `.bak-<tag>-<时间戳>`。

### 后续怎么更新内容

- **加来源**：改 `src/vocab-api.js` 的 `DOMAINS` 数组，`/api/vocab/meta` 会把新项吐给前端，前端 `<select>` 是动态渲染的，不用改 `public/vocab/index.html`。
- **改页面样式 / 布局**：只动 `public/vocab/index.html`（自包含，CSS/JS 内联）。改完浏览器硬刷新即可，`__ASSET_V__` 会自动带上版本号。
  - 提醒：占位符 `__ASSET_V__` **只能**出现在值的位置（`?v=__ASSET_V__`），绝对不能当变量名用 —— 服务端是 `html.replaceAll()`，当变量名写会把代码替换坏。
- **解析器改了必须跑测试**：`cd /opt/billboard && node scripts/vocab-parse-test.mjs`（要在 `/opt/billboard` 下跑，`node_modules` 在那儿；在 `/tmp` 跑会 `ERR_MODULE_NOT_FOUND: express`）。
- **上游改版**：Vocabulary.com 是第三方站点，改版会让解析失败，表现为所有词都查不到或音标为空。先跑上面的测试脚本定位是哪个字段坏了，再看 `src/vocab-api.js` 里 `parseEntry()` 对应的正则。

### 已知不修

无。义项的同义词、例句都来自上游，本站不落库，上游质量即本站质量。
