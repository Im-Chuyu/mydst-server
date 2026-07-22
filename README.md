# MyDST Server

MyDST Server 是面向单机饥荒联机版专用服务器的管理后台。项目由 Node.js 后端和 React 管理界面组成，适配 Ubuntu 22.04/24.04、Master/Caves 双分片和 `Cluster_1` 存档结构。

## 功能

- 地面、洞穴独立启停、重启和状态监控
- CPU、内存、磁盘与系统运行时间监控
- 房间语言、访问规则、Token、Steam 群组和网络端口配置
- 带原版图标的地面/洞穴世界可视化配置，并保留高级 Lua 模式
- Steam Workshop 名称/ID 搜索与 MOD 管理
- 游戏日志、DST 控制台和在线玩家操作
- 管理员、封禁和白名单管理
- tar.gz/ZIP 安全校验、上传、下载、恢复和保留策略
- SteamCMD 更新、定时备份和定时更新
- 密码哈希、HttpOnly 会话、CSRF 防护、登录限流和操作审计

## 生产目录

```text
/opt/mydst/
├── panel/       # 管理后台
├── game/        # DST Dedicated Server
├── steamcmd/    # SteamCMD
├── data/        # Klei 持久化数据
└── backups/     # tar.gz / ZIP 存档备份
```

游戏进程由 `tmux` 托管，管理后台以无特权 `dst` 用户运行。后台不会执行由 HTTP 参数拼接出的 Shell 命令。

## Ubuntu 22.04/24.04 一键安装

安装器适用于干净的 Ubuntu 22.04 或 Ubuntu 24.04 服务器。执行前请确认：

- 使用 `root` 或拥有 `sudo` 权限的账号登录；
- 服务器可以访问 Ubuntu 软件源、NodeSource、Steam 和 GitHub；
- 在服务器商控制台为本机规划并放行面板 TCP 端口和 Master/Caves UDP 端口；
- 每台服务器使用自己的一组端口，不要和同一台机器上的其他实例重复。

### 1. 获取项目

推荐直接从 GitHub 克隆：

```bash
cd /opt
git clone git@github.com:Im-Chuyu/mydst-server.git mydst-server
cd /opt/mydst-server
```

如果服务器没有配置 GitHub SSH Key，也可以使用 HTTPS：

```bash
cd /opt
git clone https://github.com/Im-Chuyu/mydst-server.git mydst-server
cd /opt/mydst-server
```

也可以先在本地上传项目目录，再进入该目录执行后续命令。

### 2. 执行一键安装

安装器不会为 Master/Caves 写入默认游戏端口。执行下面命令后，首次进入后台时这两个端口和 Cluster Token 都是空的：

```bash
cd /opt/mydst-server
chmod +x install.sh
sudo ./install.sh
```

安装器会自动完成以下工作：安装系统依赖和 SteamCMD 所需的兼容库、安装 Node.js 22、创建无特权 `dst` 用户、安装或更新 DST Dedicated Server、构建管理后台、创建 systemd 服务，并在 UFW 已启用时添加面板和 Steam 通信规则。启动游戏时会优先使用 DST 的 64 位 `bin64` 程序；只有服务器端没有 64 位程序时才回退到 `bin` 入口。

面板 TCP 端口可以在安装时指定，例如：

```bash
cd /opt/mydst-server
MYDST_PANEL_PORT=9000 sudo -E ./install.sh
```

`sudo -E` 用来保留面板端口环境变量。安装完成后登录后台，在“系统设置 → 管理员端口”中填写服务器商为本机开放的 Master 和 Caves UDP 端口；Steam 端口保留系统默认值即可。普通用户不能修改 Master/Caves 端口，管理员可以修改。端口配置保存在 `/opt/mydst/panel-ports.json`，恢复存档不会覆盖它。

### 3. 首次访问和初始化

安装器结束时会输出：

- 管理后台地址，例如 `http://服务器公网 IP:8114`；
- 一次性初始化验证码（如果启用了安装验证码）；
- systemd 服务状态。

在浏览器打开后台地址，首次进入时创建管理员账号和密码。管理员账号、密码和验证码不会写入 GitHub 仓库；验证码只应保留在安装服务器的终端输出中。初始化完成后，管理员可以在系统设置中修改密码，普通用户可以从登录页注册账号。

### 4. 配置服务器商端口

安装器只能配置 Ubuntu 和 DST 本机端口，不能替你修改服务器商控制台的 NAT/端口映射。请在服务器商控制台建立对应规则：

| 名称 | 协议 | 端口用途 |
|---|---|---|
| panel | TCP | 管理后台 |
| master | UDP | 地面世界 |
| caves | UDP | 洞穴世界 |
| steam-master | UDP | 地面 Steam 通信 |
| steam-caves | UDP | 洞穴 Steam 通信 |

Master 和 Caves 的实际端口没有默认值，必须以服务器商控制台为本机开放的端口为准。Steam 通信端口使用面板中的默认值，只有在你的网络方案要求时才需要调整。

## 安装后检查

```bash
systemctl status mydst-panel --no-pager
curl "http://127.0.0.1:$(awk -F= '/^PORT=/{print $2}' /etc/mydst-panel.env)/api/health"
sudo -u dst env TMUX_TMPDIR=/opt/mydst/tmux tmux list-sessions
```

首次安装后没有自动创建游戏世界，登录后台配置 Master/Caves 端口、Cluster Token、房间和世界设置后，再从主页启动分片。

## 服务器重启后恢复运行

如果只是重启服务器、重置物理机或恢复系统，而 `/opt/mydst/` 数据目录仍然保留，则不需要重新克隆项目，也不需要重新安装 SteamCMD 或 DST。登录服务器后启动已有面板服务：

```bash
systemctl daemon-reload
systemctl enable --now mydst-panel
systemctl status mydst-panel --no-pager
```

面板恢复后，使用浏览器打开原来的后台地址并登录，在主页点击“全部启动”即可启动 Master/Caves。游戏分片默认不会因为服务器重启自动创建新世界，原有存档、MOD、房间配置和面板账号会继续使用。

检查游戏分片是否正在运行：

```bash
sudo -u dst env TMUX_TMPDIR=/opt/mydst/tmux tmux list-sessions
```

查看面板启动日志：

```bash
journalctl -u mydst-panel -n 100 -f
```

只有在 `/opt/mydst/` 数据目录确实不存在，或系统已经重新安装并清空了原有磁盘时，才需要重新执行“一键安装”。

## 常用命令

```bash
systemctl status mydst-panel
journalctl -u mydst-panel -f
systemctl restart mydst-panel
sudo -u dst env TMUX_TMPDIR=/opt/mydst/tmux tmux list-sessions
```

更新后台源码：

```bash
sudo ./deployment/update.sh
```

`update.sh` 只更新面板程序并重建前端/后端，不会删除 `/opt/mydst/data`、备份和面板状态。更新前建议先在后台生成一次备份。

## 本地开发

Windows 下自动进入演示模式，不会调用 SteamCMD 或 tmux。

```bash
npm install
npm run dev
```

生产构建和冒烟测试：

```bash
npm run build
npm test
```
