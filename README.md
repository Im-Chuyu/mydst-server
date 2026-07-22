# MyDST Server

MyDST Server 是面向单机饥荒联机版专用服务器的管理后台。项目由 Node.js 后端和 React 管理界面组成，适配 Ubuntu 24.04、Master/Caves 双分片和 `Cluster_1` 存档结构。

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

## Ubuntu 24.04 安装

将项目上传至服务器后执行一键安装：

```bash
chmod +x install.sh
sudo ./install.sh
```

安装器支持 Ubuntu 22.04 和 Ubuntu 24.04，会自动安装 Node.js 22、SteamCMD、DST Dedicated Server、systemd 服务和面板依赖，最后输出后台地址和一次性初始化验证码。

每台实例可在安装时由部署管理员指定端口；安装完成后，普通用户不能在房间设置中修改端口，管理员可在“系统设置 → 管理员端口”中修改：

```bash
MYDST_PANEL_PORT=9000 \
MYDST_MASTER_PORT=9001 \
MYDST_CAVES_PORT=9002 \
MYDST_STEAM_MASTER_PORT=9003 \
MYDST_STEAM_CAVES_PORT=9004 \
sudo -E ./install.sh
```

DST 需要开放以下 UDP 端口：

| 端口 | 用途 |
|---|---|
| 8489 | 地面世界 |
| 8114 | 洞穴世界，同时承载 TCP 后台 |
| 12346 | 地面 Steam 通信 |
| 12347 | 洞穴 Steam 通信 |

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
