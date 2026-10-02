# 开发与 RC 发布

[返回 README](../README.zh-CN.md) · [配置指南](configuration.md) · [实现设计](../DESIGN.md)

本文面向维护者。当前包版本为 `0.2.0-rc.2-v0.1`，适配 dsh `0.2.0` 单宿主线（开发与 CI 固定 `0.2.0-rc.2`，peer 下限与运行时最低版本为 `0.2.0-rc.1`）。**本分支尚未发布**：npm 上插件的 `latest` 与 `next` 都仍指向 0.1.7 线的 `0.1.7-rc.1-v0.3`，0.1.5 线冻结在 `0.1.5-rc.3-v0.3`。本轮把宿主 pin、导出面快照与 CI 一并抬到 0.2.0 线（`0.2.0` 相对 `0.1.7` 的具名导出多 2 个）；`0.1.7` 及更早宿主由入口版本 guard 明确拒绝。自有 RPC 通道的注册仍是「把自身注入作用域作为 owner 传给 `connection.register`」——0.2.0 并未修掉让公开 `rpc.handle` 不可用的那个作用域问题，详见下文。本轮保持 RC，不执行正式版晋升。

## 版本号规则（跟随宿主）

插件版本号跟随上游宿主，格式为 `<dsh 版本>-v<本插件序号>`，Git 标签与 GitHub Release 是同一个名字加 `v` 前缀（即 `v<插件版本>`）：

- dsh `0.1.5-rc.3` → 插件 `0.1.5-rc.3-v0.1`，tag/Release `v0.1.5-rc.3-v0.1`；
- dsh `0.1.7-rc.1` → 插件 `0.1.7-rc.1-v0.1`，tag/Release `v0.1.7-rc.1-v0.1`；
- 同一宿主线上的后续插件改动只递增最后一段：`0.2.0-rc.2-v0.1`、`0.2.0-rc.2-v0.2`……；
- 宿主换线（本轮即从 0.1.7 换到 0.2.0）时，前面的段跟随新宿主版本，序号重新从 `v0.1` 起：dsh `0.2.0-rc.2` → 插件 `0.2.0-rc.2-v0.1`；
- npm 的 `version` 字段不能带前导 `v`，所以包版本写作 `0.2.0-rc.2-v0.1`，tag 写作 `v0.2.0-rc.2-v0.1`；
- `0.8.x` 是旧规则：对应 tag 已从仓库移除，npm 上的历史版本已标记 deprecated，不再新增。

新版本号在 semver 上小于旧的 `0.8.x`，因此发布时必须显式指定 dist-tag，不要依赖 npm 的默认 tag。用户安装用精确版本，例如 `dsh-llm-newapi@0.2.0-rc.2-v0.1`。

### 通道与正式版规则

CI 用 `LATEST_LINE`（release job 的一个环境变量）指定当前主推宿主线，当前为 `v0.2.0`：

- **主推线的 rc tag**（如 `v0.2.0-rc.2-v0.1`）→ npm `latest`，GitHub Pre-release；
- **其他线的 rc tag** → npm `next`，GitHub Pre-release；
- **正式版 tag**（宿主段无 `-rc.N`，如 `v0.2.0-v0.x`）→ npm `latest`，GitHub Release 标记为正式（非 Pre-release）。

升格或切换主推线时，改 CI 里 `LATEST_LINE` 一行即可。0.1.5 线已冻结（版本固定 `0.1.5-rc.3-v0.3`），不会再有新发布；0.1.7 线曾长期占据 `latest`，本分支发布 0.2.0 线后由 `LATEST_LINE` 决定谁进 `latest`，另一条 rc 线进 `next`。

原先「把 `latest` 重认领到最新稳定版」的步骤已删除：它会把 `latest` 指回已被 deprecate 的 `0.8.4`。

**晋升流程（`promote` workflow，手动触发）**：输入一个 rc tag（如 `v0.2.0-rc.2-v0.1`），job 会：

1. 校验 tag 格式与「该提交上的 CI 已成功」；
2. 推导 stable tag（`v0.2.0-rc.2-v0.1` → `v0.2.0-v0.1`），要求它尚不存在；
3. 在 rc 提交上创建**只改版本号的发布提交**（`package.json` 与 `package-lock.json`），打 stable tag 并推送；
4. 显式触发 release workflow（GITHUB_TOKEN 推送的 tag 不触发 workflow）。

