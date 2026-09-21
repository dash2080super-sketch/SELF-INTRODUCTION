# Billboard — 个人私密看板

一个跑在单台低配 VPS 上的小网站：密码登录后，分几个区记东西。

| 模块 | 干什么 |
|---|---|
| ✓ To-Do | 要办的事，带优先级 / 截止日 / 完成勾选 |
| 💡 随想 | 一闪而过的念头、小事、半成品想法 |
| A Word List | 不会的词，记到掌握为止 |
| ❝ Sentences | 难啃的句子 + 值得偷走的句子 |
| ¥ Finance | **占位**，结构待定，先有草稿区 |

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
git remote add origin https://github.com/<你的用户名>/billboard.git
git push -u origin main
```

GitHub 网页上先建一个 **Private 空仓库**（不要勾 README/LICENSE）。
push 时要登录：用户名填 GitHub 用户名，**密码处填 Personal Access Token**（GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → 只给这一个仓库 Contents: 读写）。开了 2FA 必须用 token，不能填登录密码。

**路 B：本机 scp 直传**（能开终端的话最快）

```powershell
Compress-Archive -Path .\billboard\* -DestinationPath billboard.zip
scp billboard.zip root@<IP>:/tmp/
```

然后在 Console 里：

```bash
apt-get install -y -qq unzip && mkdir -p /opt/billboard && unzip -o /tmp/billboard.zip -d /opt/billboard
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
git clone https://github.com/<你的用户名>/billboard.git /opt/billboard
```

嫌 PAT 麻烦就把仓库临时改成 Public，装完再改回 Private。

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

## 四、没有域名怎么办

三种选择，按推荐度排：

1. **用 IP + 端口直接访问**：把 `.env` 里 `HOST=0.0.0.0`，放行防火墙端口，浏览器开 `http://<IP>:3000`。
   注意这是明文 HTTP，公共 WiFi 下密码会被看到——至少用 ufw 只放行你自己的出口 IP：
   ```bash
   sudo ufw allow from <你的公网IP> to any port 3000
   sudo ufw enable
   ```
2. **SSH 隧道**（最省事也最安全，不用开端口）：本机执行 `ssh -L 3000:127.0.0.1:3000 root@<IP>`，然后浏览器开 `http://127.0.0.1:3000`。
3. 买个便宜域名（Cloudflare 上 .xyz 一年不到 10 块），走第二节的 Caddy 方案。

> `HOST=0.0.0.0` 且开了 HTTPS 反代时，保持 `NODE_ENV=production`，cookie 的 secure 标记会自动打开。

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
- 前端是原生 JS，没有构建步骤，改完刷新页面即生效（浏览器强缓存时 Ctrl+F5）。
