# Billboard — 个人私密看板

一个跑在单台低配 VPS 上的小网站：密码登录后，分几个区记东西。

| 模块 | 干什么 |
|---|---|
| ✓ To-Do | 要办的事，带优先级 / 截止日 / 完成勾选 |
| 💡 随想 | 一闪而过的念头、小事、半成品想法 |
| A Word List | 不会的词，记到掌握为止 |
| ❝ Sentences | 难啃的句子 + 值得偷走的句子 |
| ¥ Finance | 全球行情看板：情绪 / 波动率 / 股指 / 利率 / 汇率商品 |
| 📉 回撤连跌 | 七大股指近三个月的每日收盘、回撤、连涨连跌天数 |

技术栈：Node + Express + SQLite（单文件数据库），没有前端构建步骤，没有 Docker。
常驻内存约 40–70 MB，1 vCPU / 512MB 的 DigitalOcean 小机完全带得动。

---

## 一、本地先跑起来

```bash
cd billboard
npm install
npm run set-password          # 交互式设置密码（输入不回显）
npm start                     # 打开 http://127.0.0.1:3000
```

`set-password` 会生成 `.env`，里面有 `PASSWORD_HASH`（bcrypt）和 `SESSION_SECRET`（随机）。**`.env` 不要提交、不要外传。**

---

## 二、部署到 VPS（DigitalOcean Web Console，全程浏览器操作）

DO 面板里的 **Droplet Console** 就是一台真实 root shell，装这个完全够用，不需要开本机终端（除非你选路 B）。

三个提醒：
- **粘贴**用 `Ctrl+Shift+V`（或右键 → Paste），Mac 用 `Cmd+V`；普通 `Ctrl+V` 在终端里不管用。
- **一次粘一段**，别一次糊几百行进去；每段跑完看一眼结果再往下走。
- 卡住了 `Ctrl+C` 中断。屏幕滚不动时用 `命令 | tail -20` 只看尾部。

### 第 0 步：让服务器能拿到代码

Web Console 不能上传文件，所以代码得先有个"下载地址"。两条路，选一条。

**路 A：推到 GitHub 私有仓库（推荐，以后更新也靠它）**

本机 PowerShell 里执行（仓库我已经帮你初始化并 commit 好了，你只要建远端）：

```powershell
cd C:\Users\Administrator\WorkBuddy\2026-09-21-09-09-09\billboard
git remote add origin https://github.com/dash2080super-sketch/billboard.git   # ← 换成你自己的仓库地址
git push -u origin main
```

> **README 里的 `<...>` 都是占位符，必须替换成真实值再执行**——直接粘带尖括号的命令，
> 会把 `https://github.com/<你的用户名>/billboard.git` 这个假地址存进 remote，之后
> 再 add 就会报 `error: remote origin already exists`。

GitHub 网页上先建一个 **Private 空仓库**（不要勾 README/LICENSE）。
push 时要登录：用户名填 GitHub 用户名，**密码处填 Personal Access Token**（GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → 只给这一个仓库 Contents: 读写）。开了 2FA 必须用 token，不能填登录密码。

**常见报错**：

| 报错 | 原因 | 处理 |
|---|---|---|
| `remote origin already exists` | 之前加过（哪怕是错的地址） | `git remote set-url origin <正确地址>` |
| `schannel: server closed abruptly` / 卡住不动 | 本机到 `github.com:443` 被阻断（代理把 github 走了直连） | 在代理软件里把 `github.com` 改为走代理，或开全局模式；也可改用 SSH over 443：`git remote set-url origin ssh://git@ssh.github.com:443/dash2080super-sketch/billboard.git`（需先在 GitHub 加 SSH 公钥） |
| `failed to push some refs` / `non-fast-forward` | 远端仓库不是空的 | `git push -u origin main --force`（确认远端内容不要了再用） |
| 干脆上不去 GitHub | — | 换 Gitee 建私有仓库，把上面地址换成 gitee 的即可，服务器端照样 `git clone` |

**路 B：本机 scp 直传**（能开终端的话最快，本机到 GitHub 不通时也是首选）

用 `tar` 而不是 `zip`——Windows 的 `Compress-Archive` 生成的反斜杠路径会让 Linux 的 `unzip` 报警告。

```powershell
cd C:\Users\Administrator\WorkBuddy\2026-09-21-09-09-09
tar -czf billboard.tar.gz -C .\billboard --exclude=node_modules --exclude=.git --exclude=data --exclude=.env .
scp billboard.tar.gz root@<IP>:/tmp/
```

然后在 Console 里：

```bash
mkdir -p /opt/billboard && tar -xzf /tmp/billboard.tar.gz -C /opt/billboard
```

### 第 1 步：打开控制台

DO 面板 → Droplets → 点你的机器 → 右上角 **Console**。等出现 `root@xxx:~#` 就可以敲命令了。

### 第 2 步：装 Node 22（粘这一段）

