# 与 VS Code Monitor Pro 的功能对比

基准：VS Code Monitor Pro `0.9.4`（上游 `36b8f74`）与 dsh-monitor-pro `0.1.2`。后者保留 Harness `0.1.1` 的监控行为，`0.1.2` 主要整理独立构建、文档和发布。

核心指标已迁移，界面和后端管理还有差异；Harness 版新增 Agent 快照工具、暂停显示和 JSON 导出。该表依据源码与文档核对，并不表示所有平台和硬件均已实测。

| 对比项 | VS Code Monitor Pro | dsh-monitor-pro | 差异 |
| --- | --- | --- | --- |
| 界面入口 | VS Code 状态栏 + 独立 Webview | Harness 侧栏入口 + React 主面板 | 界面重做，没有状态栏读数 |
| 监控对象 | 扩展运行的机器，包括 Remote SSH、WSL 扩展宿主 | Harness Host 所在机器 | 远程浏览器查看 Host；不自动集成 VS Code SSH/WSL |
| 基础指标 | CPU、内存、网络、磁盘、电池、频率、温度、GPU、功耗 | 同类指标均有实现 | 可用性仍取决于采集源和设备 |
| 卡片组织 | 14 个独立图表指标，另有系统信息 | 10 类卡片，内存、双向吞吐、GPU 等分组展示 | 指标数量与卡片数量不能直接比较 |
| 图表效果 | Canvas 平滑曲线、渐变填充，可切换条形视图 | SVG 折线，自适应坐标轴，缺失数据断线 | 平滑曲线、渐变及条形视图切换未迁移 |
| 每核 CPU | 使用率、温度可切换为每核阵列 | 总使用率曲线 + 可隐藏的每核使用率条 | 没有每核温度视图 |
| CPU 频率 | 平均频率及最小/最大范围 | 平均频率和历史曲线 | 频率范围未展示 |
| GPU | 使用率、温度、显存独立图表，多卡阵列 | 每张 GPU 的使用率曲线、温度及显存数值 | 温度、显存独立历史曲线及阵列模式切换未迁移 |
| 内存 | 活跃、已用内存分别显示 | 同卡展示已用、活跃、可用内存和 Swap | 增加可用内存及 Swap 展示 |
| 网络统计 | 原版面板使用首个接口的速率 | SI 默认汇总活动非回环接口，也可指定网卡 | 多网卡时读数可能不同 |
| 系统信息 | 发行版、运行时间、磁盘容量 | 主机名、平台/架构、运行时间、磁盘容量卡片 | 没有完整发行版信息卡 |
| 默认采集源 | Windows 优先 Go；Apple Silicon 默认启用 mactop；其他用 SI | 所有平台默认 systeminformation，手动选择 mactop / Go | 默认行为不同，未移植原版平台性能优化保证 |
| 原生后端管理 | 管理 Go/mactop 启停，提供 mactop 安装提示 | 连接已启动的本地 HTTP 后端 | 不自动下载、安装、启动或停止服务 |
| Apple Silicon | mactop 提供 Apple GPU、SoC 温度与功耗 | 已适配，但须手动运行 mactop 并配置地址 | 默认 SI 下 Apple GPU、SoC 功耗不可用 |
| 刷新间隔 | 默认 2 秒；0.5–30 秒 | 默认 2 秒；1–60 秒 | 最快刷新较慢 |
| 历史容量 | 默认 60；10–500 点 | 默认 60；10–600 点 | 上限增加 |
| 设置与格式 | VS Code 设置；逐指标有效数字、单位空格、缩写、自定义颜色、运行时间模板等 | Host 采集配置 + 浏览器显示偏好；全局小数位、容量单位、字节/比特 | 部分格式和颜色选项未迁移 |
| 隐藏与采集 | 状态栏和图表开关共同决定采集项 | Host metrics 决定采集，卡片隐藏只影响显示 | 隐藏后仍采集；须在 Host 配置中关闭指标 |
| 暂停与导出 | 无对应面板操作 | 暂停/恢复显示，导出当前快照、历史和配置为 JSON | 新增，暂停时 Host 继续采集 |
| Agent 集成 | 无专门 Agent 工具 | monitor_snapshot 返回缓存快照、来源、时间和错误 | 新增；面板与 Agent 共享数据 |
| 语言与主题 | 中英、繁体中文、日语，跟随 VS Code 主题 | 相同四种语言，跟随 Harness 主题 | 适配新宿主 |

## 当前实现的范围

本次迁移没有补齐原版所有 UI 功能。主要缺口是状态栏、图表模式切换、每核温度、GPU 温度/显存历史以及原生后端生命周期管理。

默认 SI 下 NVIDIA GPU 依赖 `nvidia-smi`，AMD/Intel GPU 使用率不可用。Apple Silicon GPU、SoC 温度与功耗需选择 mactop；它不提供独立显存或 CPU 频率。Go 不提供 GPU 或每核 CPU。功率来自 SoC 或电池，不能当作整机墙插功率。

本项目有自动测试、真实 macOS SI 采集及 Harness HTTP/认证集成验证；Windows/Linux、真实 mactop/Go 服务、NVIDIA 硬件和完整浏览器交互仍需对应环境验证。上游关于 Windows/Linux 性能的数字不作为本移植版的实测结论。

## 来源

- [原版说明](https://github.com/nexmoe/vscode-monitor-pro/blob/36b8f7487d2b6d3b9d6b210e372c18cb824eb25d/README_zh-cn.md)
- [Harness 安装与数据源说明](../README.md)
- [Client 实现](../src/client.tsx)、[显示与图表实现](../src/view.ts)、[采集实现](../src/collector.ts)
