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

安装过程会显示当前阶段。安装器会从阿里云、腾讯云、清华镜像和 Ubuntu 官方源中选择可访问的软件源，安装期间临时跳过不需要的 backports 和语言索引，完成后恢复服务器原来的 APT 源配置。如果系统依赖已经安装，再次执行安装器会跳过 `apt update`。网络下载使用超时、重试和断点续传；SteamCMD 会在两个官方地址间自动切换，压缩包先下载到 `/opt/mydst/.steamcmd_linux.tar.gz.part`，每次下载后验证完整性，通过后才解压。因此下载中断后不要同时运行第二个安装器，重新执行同一条安装命令即可继续已有文件。

#### 安装中断后更新代码并继续

如果首次安装尚未显示 `MyDST installation completed.`，此时 GitHub 仓库又发布了修复，不能运行 `deployment/update.sh`。先确认旧安装器已经退出，不要同时启动两个安装器：

```bash
ps -ef | grep -E '[i]nstall.sh|[s]teamcmd|[c]url|[t]ar'
```

没有旧安装任务后，拉取最新代码并重新执行首次安装脚本：

```bash
cd /opt/mydst-server
git -c http.version=HTTP/1.1 pull --ff-only
sudo bash deployment/install.sh
```

也可以合并成一行：

```bash
cd /opt/mydst-server && git -c http.version=HTTP/1.1 pull --ff-only && sudo bash deployment/install.sh
```

`git -c http.version=HTTP/1.1` 只对本次拉取生效，可减少部分国内线路上的 GitHub TLS 中断。重新执行 `install.sh` 不会无条件从头下载：已经安装的 Ubuntu 依赖和 Node.js 会跳过，面板使用新源码重新构建，有效的 SteamCMD 断点会继续，DST 已有文件由 SteamCMD 校验后只补齐缺失内容。旧版本留下的无效 SteamCMD 残片会自动清理。

首次安装完成前通常还没有 `/etc/mydst-panel.env`，所以运行 `deployment/update.sh` 会报找不到该文件。只有安装器最终显示 `MyDST installation completed.` 后，才改用文档后面的日常更新命令。

需要指定固定 Ubuntu 镜像时，可以传入完整镜像地址：

```bash
cd /opt/mydst-server
MYDST_APT_MIRROR=https://mirrors.aliyun.com/ubuntu sudo -E ./install.sh
```

面板 TCP 端口可以在安装时指定，例如：

```bash
cd /opt/mydst-server
MYDST_PANEL_PORT=9000 sudo -E ./install.sh
```

`sudo -E` 用来保留面板端口环境变量。安装完成后登录后台，在“系统设置 → 管理员端口”中填写服务器商为本机开放的 Master 和 Caves UDP 端口；Steam 端口保留系统默认值即可。普通用户不能修改 Master/Caves 端口，管理员可以修改。端口配置保存在 `/opt/mydst/panel-ports.json`，恢复存档不会覆盖它。

恢复上传的 tar.gz/ZIP 存档时，面板会读取 Master 和 Caves 中的 `modoverrides.lua`，将 Workshop MOD 和 Lua 配置同步到“MOD 管理”，并优先复用 SteamCMD 缓存或下载缺失 MOD。若某个 MOD 不允许 SteamCMD 匿名预下载，面板会保留 `dedicated_server_mods_setup.lua` 下载配置，由 DST 分片在启动时继续自动下载。

### 3. 首次访问和初始化

当 SteamCMD 显示下面一行时，代表 DST Dedicated Server 已经完整安装：

```text
Success! App '343050' fully installed.
```

随后安装器会创建并启动面板服务，最后输出类似内容：

```text
MyDST installation completed.
One-time setup token: be0604ecc2eb43549697a746
Panel access: configure and use the public TCP endpoint assigned by your server provider.
Service status: systemctl status mydst-panel
```

其中：