```bash
apt-get update -qq && apt-get install -y -qq ca-certificates curl gnupg && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y -qq nodejs && node -v
```

看到 `v22.x` 就成了。装的过程会刷很多行，最后一行是版本号就行。

> 内存 ≤ 1GB 的建议顺手加 1G swap：
> ```bash
> fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
> ```

### 第 3 步：拿代码

路 A（私有仓库会问用户名/密码，密码填 PAT）：

```bash
git clone https://github.com/dash2080super-sketch/billboard.git /opt/billboard
```

（地址换成你自己的；嫌 PAT 麻烦就把仓库临时改成 Public，装完再改回 Private。）

服务器在新加坡，访问 GitHub 通常比你在国内快，所以「本机推不上去」不代表「服务器拉不下来」。

### 第 4 步：一键安装

```bash
bash /opt/billboard/scripts/setup-server.sh
```

它会自动建运行用户、装依赖、配 systemd 开机自启。看到「安装完成」就 OK。

### 第 5 步：设登录密码

```bash
cd /opt/billboard && sudo -u billboard npm run set-password
```

输入时不显示星号也不显示字符，这是正常的，输两遍回车即可。

> 万一 console 里交互输入不顺，用非交互版（密码会留在 history，跑完执行 `history -c`）：
> `cd /opt/billboard && sudo -u billboard node scripts/set-password.js '你的密码'`

### 第 6 步：开端口，打开网站

DO 面板 → Networking → Cloud Firewalls → 找到绑给这台机器的防火墙 → Inbound Rules 加一条：
**TCP 3000**，来源选「Your IP」或填你自己的公网 IP。

浏览器开 `http://<IP>:3000`，输密码进去。

### 第 7 步（可选）：上 HTTPS

有域名：先把它 A 记录解析到这台 IP，然后

```bash
bash /opt/billboard/scripts/setup-caddy.sh board.example.com
```

防火墙再加 TCP 80 和 443（来源 All IPv4）。之后访问 `https://board.example.com`，证书自动续期。

没域名：看第三节的 SSH 隧道方案，最安全。

---

## 三、完整手动部署（想自己掌控每一步时看这里）

下面假设你用 root 登录，域名是 `board.example.com`（**没域名看第四节**）。

### 1) 装 Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v    # 应为 v22.x
```

### 2) 内存 ≤ 1GB 的话，加 1G swap（编译和突发峰值用）

```bash
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 3) 建专用用户，放代码

```bash
sudo useradd -r -m -d /opt/billboard -s /bin/bash billboard
```

把本机整个 `billboard/` 目录传上去（Windows 上先打包成 zip）：

```powershell
# 本机 PowerShell
Compress-Archive -Path .\billboard\* -DestinationPath billboard.zip
scp billboard.zip root@<你的IP>:/tmp/
```

```bash
# 服务器上
sudo apt install -y unzip
sudo unzip -o /tmp/billboard.zip -d /opt/billboard
sudo rm -f /opt/billboard/data/*.db          # 别把本地测试数据带过去
sudo chown -R billboard:billboard /opt/billboard
```

### 4) 装依赖 + 设密码（**必须在服务器上设**，别把本机的 .env 传上去）

```bash
cd /opt/billboard
sudo -u billboard npm ci --omit=dev --no-audit --no-fund
sudo -u billboard npm run set-password
```

### 5) 配 systemd 开机自启

```bash
sudo cp /opt/billboard/scripts/billboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now billboard
sudo systemctl status billboard          # 应显示 active
curl 127.0.0.1:3000/api/health           # 应返回 {"ok":true,...}
```

### 6) Caddy 反代 + 自动 HTTPS（有域名时推荐）

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile` 只写这几行：

```
board.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

域名要先解析到这台机器的 IP。Caddy 会自己申请并续期证书，之后访问 `https://board.example.com` 即可。

---

## 四、外部怎么访问（443 常被占用时的三种走法）

默认安装完的状态是：服务只监听 `127.0.0.1:3000`，ufw 只放行 22 和 443，
所以**外部暂时访问不了**，需要你挑一种打通方式。

> 本机（Vic 这台）服务器上 443 已经被 xray 占着，所以下面的方案都不动 443。

### 方案 1：SSH 隧道（推荐，零改动、全程加密）

本机 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\tunnel.ps1
```

保持窗口开着，浏览器访问 `http://127.0.0.1:3000`。

- 优点：服务器不开放任何新端口，流量全程加密，改密码改代码都不影响
- 缺点：每次用之前要先开隧道（手机端可用 Termius / JuiceSSH 的端口转发，配置同上）
- 换服务器：先 `$env:BB_SERVER='root@别的IP'` 再跑脚本

### 方案 2：IP + 端口直连（手机随手记最省事）

服务器上执行：

```bash
sed -i 's/^HOST=.*/HOST=0.0.0.0/' /opt/billboard/.env
systemctl restart billboard
ufw allow from <你自己的公网IP> to any port 3000 proto tcp
```

