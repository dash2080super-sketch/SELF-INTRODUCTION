# scripts/archive — 一次性脚本坟场

这里放的是**当时为了解决某个具体问题而写、用完就不再跑**的脚本。
它们被保留下来只是"留个证据/留个思路"，**不是日常工具**，别指望它们还能正常跑
（很多写死了当时的路径、当时的密码默认值、当时的接口格式）。

## 分类

- `probe*.mjs` / `probe-a-share*.py` — **数据源探测**。当年为了找 DAX/TOPIX 期货、
  A 股与港股指数、NAAIM 敞口等数据源，挨个试接口的记录。结论已经写进
  `../OPS-NOTES.md` 和正式代码里，脚本本身只是过程。
- `patch-*.mjs` — **行号补丁脚本**。那时宿主工具把带 emoji / 在 `scripts/` 下的文件
  误判成二进制，Edit 工具用不了，只能"断言锚点行 → 从后往前替换 → 回读校验"这么改。
  补丁已经生效并在 git 历史里，脚本留着只是说明当时改了什么。
- `diag-data.mjs` — 为评估 to-do 数据丢失范围写的诊断脚本（后来 Vic 说不用恢复了，
  就此废弃）。
- `fin-direct.mjs` / `fin-test.sh` — 早期直接打 `/api/finance` 的调试脚本。
  `fin-test.sh` 里原来写死了一个开发期默认密码，已改成必须传参。
- `_boot.mjs` / `_t50.mjs` — 本机起服务、测 `dividend50` 引擎的临时草稿。

## 还在用的脚本在上一级

`scripts/` 根下只留**能复跑**的：`syntax-check`（编码+语法双检）、`smoke-test`（冒烟）、
`smoke-dividend-ui`（迷你 DOM 跑前端）、`check-live`、`check-dividend`、`test-dividend`、
`verify-*`（回归对账）、`db-counts` / `db-peek`（只读对账）、`probe-candidates`、
`backup-db`、`mint-cookie`、`deploy*.sh`、`setup-*.sh`、`billboard.service`、`cat.mjs`。

## 规矩

新脚本要么一开始就写进 `scripts/` 并配好用法注释，要么用完立刻挪进来。**别再往
`scripts/` 根下堆 `probe2`、`probe3` 这种名字了。**
