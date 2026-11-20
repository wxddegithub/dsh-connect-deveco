<p align="center">
  <strong>dsh-connect-deveco</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg" alt="node >= 20">
  <img src="https://img.shields.io/badge/platform-Windows-blue.svg" alt="Windows">
</p>

<p align="center">
  把 DevEco Code 的免费 GLM 模型接入 DeepSeek Harness（DSH）——一个带状态胶囊、启停按钮、华为登录与看门狗的 DSH 插件。
</p>

> **风险提示（务必先读）**：本项目通过非官方客户端方式调用 DevEco Code 的模型服务，并非华为官方产品，也未获华为授权或背书。请仅使用**你本人合法注册**的华为账号、仅用于个人学习研究，不要转售、共享账号或绕过计费。使用第三方/非官方接入方式可能违反华为开发者协议并导致账号受限，一切后果由使用者自行承担。若只是想稳定使用模型，请优先选择官方客户端。详见文末[免责声明](#免责声明)。

---

## 目录

- [功能特性](#功能特性)
- [工作原理](#工作原理)
- [目录结构](#目录结构)
- [前置条件](#前置条件)
- [完整安装与使用流程](#完整安装与使用流程)
- [在 DSH 里怎么操作](#在-dsh-里怎么操作)
- [命令行与 AI 工具](#命令行与-ai-工具)
- [配置说明](#配置说明)
- [常见问题与排障](#常见问题与排障)
- [稳定性说明](#稳定性说明)
- [免责声明](#免责声明)
- [致谢](#致谢)
- [第三方开源依赖](#第三方开源依赖)
- [许可证](#许可证)

---

## 功能特性

- **状态胶囊**：在输入框下方实时显示代理状态（运行中 / 已停止 / 未登录 / 授权已过期）。
- **主界面只管启停**：底部胶囊提供「启动 / 停止 / 重启」；账号相关操作全部收敛到「设置」页。
- **账号三态**：`有效 / 已过期 / 未登录`，到期时间取自本地 JWT 的 `exp` 声明（只解析时间戳，不读取/回传令牌本身）。
- **登录与登出**：设置页一键打开华为 OAuth 授权页，或登出清除本地凭据；授权到期后胶囊变色，点击可直达设置页。
- **看门狗**：每 60 秒检测一次，代理意外退出会自动拉起（记录自动重启次数）。
- **跨权限停止**：代理若以管理员权限运行，普通权限的停止仍可通过 WMI 完成。
- **AI 工具**：向 DSH 内的智能体暴露 `deveco_proxy` 工具，动作 `status / start / stop / restart / login / logout`。
- **开箱即用**：随包内置 `opencode-deveco` 代理与其 `undici` 运行时，提供一键安装脚本与 DSH provider 配置样例。

## 工作原理

```
DeepSeek Harness
   │  OpenAI 协议（/v2/chat/completions）
   ▼
本地代理 opencode-deveco  (127.0.0.1:17128)
   │  注入华为账号 OAuth 凭据 + 客户端头
   ▼
华为 DevEco Code 模型服务 (cn.devecostudio.huawei.com/.../v2)
```

本插件本身**不注册模型 provider**，只负责管理上面的「本地代理」。真正的 provider 由你按 [`config/dsh-provider.yml`](config/dsh-provider.yml) 合并到 DSH 配置中。配置文件里只需要一个非空占位 key（`DEVECO_DUMMY_KEY`），本地代理并不校验它。

模型：`GLM-5.3-DevEco` / `GLM-5.1-DevEco`。渠道标称 17 万上下文 / 3.2 万输出；实际额度与频率限制以你的华为账号为准。所谓「每天 500M 额度」的说法未在华为官方渠道核实到——DevEco Code 的 GLM 通常被描述为免费不限量，「500 万 token」更像是智谱 ZCode 的活动口径，请勿以此为准。

## 目录结构

```
dsh-connect-deveco/
├── index.js                       # 插件宿主端：状态/启停/登录/登出/看门狗/工具
├── client.js                      # 插件客户端：状态胶囊 + 设置页面板
├── cordis.patch.yml               # DSH bundle 装载清单
├── icon.svg                       # 插件图标（原创）
├── stop-proxy-wmi.ps1             # 跨权限停止代理的兜底脚本
├── locale/{zh,en}.json            # 界面文案
├── config/dsh-provider.yml        # 需合并到 DSH 的 provider 配置样例
├── scripts/setup-windows.ps1      # Windows 一键初始化（幂等）
├── vendor/opencode-deveco/        # 内置代理（MIT）+ 其 undici 运行时
├── dev/                           # 自检脚本（verify-client / verify-render）
├── README.md / README.zh.md       # 本文档（中英双份为同一内容）
├── LICENSE                        # MIT
└── THIRD_PARTY_NOTICES.md         # 第三方许可与无关声明
```

## 前置条件

1. **Node.js ≥ 20**（代理运行时依赖）：<https://nodejs.org/>
2. **DeepSeek Harness（DSH）**，且启用 Web GUI 与 bundle 插件管理。
3. **中国大陆地区注册的华为账号**（见下方说明）。项目社区反馈非大陆账号（siteId≠1）无法完成授权——此点未在华为官网核实，请以官网为准。
4. **Windows**（一键脚本与 WMI 停止兜底为 Windows 实现；macOS/Linux 可参考 `vendor/opencode-deveco` 自带的 launcher 自行适配）。

## 完整安装与使用流程

### 第 0 步：注册并准备好华为账号

以下为华为官方入口与官方帮助页，具体注册步骤与条款**请自行核对官网**：

- 华为账号注册/登录：<https://id.cloud.huawei.com>
- 华为账号官方帮助（注册流程说明）：<https://consumer.huawei.com/cn/support/content/zh-cn16015270/>
- 华为账号介绍页：<https://consumer.huawei.com/cn/mobileservices/id/>

常见流程（以官网为准）：进入注册页 → 同意协议 → 手机号或邮箱注册 → 填写验证码 → 补充出生日期等资料。官网说明当前注册地默认为中国，部分操作可能有约 72 小时的账号保护期。基础华为账号注册通常不要求实名；开发者侧是否需要实名认证**待用户自行核对官网**。

### 第 1 步：安装 DevEco Studio（可选但推荐）

模型服务来自 DevEco Code，安装官方 IDE 有助于确认账号可用：

- 产品页：<https://developer.huawei.com/consumer/cn/deveco-studio/>
- 下载页：<https://developer.huawei.com/consumer/cn/download/>
- DevEco 服务入口：<https://cn.devecostudio.huawei.com/>

OAuth 是华为开放平台的标准授权机制（<https://developer.huawei.com/consumer/cn/doc/HMSCore-Guides/open-platform-oauth-0000001053629189>）。本项目的回调地址为本地 `127.0.0.1:10101`，授权票据约 28 天过期——这两点是本项目/社区的配置值，**非华为官方承诺，待自行核对**。

### 第 2 步：一键初始化（Windows）

在本插件目录打开 PowerShell，执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```

脚本做三件事（可重复运行）：

1. 若内置运行时尚未安装，执行 `npm install --omit=dev` 安装 `undici`；
2. 若未设置，写入用户级环境变量 `DEVECO_DUMMY_KEY=dsh-local-proxy-placeholder`；
3. 在「启动」文件夹安装开机自启脚本 `DevEcoProxy.vbs`（静默、无需管理员权限）。

脚本**不会**替你改 DSH provider 配置，也**不会**触碰华为凭据。

### 第 3 步：把 provider 配置合并进 DSH

打开 [`config/dsh-provider.yml`](config/dsh-provider.yml)，把其中的 `deveco:` 块粘贴到你 DSH profile 的 `llm-pi-ai` 服务 `config.providers` 下（通常是 `~/.dsh/profiles/<profile>/cordis.patch.yml`）。注意缩进与已有的 provider（如 `fox-aws`）对齐。**不要**直接覆盖整个 profile——里面还有你自己的默认模型和其他 provider。

### 第 4 步：安装并启用插件 bundle

在 DSH 中安装本目录为 bundle（插件管理器 → 从本地目录安装，选择本仓库根目录），确保 `dsh-connect-deveco` 处于启用状态。

### 第 5 步：重启 DSH 并刷新界面

重启 DSH 让新的环境变量与 provider 生效；用 dsh web 打印出的地址重新打开 Web GUI，按 **F5** 刷新（客户端代码只在页面加载时注册）。

### 第 6 步：登录华为账号

在 DSH **设置 → DevEco Code** 面板点击「登录」（未登录时）或「重新登录」（已登录时）。插件会打开系统默认浏览器（优先 Edge / Chrome）访问华为 OAuth 页；确认是你的账号后点「允许」完成授权。回到 DSH，等状态胶囊变绿（最多 10 秒轮询）。

授权票据到期后，胶囊会显示「授权已过期」并变色，点击胶囊即可跳回设置页重新登录；也可以在设置页点「登出」清除本地凭据后重新走登录流程。

### 第 7 步：在 DSH 里选用模型

在会话的模型选择里切换到 **DevEco Code → GLM-5.3-DevEco**（或 GLM-5.1-DevEco）即可对话。若提示 `503 / connect-refused`，多半是代理没起来——按下方排障处理。

## 在 DSH 里怎么操作

- **底部胶囊**：`启动`（未运行时）/ `停止` + `重启`（运行时）。账号失效时胶囊变色并提示「点击前往设置页登录」，点击直达设置页对应分区。
- **设置 → DevEco Code**：
  - 华为账号区：账号状态、到期时间、「登录 / 重新登录 / 登出」。
  - 代理控制区：启动 / 停止 / 重启、看门狗状态、自动重启次数。
  - 风险提示区：非官方接入的免责说明。

## 命令行与 AI 工具

插件向 DSH 智能体注册了 `deveco_proxy` 工具，参数 `action` 取值：

| action | 作用 |
| --- | --- |
| `status` | 返回运行状态、账号三态、到期时间、自动重启次数等 |
| `start` / `stop` / `restart` | 启停或重启本地代理 |
| `login` | 打开浏览器完成授权（已登录时不会弹窗） |
| `logout` | 登出并清除本地凭据（代理保持运行） |

也可直接用宿主代理的 HTTP 接口（仅回环可访问，端口 `17128`）：

- `GET  /plugins/dsh-connect-deveco/status`
- `POST /plugins/dsh-connect-deveco/start`
- `POST /plugins/dsh-connect-deveco/stop`
- `POST /plugins/dsh-connect-deveco/restart`
- `POST /plugins/dsh-connect-deveco/login`
- `POST /plugins/dsh-connect-deveco/logout`

## 配置说明

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 代理根目录 | 随包 `vendor/opencode-deveco` | 环境变量 `DEVECO_PROXY_ROOT` 或插件配置 `config.proxyRoot` 可覆盖为你自己的 checkout |
| 代理端口 | `17128` | 与 DSH provider 的 `baseURL` 保持一致 |
| 看门狗周期 | 60 秒 | 检测代理是否存活，异常退出自动拉起 |

## 常见问题与排障

| 现象 | 原因 / 处理 |
| --- | --- |
| 胶囊显示「已停止」 | 点胶囊上的「启动」；若启动失败看 `vendor/opencode-deveco/proxy.log.err` |
| 模型报 `503 / connect-refused` | 代理未启动或刚重启，DSH 的 acp-proxy 有约 47 秒熔断冷却，稍候或重启 DSH |
| 点「停止」后代理仍在 | 代理以管理员权限运行时普通停止会失败，插件已用 WMI 兜底；仍失败请手动结束 `node.exe` |
| 点登录打开的是 VSCode / 网页 URL 被截断 | 旧版用 `cmd /c start`，URL 中的 `&` 被当成命令分隔符。请升级到本版（直接调用 msedge.exe/chrome.exe） |
| 登录页点「允许」没反应 | 多半是授权 URL 缺了 `appid`/`code` 参数（同上），确认浏览器地址栏是完整 URL |
| 设置页右侧空白 | 客户端代码需页面加载时注册，按 F5 刷新；或看浏览器控制台是否有 slot 注册错误 |
| 授权到期 | 胶囊变色，点击跳设置页「重新登录」；到期时间来自本地 JWT 的 `exp` |

## 稳定性说明

本地代理由一个守护进程（`dist/daemon.js`）监督，意外退出会自动拉起；本插件再加一层 60 秒看门狗作为兜底。实践中仍可能遇到上游服务过载（例如 DevEco 自带的「Built-in model service is currently overloaded」）或授权过期——这类情况重启代理或重新登录通常可恢复。本插件**不保证**上游服务的稳定性，也不改变华为账号的额度与频率限制。

## 免责声明

1. 本项目与华为技术有限公司及其关联公司**无任何隶属、合作、授权或背书关系**；不含任何华为的代码、二进制文件或商标资产。
2. 本项目仅供个人在合法合规前提下学习、研究使用。
3. 使用者须自行遵守《华为开发者协议》等相关条款以及所在地法律法规。
4. 本项目按「现状（AS IS）」提供，不作任何明示或暗示的保证，包括适销性、特定用途适用性与不侵权。
5. 作者不对因使用本项目产生的任何后果负责，包括但不限于账号被限制/封禁、数据或积分损失、服务变更或中断。
6. 禁止将本项目用于商业转售、账号共享、绕过计费或任何规避服务对象限制的行为。
7. 上游 `opencode-deveco` 采用 MIT 许可证，版权归 Wenyin Root 所有；再分发必须保留其许可与版权声明（见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)）。
8. 非官方客户端接入存在账号风险：相关协议条款涉及账号共享（2.6）、目的限制（2.8）、未经授权访问/冒充官方客户端（3.1 c/e）、可撤销许可（3.3）、知识产权与反向工程（4.3/4.4）。缓解因素：使用本人账号、不转售、不绕过计费；加重因素：本项目用途本身即为非官方客户端接入，可能导致账号受限与声誉风险。以上并非已认定的违约结论，华为官网也未见明确的反自动化条款；具体条款**待用户自行核对官网**（开发者协议：<https://developer.huawei.com/consumer/cn/doc/start/agreement-0000001052728169>）。

## 致谢

- [opencode-deveco](https://github.com/wenyinos/opencode-deveco)（MIT，Copyright (c) 2026 Wenyin Root）——本地代理核心。
- [dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)——DSH 插件结构与 UI 组织方式的参考。
- [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Coder) 的插件与 Cordis 生态。

## 第三方开源依赖

详见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。随包内置的运行依赖：`opencode-deveco`（MIT）、`undici`（MIT）。华为相关名称与商标归华为所有。

## 许可证

MIT © 2026 dsh-connect-deveco contributors。详见 [`LICENSE`](LICENSE)。