该发布提交**刻意不推送到 main**：main 同时只跟踪一条宿主线，而 stable twin 可能属于较旧的线。发布产物因此与 tag 指向的提交逐字节一致（可对照 Release 资产与 npm 包的 SHA256）。

开发依赖与 CI 的固定宿主都使用 **`0.2.0-rc.2`**，而 peer 下限与运行时最低版本是 **`0.2.0-rc.1`**。pin 表示我们构建和验证所针对的版本，下限表示插件仍愿意接受的最低版本；本轮换线后两者首次分离，是因为 `0.2.0-rc.1` 与 `0.2.0-rc.2` 共享同一具名导出面（`surfaceSharedBy` 同时列出两者），rc.1 上的 0.2.0 接缝与 rc.2 相同。若将来某个补丁版本改变了导出面，`surfaceSharedBy` 不再包含它，门禁会失败——此时应按下文流程处理，而不是直接抬低下限。

## 本地构建

使用 Node.js 24，与 CI 保持一致。在仓库根目录执行：

```sh
npm ci
npm run typecheck
npm run build
npm test
```

`npm ci` 复现锁文件依赖。调整依赖时再使用 `npm install` 更新锁文件，不要用浮动 npm 标签替代宿主版本的固定值。

构建生成 `lib/index.js`、`lib/client.js` 和类型声明。**源码改动后需要提交对应的 `lib/` 产物**，因为从 GitHub 安装的用户会使用这些文件。CI 会重建并检查产物是否与提交一致。

## 本地加载插件

先完成构建，再把仓库链接到开发用的 web profile。使用真实绝对路径，例如：

```sh
dsh plugin --profile web add "link:D:/Projects/Github/dsh-llm-newapi"
```

macOS / Linux 可使用自己的绝对目录，例如 `link:/home/me/dsh-llm-newapi`。确认 bundle 登记后重启 dsh Web；不要把上述示例路径当成固定安装位置。

需检查实际分发包时：

```sh
npm pack
```

`prepack` 会先构建。用输出的 `.tgz` 绝对路径替换 `link:` 参数，可验证发布包安装。应使用隔离的 `DSH_HOME`，避免与日常设置和会话混用。

## 每项测试能证明什么

| 命令或检查 | 能验证什么 |
| --- | --- |
| `npm run typecheck` | 宿主与客户端类型是否匹配开发依赖 |
| `npm run build` | 宿主、浏览器 JS 和类型声明能否生成 |
| `npm run test:client` | NewAPI 设置组件的交互、远程调用和状态处理 |
| `npm run test:host` | 真实 workspace 的 LLM 导出、入库快照、离线链接与旧宿主拒绝诊断 |
| `node test/smoke.mjs` | 真实 Cordis 组合下的注册、设置与网关替身行为 |
| CI `plugin-check` | 插件清单、补丁与包结构的静态检查 |
| CI `boot` | 在隔离环境安装 tarball，启动真实 Web，检查认证流程、客户端加载清单和自有 RPC 响应 |

`npm test` 依次执行客户端测试、宿主兼容检查和组合测试。它不会自动操作真实浏览器，也不会请求真实网关。启动页的客户端加载清单中出现插件，只能说明插件已被发现，不能证明设置页已经在浏览器中正常运行。

`npm run cache:models-dev` 可刷新开发用的公共目录缓存。缓存缺失时，对真实目录的可选检查会跳过，不影响普通 smoke；不要把这种跳过描述为完整外部服务验证。

## 适配新宿主时的顺序

1. 核对上游固定标签的源码与实际 npm 包，确定哪些插件调用受影响。
2. 更新开发依赖和锁文件，审查 peer 范围及旧的 dependency overrides。
3. 更新宿主导出快照与 CI 的固定宿主版本。若保留旧版本支持，同时测试旧、新两组。
4. 运行类型、构建、测试和打包检查，提交生成产物。
5. 用同一 tarball 验证真实宿主启动、设置页加载、凭据与配置保存、模型发现和文本/工具调用。
6. 更新双语 README 的版本状态、指定版本安装命令和已知限制。

注意 npm 的 prerelease 范围：`>=0.1.5-rc.1` 或 `>=0.1.7-rc.1` 都不会自动接受 `0.2.0-rc.1`，因此本插件改用 `>=0.2.0-rc.1 <0.3.0` 明确锁定 0.2.0 宿主线。最低版本 guard、peer 元数据与“已验证版本”表是三个不同层面的约束，不能互相替代。详细依据见[本次适配评估](2026-10-01-dsh-0.2.0-rc.2-assessment.md)。