然后 `http://<服务器IP>:3000`。**这是明文 HTTP**，所以来源一定要限定成你自己的 IP
（别用 `Anywhere`）。家里宽带 IP 会变的话，用方案 1 或 3 更稳。

### 方案 3：有域名 → 把 HTTPS 挪到高位端口

443 被 xray 占着，Caddy 就换个端口听，证书照样能自动签（用 80 端口做验证）：

```bash
bash /opt/billboard/scripts/setup-caddy.sh board.example.com 8443
ufw allow 80/tcp && ufw allow 8443/tcp
```

访问 `https://board.example.com:8443`。

更讲究一点：域名交给 Cloudflare 托管（免费），CF 的 443 → 源站 8443，
这样访问就是干净的 `https://board.example.com`，手机上体验最好。

> 反代场景下 `.env` 里保持 `HOST=127.0.0.1`（Caddy 在同一台机器上转发），
> `NODE_ENV=production` 会让 cookie 的 secure 标记自动打开。

---

## 五、备份

数据就在 `data/billboard.db` 一个文件里（外加 `-wal`/`-shm`）。每天复制一次就够了：

```bash
sudo crontab -e
# 每天凌晨 4 点备份，保留 14 天
0 4 * * * mkdir -p /opt/backup && cp /opt/billboard/data/billboard.db /opt/backup/billboard-$(date +\%F).db && find /opt/backup -name 'billboard-*.db' -mtime +14 -delete
```

---

## 六、加一个新模块（想出来再加，就是这么加）

假设你想加一个「Reading List」，只需两步：

**1）后端 `modules/reading.js`** —— 声明表结构和字段：

```js
export default {
  id: 'reading',
  name: 'Reading',
  icon: '📚',
  desc: '想读的书和文章',
  order: 60,
  quickAdd: true,
  table: 'reading',
  orderBy: 'created_at DESC',
  ddl: `CREATE TABLE IF NOT EXISTS reading (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          url TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '想读',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );`,
  fields: [
    { key: 'title', label: '标题', type: 'text', required: true, search: true },
    { key: 'url', label: '链接', type: 'text' },
    { key: 'status', label: '状态', type: 'select', options: ['想读', '在读', '读完'], default: '想读' },
  ],
};
```

增删改查 / 搜索 / 导出接口会自动生成，不用写。

**2）前端 `public/js/modules/reading.js`** —— 只决定长什么样：

```js
const { esc, fmtTime } = window.Billboard;
window.Billboard.register('reading', {
  renderItem(item) {
    return `<div class="item-title">${esc(item.title)}</div>
            <div class="item-meta"><span class="chip">${esc(item.status)}</span>
            <span class="chip">${fmtTime(item.created_at)}</span></div>`;
  },
});
```

不写这个文件也能跑，会用默认样式。然后 `sudo systemctl restart billboard`，新 tab 就出现了。

字段 type 支持：`text` / `textarea` / `date` / `select` / `boolean` / `number`；加 `search: true` 表示这个字段参与搜索。

---

## 七、日常运维

```bash
sudo systemctl restart billboard        # 重启
sudo journalctl -u billboard -f         # 看实时日志
bash scripts/deploy.sh                  # 更新代码后一键重启（git 部署时）
```

## 八、几点说明

- **鉴权**：密码散列存服务端，会话是 HMAC 签名的 httpOnly cookie，默认 30 天有效（`SESSION_DAYS`）。连续输错 8 次会锁 15 分钟。
- **没有注册/多用户**：就你一个人用，密码只有一个。
- **finance 模块现在是壳子**：指标槽位（QQQ/NDX、VXN、10Y 美债、WTI）先摆着，草稿区存在 `kv` 表。等你想清楚要看什么，改 `modules/finance.js` + `public/js/modules/finance.js` 就行，其他模块不受影响。
- **回撤连跌（drawdown）模块**：日线来自 Yahoo Finance（`^GDAXI ^FCHI ^FTSE ^NDX ^GSPC ^N225 1306.T`），后端 30 分钟缓存一份，另存 `data/drawdown-cache.json`（重启后直接读盘，不白打上游）。回撤 / 连涨连跌是前端按所选窗口（10 日 / 1 / 2 / 3 个月）现算的，切窗口不再打上游。TOPIX 因 Yahoo 没有指数代码，用 `1306.T` 东证 ETF 代理，点位不等于指数本身，但涨跌幅、回撤、连涨跌结论一致。
  - 本机（Windows）访问 Yahoo 必须走代理：在 `.env` 里写 `DRAWDOWN_PROXY=http://127.0.0.1:10808`；VPS 上直连即可，不要这一行。代理不通时会自动退回直连。
- 前端是原生 JS，没有构建步骤，改完刷新页面即生效（浏览器强缓存时 Ctrl+F5）。
