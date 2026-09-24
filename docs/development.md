# 开发与 RC 发布

[返回 README](../README.zh-CN.md) · [配置指南](configuration.md) · [实现设计](../DESIGN.md)

本文面向维护者。**当前分支（`adapt-dsh-0.1.7-rc.1`）把插件改为只支持 dsh `0.1.7` 线**，开发依赖与 peer 范围都是 `0.1.7-rc.1`。已核对的接缝变更见 [0.1.7 适配评估](2026-09-24-dsh-0.1.7-rc.1-assessment.md)。

**包版本号在本分支保持 `0.8.6-rc.3` 不变。** 本仓库是 `wenzetan/dsh-llm-newapi` 的 fork，适配内容以 PR 形式回上游；`npm` 上已发布的 `0.8.6-rc.3` 面向 `0.1.5`，本分支源码面向 `0.1.7`，两者由上游在合并后统一决定新版本号。不要在 PR 里 bump `package.json`。

CI 的固定宿主已同步抬到 `0.1.7-rc.1`（`.github/workflows/ci.yml` 的 plugin-check 与 boot 两个任务）。`boot` 的断言在 0.1.7 上本地复现通过：隔离 `DSH_HOME` + `--port 0`，tarball → profile → 首页 200 → boot 图 → 自有 RPC 通道。`plugin-check` 在本仓库会停在 `warn`，唯一原因是 `not-in-hub`（未登记 hub catalog），基线上同样如此，见评估文档「已知缺口」。

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
| `npm run test:host` | 真实 workspace 的 LLM 导出、入库快照、离线链接与旧宿主（0.1.5）拒绝诊断 |
| `node test/smoke.mjs` | 真实 Cordis 组合下的注册、设置与网关替身行为 |
| CI `plugin-check` | 插件清单、补丁与包结构的静态检查 |
| CI `boot` | 在隔离环境安装 tarball，启动真实 Web，检查认证流程、客户端加载清单和自有 RPC 响应 |

`npm test` 依次执行客户端测试、宿主兼容检查和组合测试。它不会自动操作真实浏览器，也不会请求真实网关。启动页的客户端加载清单中出现插件，只能说明插件已被发现，不能证明设置页已经在浏览器中正常运行。

`npm run cache:models-dev` 可刷新开发用的公共目录缓存。缓存缺失时，对真实目录的可选检查会跳过，不影响普通 smoke；不要把这种跳过描述为完整外部服务验证。

## 适配新宿主时的顺序

1. 核对上游固定标签的源码与实际 npm 包，确定哪些插件调用受影响。设置接缝与消息词表是 0.1.7 这一轮的两处大改，先看这两处。
2. 更新开发依赖和锁文件，审查 peer 范围及旧的 dependency overrides。
3. 更新宿主导出快照与被拒绝宿主的 fixture，并抬 CI 的固定宿主版本。
4. 运行类型、构建、测试和打包检查，提交生成产物。
5. 用同一 tarball 验证真实宿主启动、设置页加载、凭据与配置保存、模型发现和文本/工具调用。
6. 更新双语 README 的版本状态、指定版本安装命令和已知限制。

注意 npm 的 prerelease 范围：`>=0.1.5-rc.1 <0.1.6` 不会自动接受 `0.1.7-rc.1`，因此本插件改用 `>=0.1.7-rc.1 <0.1.8` 明确锁定新宿主线。最低版本 guard、peer 元数据与“已验证版本”表是三个不同层面的约束，不能互相替代。依据见[本轮适配评估](2026-09-24-dsh-0.1.7-rc.1-assessment.md)。

若宿主某个补丁版本改变了导出面，`surfaceSharedBy` 不再包含它，门禁会失败——此时应按下文流程处理，而不是直接抬低下限。

### 登记新的宿主补丁版本

`test/fixtures/dsh-llm-0.1.7.exports.json` 的 `surfaceSharedBy` 列出实测与快照共享同一导出面的版本。上游常以完全相同的代码重切 RC，所以按补丁号判定兼容会误报。遇到未列出的版本时，宿主兼容门禁会失败并提示比对导出面，步骤是：

1. 下载新旧两个版本的实际 npm 包，逐个文件比对，确认 `lib/**` 是否一致。
2. 用新版本安装依赖，运行 `npm run typecheck`、`npm run build` 和 `npm test`，并确认重建后的 `lib/` 无漂移。
3. 若导出面一致，把该版本加入 `surfaceSharedBy`；若不一致，重新生成快照并按新宿主线处理。
4. 若该版本成为开发与 CI 的默认 pin，同时更新 `package.json`、CI 的固定宿主和 README 的版本表。

## 本次发布约定

**本分支不做发布，也不 bump 版本。** 落地路径是向 `wenzetan/dsh-llm-newapi` 提 PR；包版本、RC 标签、CI 宿主 pin 与 npm 发布都由源项目维护者在合并时统一处理。提交内容只包含源码、测试、生成产物与文档。

关于 RPC 通道的一个坑：0.1.7 宿主线上 `connection.rpc.handle()` 依然不可用（与 0.1.5 同因），它内部的 effect 会抛 `cannot get property "webServer" without inject` 并被吞掉，导致通道静默缺失、浏览器撞上 405。插件改为把自身作用域作为 owner 传给 `connection.register(owner, channel, handler)`。细节见 [DESIGN](../DESIGN.md)；单元测试的替身已复现该守卫，boot 检查是最终防线。

锁文件说明：本轮沿用 0.1.5 时期的既有条目，只移除 `@deepseek-ai/*` 子树并让 npm 从 `package.json` 重新求解（`npm install --package-lock-only`），随后用 `npm ci` 验证可复现安装。实测 50 个条目变化：31 个属于 dsh 树，19 个是 0.1.7 新引入的传递依赖（`js-yaml`、`ajv`、`semver`、`yaml`、`node-addon-*` 等）。`undici`、`eventsource-parser`、`vitest`、`esbuild`、`typescript`、`zod`、`rolldown`、`postcss` 均保持原版本。

发布工作流只有在配置了 `NPM_TOKEN` 时才会发布 npm，因此 GitHub Release 成功不等于 npm 包已可安装。合并后发布时核对：

```sh
npm view dsh-llm-newapi@<新版本> version
npm view dsh-llm-newapi dist-tags --json
```

同时检查 Release 的 Pre-release 标记、tarball 内版本和标签提交。只有这些检查完成后，README 才能把该版本标为“已发布”。仓库保留了人工晋升正式版的流程，但它不属于本轮操作。

## 其他安装来源

需要复现 GitHub 版本时可指定标签，例如：

```sh
dsh plugin --profile web add "github:wenzetan/dsh-llm-newapi#v0.8.6-rc.3"
```

本分支尚未发布，无法用标签安装；按 README 的 `0.1.7-rc.1` 一节从本仓库构建。

也可从对应 [Release](https://github.com/wenzetan/dsh-llm-newapi/releases) 获取 `.tgz`，再用 `dsh plugin --profile web add` 安装下载文件的绝对路径。日常使用优先采用 README 中的 npm 精确版本命令。

## 历史文档

[rc.1 发布计划](superpowers/plans/2026-09-07-pr4-0.8.6-rc.1-release.md) 是 2026-09-07 的执行记录，不是本轮操作清单。历史功能与修复见 [Releases](https://github.com/wenzetan/dsh-llm-newapi/releases)；当前行为以源码和现行指南为准。