### 登记新的宿主补丁版本

`test/fixtures/dsh-llm-0.2.0-rc.2.exports.json` 的 `surfaceSharedBy` 列出实测与快照共享同一导出面的版本（当前为 `0.2.0-rc.1` 与 `0.2.0-rc.2`）。上游常以完全相同的代码重切 RC，所以按补丁号判定兼容会误报。遇到未列出的版本时，宿主兼容门禁会失败并提示比对导出面，步骤是：

1. 下载新旧两个版本的实际 npm 包，逐个文件比对，确认 `lib/**` 是否一致。
2. 用新版本安装依赖，运行 `npm run typecheck`、`npm run build` 和 `npm test`，并确认重建后的 `lib/` 无漂移。
3. 若导出面一致，把该版本加入 `surfaceSharedBy`；若不一致，重新生成快照并按新宿主线处理。
4. 若该版本成为开发与 CI 的默认 pin，同时更新 `package.json`、CI 的固定宿主和 README 的版本表。

## 本次发布约定

| 项目 | 要求 |
| --- | --- |
| 包版本与标签 | 0.2.0 线（本分支，未发布）：`0.2.0-rc.2-v0.1` / `v0.2.0-rc.2-v0.1`；已发布线：`0.1.7-rc.1-v0.3` / `v0.1.7-rc.1-v0.3`（npm `latest`）与 `0.1.5-rc.3-v0.3` / `v0.1.5-rc.3-v0.3`（冻结）（规则见上文「版本号规则」） |
| GitHub Release | Pre-release，tag 名与 npm 版本一一对应 |
| npm dist-tag | 当前 `latest` 与 `next` 都指向 0.1.7 线 `0.1.7-rc.1-v0.3`（实测）；本分支合入并打 tag 后，`LATEST_LINE=v0.2.0` 会让 0.2.0 线进 `latest`。发布必须显式指定 dist-tag（新版本号在 semver 上低于旧线 `0.8.x`，不能依赖默认 tag） |
| 历史版本 | tag 已移除；npm 上的 `0.8.x` 系列已标记 deprecated，不再维护 |

完成适配后再更新包版本与锁文件。候选提交必须通过构建、插件规范检查和真实启动检查，并验证浏览器与网关的实际行为。**本分支是 fork 提回上游的 PR：上游 CI 是否通过以上游维护者的实际结论为准，本地不替它下结论。** 已知本仓库在 `plugin-check` 上会有唯一 warning `not-in-hub`（仓库未登记进 hub catalog），与宿主线无关。合入后，从已经确认的提交创建 RC 标签；标签工作流负责打包与发布。**本次不要填写 workflow_dispatch 的 `rc_tag` 晋升输入。**

当前进度：0.2.0 适配已完成类型检查、构建、组件测试、宿主兼容与 Cordis 组合测试（命令与结果见[本次适配评估](2026-10-01-dsh-0.2.0-rc.2-assessment.md)）；**尚未发布，也尚未在真实 0.2.0 宿主上做端到端启动验证**（本沙箱的 `/root/.dsh/profiles/web` 只读，无法执行）。已发布线：0.1.7 线最新修订为 `0.1.7-rc.1-v0.3`（npm `latest`），0.1.5 线冻结在 `0.1.5-rc.3-v0.3`。

旧线发布说明：0.1.5 线的 tag `v0.1.5-rc.3-v0.3` 指向一个专门的发布提交（基于该线最后的功能提交，仅改写版本号并带上当时的 CI 快照），因此 tag 内的 `package.json` 版本与 npm 上的包一致。推送该 tag 时 CI 的 `boot` job 会跳过——CI 固定宿主是 `0.2.0-rc.2`，旧线代码会按版本 guard 拒绝启动，这是预期行为；`build`/`plugin-check`/`release` 仍会运行，失败仍会阻断发布；npm 上版本已存在时发布步骤自动跳过（rerun-safe）。0.1.7 线的 tag 同理跳过 `boot`。