- 安装器不会输出管理后台 URL，因为它无法知道服务器商最终分配或映射的面板公网 TCP 端口；
- 实际管理后台地址应以服务器商控制台确定的公网 IP（或域名）和面板外网端口为准；
- `One-time setup token` 后面的字符串就是首次创建管理员时需要填写的安装验证码；
- 安装验证码不是管理员密码，也不是 GitHub Token，只用于防止他人抢先初始化后台。

如果关闭终端后忘记了安装验证码，可以在服务器执行：

```bash
sudo grep '^MYDST_SETUP_TOKEN=' /etc/mydst-panel.env
```

可以使用 `grep '^PORT=' /etc/mydst-panel.env` 查看面板在 Ubuntu 内部监听的 TCP 端口。如果服务器使用 NAT 映射，浏览器应填写服务器商控制台显示的外网端口，而不是直接照抄内部监听端口。

#### 一键配置管理后台端口

Ubuntu 无法自动读取服务器商控制台中的端口转发名称、内网端口和外网端口。首次安装完成后，先在服务器商控制台找到一条允许 TCP 的映射规则，然后把该规则的**内网 TCP 端口**传给脚本。例如规则中的内网端口是 `8432`：

```bash
cd /opt/mydst-server
sudo bash set-panel-port.sh 8432
```

脚本会依次完成端口格式校验、TCP 占用检查、更新 `/etc/mydst-panel.env`、放行启用状态下的 UFW、重启 `mydst-panel`，并请求本机健康检查接口确认面板已经监听新端口。成功时会显示：

```text
Panel internal TCP port updated: 8114 -> 8432
Configure the provider's public TCP endpoint to forward to internal TCP port 8432.
Panel service status: active
```

该命令只修改管理后台的 TCP 监听端口，不会修改后台“系统设置 → 管理员端口”中的 Master/Caves 游戏 UDP 端口。如果服务器商提供 `caves TCP+UDP 8432`，可以让管理后台使用 TCP `8432`、洞穴世界使用 UDP `8432`，两者协议不同，不会冲突。浏览器仍应使用映射规则中的**外网地址和外网端口**访问，外网端口不要求与内网端口相同。

例如服务器商规则为：

| 名称 | 协议 | 内网端口 | 外网地址 | 外网端口 |
|---|---|---:|---|---:|
| caves | TCP+UDP | 8432 | 45.125.47.27 | 8432 |

执行上面的配置命令后，管理后台访问地址才是 `http://45.125.47.27:8432`，同时可在后台把 Caves 游戏端口设置为 `8432`。Master 游戏端口对应的服务器商规则必须包含 UDP，只有 TCP 的规则不能用于 DST 地面世界连接。

首次打开后台时，填写自定义管理员用户名、管理员密码和安装验证码。管理员初始化完成后，退出管理员账号，登录页会显示“注册普通用户账号”入口。管理员账号、密码和验证码不会写入 GitHub 仓库。

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
cd /opt/mydst-server && sudo bash set-panel-port.sh 8432
sudo -u dst env TMUX_TMPDIR=/opt/mydst/tmux tmux list-sessions
```

更新后台源码（仅适用于首次安装已经完整结束，并且 `/etc/mydst-panel.env` 存在的服务器）：

```bash
cd /opt/mydst-server
git pull --ff-only
sudo bash deployment/update.sh
```

也可以合并成一行：

```bash
cd /opt/mydst-server && git pull --ff-only && sudo bash deployment/update.sh
```

其中 `git pull` 负责从 GitHub 获取最新代码，`update.sh` 负责将本地代码同步到 `/opt/mydst/panel` 并重建前端/后端。`update.sh` 本身不会自动访问 GitHub，也不会删除 `/opt/mydst/data`、备份和面板状态。更新前建议先在后台生成一次备份。如果首次安装仍未完成或 `/etc/mydst-panel.env` 不存在，请回到“一键安装”中的“安装中断后更新代码并继续”，拉取代码后重新运行 `deployment/install.sh`。

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
