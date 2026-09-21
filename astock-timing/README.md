# A股择时看板

沪深300 的指标读数 + 仓位建议页。核心指标是 **ERP（股权风险溢价）= 1/PE(TTM) − 十年期国债收益率**。

- `index.html` — 看板本体，单文件静态页（自带样式、ECharts CDN、ERP 计算器、七档仓位表）。
- `reports/` — 两份专题报告（宽基指数挑选指南、沪深300择时深度报告），看板的数字来源和论证都在里面。

## 在 billboard 里的位置

- 服务端：`modules/timing.js`（virtual 模块，只占一个 tab，不建表）
- 前端：`public/js/modules/timing.js`（用 iframe 嵌入 `/timing/index.html`）
- 路由：`server.js` 里的 `app.use('/timing', express.static(TIMING_DIR, ...))`，挂在 `authGuard` 之后，**必须登录才能看**
- 访问：https://vic-jianhua.me/timing/index.html （billboard 里点「🎯 A股择时」tab 同理）

## 部署到 VPS

```bash
scp astock-timing/index.html root@188.166.250.14:/opt/astock-timing/index.html
ssh root@188.166.250.14 "systemctl restart billboard"
```

`TIMING_DIR` 默认是 `/opt/astock-timing`，可用环境变量覆盖。

**回滚**：删掉 `modules/timing.js` 和 `public/js/modules/timing.js` 并重启 billboard，tab 就消失了；
`/opt/astock-timing/` 目录留着不影响任何东西。

## 怎么更新读数（每季度一次就够）

页面上所有结论都由两个数字推导。改 `index.html` 里这两个 `value`：

```html
<input type="number" id="pe"   value="13.43" ...>   <!-- 沪深300 PE(TTM) -->
<input type="number" id="bond" value="1.68"  ...>   <!-- 十年期国债收益率 % -->
```

其它硬编码的指标（破净率、融资买入占比、市值/GDP、收益率回测表）在 HTML 正文里，
搜索相应数字即可替换。**ERP 变化很慢，一季度更新一次足够**，天天盯没有意义。

## 数据快照

当前页面数据截至 **2026-09-21**（估值取 2026-09-18 收盘）。
具体来源与时点见页面底部「数据来源与时点」一节。

## 为什么用 iframe 而不是直接塞进 panel

看板用了 `.card` / `.metric` / `table` 这类通用类名：

1. `innerHTML` 注入的 `<script>` 不会执行 —— 计算器和图表会全部失效；
2. 这些类名会和 billboard 的 `app.css` 互相覆盖；
3. 往 `<head>` 注入 `<style>` 后，切换 tab 时不会被移除，会污染其他模块。

iframe 是唯一能同时保证「脚本能跑 + 样式完全隔离 + 切走不留痕」的做法。