关于 RPC 通道：插件走的是 connection 服务自身的 `register(owner, channel, handler)`，**不是**类型上公开的 `connection.rpc.handle(channel, handler)`。原因与 0.1.7 相同且 0.2.0 没有修：「`rpc` getter 捕获服务自身 `ctx`，该作用域没有注入 `webServer`」（服务只声明 `inject = ['credentials']`），`register` 内部求值 `owner.webServer.register(route)` 时 cordis 抛 `cannot get property "webServer" without inject` 并被 effect 吞掉，通道静默缺失、浏览器撞 405。`dsh-client-connection@0.2.0-rc.2` 的 `rpc.handle` 仍委托给同一个 `register(this.ctx, …)`；上游自己只用 `rpc.intercept('/api', …)`。把自身注入作用域当 owner 传进去即可修好，`register` 在 0.1.7 与 0.2.0 上都存在（私有，故类型上要 cast）。细节见 [DESIGN](DESIGN.md)；`test/smoke.mjs` 的 `FakeConnection` 忠实复现了「只有 owner 作用域才有 `webServer`」的约束（传错 owner 会抛错，不再是静默缺失）；CI 的真实启动检查是最终防线——本分支首次运行时正是它抓出了 405。本沙箱无法执行真实启动（`/root/.dsh/profiles/web` 只读），需在装了 `0.2.0-rc.2` 的终端复验。

锁文件说明：本轮没有删除锁与 `node_modules` 重装，而是从改写后的 `package.json` 最小重新求解——两个 dsh 包树里共 18 个条目的版本切到 `0.2.0-rc.2`，**非 dsh 依赖全部保持原版本**。同时移除 0.2.0 不再需要的 9 个 dsh 内部包（`dsh-app-boot`、`dsh-home-paths`、`dsh-invariants`、`dsh-package-manifest`、`dsh-scope`、`dsh-system-prompt`、`cordis-plugin-group`、`cordis-plugin-include` 等）和 16 个随 0.1.7 子树消失的传递依赖（`ajv`、`semver`、`fast-uri`、`json-schema-traverse`、`resolve.exports`、8 个 `node-addon-*` 等），因此 `package-lock.json` 条目数从 210 降到 186（净 -24：25 条移除、1 条新增）。评审时按 `npm ls` 对照确认没有意外的主版本跃迁。

发布工作流只有在配置了 `NPM_TOKEN` 时才会发布 npm，因此 GitHub Release 成功不等于 npm 包已可安装。发布后核对：

```sh
npm view dsh-llm-newapi@0.2.0-rc.2-v0.1 version
npm view dsh-llm-newapi dist-tags --json
```

npm CLI 对刚发布的版本有本地缓存，出现 404 时用 registry 直查确认：

```sh
curl -sS "https://registry.npmjs.org/dsh-llm-newapi" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j['dist-tags'],Object.keys(j.versions).length)})"
```

同时检查 Release 的 Pre-release 标记、tarball 内版本和标签提交。

一条操作限制：npm 已禁止「绕过 2FA 的 granular access token」执行 unpublish（返回 403 `Granular access tokens that bypass two-factor authentication may not perform this action`），因此历史版本无法用 CI token 删除，改用 `npm deprecate` 标记；只有账号本人在交互式登录（完成 2FA）后才能删除版本。

仓库保留了人工晋升正式版的流程，但它不属于本轮操作。该流程要求 main 与待晋升 RC 指向同一提交，再生成稳定版本提交；如果 main 已有新提交，应重新发布并验证新的 RC，不能跳过必需检查。

## 其他安装来源

需要复现 GitHub 版本时可指定标签。已发布的适配线标签有 `v0.1.7-rc.1-v0.3`（npm `latest`）与 `v0.1.5-rc.3-v0.3`（冻结）；本分支的 0.2.0 线标签尚未创建：

```sh
# 已发布线（0.1.7）
dsh plugin --profile web add "github:wenzetan/dsh-llm-newapi#v0.1.7-rc.1-v0.3"
# 或更早的 0.1.5 线
dsh plugin --profile web add "github:wenzetan/dsh-llm-newapi#v0.1.5-rc.3-v0.3"
```

也可从对应 [Release](https://github.com/wenzetan/dsh-llm-newapi/releases) 获取 `.tgz`，再用 `dsh plugin --profile web add` 安装下载文件的绝对路径。日常使用优先采用 README 中的 npm 精确版本命令。

## 历史文档

[rc.1 发布计划](superpowers/plans/2026-09-07-pr4-0.8.6-rc.1-release.md) 是 2026-09-07 的执行记录，不是本轮操作清单。历史功能与修复见 [Releases](https://github.com/wenzetan/dsh-llm-newapi/releases)；当前行为以源码和现行指南为准。
