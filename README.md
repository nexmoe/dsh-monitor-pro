# dsh-monitor-pro

[![CI](https://github.com/nexmoe/dsh-monitor-pro/actions/workflows/ci.yml/badge.svg)](https://github.com/nexmoe/dsh-monitor-pro/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/nexmoe/dsh-monitor-pro)](https://github.com/nexmoe/dsh-monitor-pro/releases/latest)
[![License](https://img.shields.io/github/license/nexmoe/dsh-monitor-pro)](LICENSE)

**DeepSeek Harness 的实时主机资源监控插件**，由 [VS Code Monitor Pro](https://github.com/nexmoe/vscode-monitor-pro) 改造而来。通过侧栏中的 **Monitor Pro** 查看 CPU、内存、网络、磁盘、电池、温度、GPU 和功耗，并让 Agent 读取同一份监控快照。

[English](README.en.md) · [下载发布包](https://github.com/nexmoe/dsh-monitor-pro/releases/latest) · [与 VS Code 版对比](docs/COMPARISON.md) · [更新记录](CHANGELOG.md)

包名：`@nexmoe/dsh-monitor-pro` · 当前版本：`0.1.2` · 许可证：Apache-2.0。

监控对象是 **运行 Harness Host 的机器**。远程访问 Harness 时，浏览器所在电脑和被监控电脑可能不同。

## 功能

- 原生 React 主面板和侧栏入口，跟随 Harness 主题，适配窄屏。
- 10 类卡片：CPU、内存、网络、磁盘 I/O、磁盘容量、电池、CPU 频率、温度、GPU、功耗。
- CPU 每核使用率；内存已用/活跃/可用及 Swap；每张 GPU 的使用率曲线、温度和显存读数。
- 有界历史折线，缺失值断线；电池负功率保留符号并显示零功率参考线。
- 卡片排序与隐藏，容量单位、网络字节/比特单位、小数位数设置。
- 暂停/恢复显示、采样状态与错误提示、最近采样时间、JSON 导出（当前快照、显示历史和采集配置）。
- 所有窗口共享 Host Worker 和采集缓存；可选 `monitor_snapshot` Agent 工具。
- 简体中文、英语、繁体中文、日语。

基础指标已迁移；原版状态栏、图表视图切换、每核温度、GPU 温度/显存独立历史曲线、原生后端安装和进程管理尚未迁移。完整差异见[对比表](docs/COMPARISON.md)。

## 安装

要求 **Node.js 22+**。已核对并测试 **DeepSeek Harness 0.2.0-rc.2** 的 Cordis、Client ModuleLoader、`main` / `sidebar.panellist` 插槽及 Locale 接口。其他版本需要确认这些接口兼容。

1. 从 [GitHub Releases](https://github.com/nexmoe/dsh-monitor-pro/releases/latest) 下载 `nexmoe-dsh-monitor-pro-0.1.2.tgz`。
2. 在 Harness 中打开「插件 → 安装插件」，填写下载文件的**绝对路径**。
3. 安装完成后打开侧栏 **Monitor Pro**，首次采样可能需要几秒钟。
4. 替换已安装版本后，**完全退出并重新启动 Harness**，让 Host 和 Client 载入新版本。

例如 macOS 下载到默认目录时，可以填写：

```text
/Users/你的用户名/Downloads/nexmoe-dsh-monitor-pro-0.1.2.tgz
```

远程部署时，安装路径必须存在于 Harness Host 上。安装源遇到镜像连接问题时可选择 npm 官方源。本项目通过 GitHub Release 分发，尚未发布到 npm；直接填写包名不会取得这个版本。

如果会话提供 `plugin_manager` 工具，可使用 `install_bundle`，将 `target` 设为 Host 上发布包的绝对路径。卸载请在插件管理器中移除组合包；Worker、定时器、RPC、工具和 Client 注册随插件销毁。

## 采集配置

在「插件 → Monitor Pro → 配置」中编辑保存。配置重载会创建新的共享采集服务并重置历史。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `intervalMs` | `2000` | 采样间隔，整数 `1000–60000` 毫秒 |
| `historySize` | `60` | 历史容量，整数 `10–600` 个采样 |
| `metrics` | 全部指标 | 指标 ID 列表，空数组关闭指标采集 |
| `source` | `systeminformation` | `systeminformation`、`mactop` 或 `go` |
| `backendUrl` | `http://127.0.0.1:8888` | 已运行的本地后端 HTTP origin，仅允许 `127.0.0.1`、`localhost`、`[::1]` |
| `networkInterface` | `""` | SI 网卡名，空值汇总活动的非回环接口 |
| `diskMounts` | `[]` | 磁盘挂载点列表，空值自动去重 |

指标 ID：

```text
cpu memory network diskIO diskSpace battery cpuSpeed cpuTemp gpu power
```

仅采集 CPU、内存和指定网卡的示例：

```yaml
intervalMs: 2000
historySize: 120
source: systeminformation
metrics: [cpu, memory, network]
networkInterface: en0
diskMounts: []
```

采集配置属于 Host，影响所有窗口；显示偏好保存在当前浏览器。**隐藏卡片不会关闭对应指标的采集，暂停显示也不会暂停 Host 采集**。关闭面板后 Host 继续运行；禁用插件才停止采集。

## 数据源与硬件支持

| 能力 | systeminformation（默认） | mactop | 原项目 Go 服务 |
| --- | --- | --- | --- |
| CPU / 内存 | 支持，每核 CPU 可用 | 支持，每核 CPU 可用；活跃内存按已用显示 | 支持，无每核 CPU |
| 网络 / 磁盘 I/O | 活动网卡汇总 / SI 汇总 | 后端提供的速率 | 首个符合条件的网卡 / 磁盘 |
| 磁盘容量 / 电池 | SI | SI 补充 | Go |
| CPU 频率 | 设备支持时可用 | 不提供 | 后端支持时可用 |
| 温度 | SI 提供的 CPU 温度 | SoC 温度，卡片注明 SoC | 后端传感器 |
| GPU | NVIDIA `nvidia-smi` | Apple Silicon GPU 占用/温度，无显存 | 不提供 |
| 功耗 | 不提供 | SoC 总功耗 | 有符号电池净功率 |

默认 `systeminformation` 无须启动额外服务。它不会提供 Apple Silicon GPU 或 SoC 功耗；CPU 温度取决于设备支持。若关注这些 Mac 指标，需启用 mactop。

选择 `mactop` 前，自行安装并运行 [mactop](https://github.com/metaspartan/mactop) 的 Prometheus 服务，再将实际端口填入 `backendUrl`；插件请求 `/metrics`。选择 `go` 前，自行启动 [VS Code Monitor Pro 的 Go HTTP 后端](https://github.com/nexmoe/vscode-monitor-pro/tree/main/go-backend)；插件请求 `/api/v1/all`。插件不包含、下载或管理原生可执行文件。

选定的原生后端失败时显示错误，保留旧样本及其时间戳，并继续尝试原数据源。SI 某个维度失败时，该维度为空并显示部分失败状态；设备不支持的指标显示 `—`。Go 第一轮吞吐量或计数器重置后的速率为空，等待下一次有效差值。

SI 汇总网卡时，VPN、隧道、网桥可能重复计量，可设置 `networkInterface` 指定出口。磁盘容量按设备/APFS 容器选择代表挂载点；显式选择 `diskMounts` 后再去重。AMD/Intel GPU 使用率暂不支持；Apple Silicon 共享内存不当作独立显存。SoC/电池功率也不等于整机墙插功率。

## Agent 工具

Harness 提供 tools 服务时，插件注册无参数的 `monitor_snapshot` 工具，返回主机快照、数据源、采样时间、状态和错误。工具读取缓存，不触发额外采集，也不返回历史数组。没有 tools 服务时，监控面板仍可使用。

## 从源码构建

在仓库根目录执行：

```sh
git clone https://github.com/nexmoe/dsh-monitor-pro.git
cd dsh-monitor-pro
corepack enable
pnpm install --frozen-lockfile --registry=https://registry.npmjs.org
pnpm check
pnpm smoke
pnpm pack --pack-destination artifacts
```

包管理器固定为 pnpm 11.7.0。若没有 Corepack，可自行安装该版本 pnpm。源码独立构建，复用算法保存在 [src/upstream](src/upstream)，不需要父目录的 VS Code 仓库。发布包包含编译产物；安装它不需要 TypeScript 工具链，也没有安装时构建脚本。

安装源码目录前先执行 `pnpm build`，再把此仓库的绝对路径填入插件安装框。

## 架构与验证

```text
SI / 本地 HTTP 后端
        ↓
Host Worker（串行采集，15 秒截止）
        ↓
MonitorService（共享缓存 / 有界历史 / generation）
        ├── /api/monitor-pro/snapshot → React 面板
        └── monitor_snapshot → Agent
```

每个插件实例只有一个 Worker，所有窗口读取缓存。超时后终止 Worker，下轮重新创建。RPC 通过采集实例的 `generation` 返回全量或增量历史，防止配置重载后混合不同来源的曲线。

`pnpm check` 执行构建、严格 TypeScript 检查和自动测试，覆盖配置校验、共享采集、历史容量、失败/卸载、Worker 超时、NVIDIA 解析、mactop 单位、Go 计数器重置、语言键、负功率图，以及 jsdom + React 面板挂载、增量更新、语言切换、暂停和清理。`pnpm smoke` 使用真实 SI Worker 采集两轮。

已安装的 Harness 运行时还可运行真实 Cordis / HTTP / 认证集成测试；没有 `DSH_RUNTIME_ROOT` 时，这一项默认跳过。macOS 示例：

```sh
DSH_RUNTIME_ROOT='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules' \
ELECTRON_RUN_AS_NODE=1 '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  --expose-internals --test test/runtime-http.test.mjs
```

该集成测试使用临时内存凭据和独立临时端口，验证签名 Cookie、真实采样、请求校验和卸载路由。完整浏览器交互、Windows/Linux SI、实际 mactop/Go 服务及 NVIDIA 硬件仍需对应环境验证。

`0.1.0` 的 `transport failure for /monitor-pro/snapshot: HTTP 405` 已于 `0.1.1` 修复；当前版本保留修复。遇到此错误请升级并完整重启 Harness。

## 发布

[CI](.github/workflows/ci.yml) 验证 Node.js 22/24 下的构建、类型检查和测试。推送与包版本一致的 `v*` 标签后，[发布工作流](.github/workflows/release.yml) 再次验证，生成 `.tgz` 和 `SHA256SUMS` 并上传到 GitHub Release。不会自动发布到 npm。

## 许可证与来源

[Apache-2.0](LICENSE)。衍生自 [nexmoe/vscode-monitor-pro](https://github.com/nexmoe/vscode-monitor-pro)，上游快照为 `36b8f7487d2b6d3b9d6b210e372c18cb824eb25d`。原始算法及类型保留来源标记，修改记录见 [NOTICE](NOTICE)。`systeminformation` 和 Harness 依赖保留各自许可证。
