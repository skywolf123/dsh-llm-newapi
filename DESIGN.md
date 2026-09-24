# 实现设计

[中文使用指南](README.zh-CN.md) · [配置参考](docs/configuration.md) · [开发与发布](docs/development.md)

本文描述当前代码，不作为历史开发日志。当前源码、构建依赖和验证都针对 dsh `0.1.7-rc.1`，只支持 0.1.7 这条宿主线；`0.1.5` 及更早的宿主会被入口的版本 guard 明确拒绝。上一轮（0.1.5）的适配记录见[历史评估](docs/2026-09-10-dsh-0.1.5-rc.1-assessment.md)，本轮接缝变更见[0.1.7 适配评估](docs/2026-09-24-dsh-0.1.7-rc.1-assessment.md)。

## 插件负责什么

插件把 dsh 的模型请求转换为 NewAPI 网关接受的 OpenAI-compatible chat-completions 请求，再把 SSE 响应转换回 dsh 的内容块。

它提供一个名为 `newapi` 的模型供应商，以及一个独立的 Web 设置页。网关决定可用模型、权限与实际能力；插件不内置可直接使用的模型目录，也不修改 dsh 核心。

## 两侧如何协作

浏览器负责编辑和展示，宿主负责凭据读取、配置校验以及网络请求。

| 操作 | 数据流 |
| --- | --- |
| 保存网关和模型 | NewAPI 设置页 → `remote.settings.mutate` → profile 中插件条目的 config（`.volatile()` 字段） |
| 保存密钥 | 设置页 → `remote.credentials.set` → `newapi` 凭据引用 |
| 获取模型 | 设置页 → `remote.llm.discoverModels` → 适配器 → 网关 `/models` |
| 补充模型参数 | 设置页 → `/llm-newapi` RPC → 宿主下载 models.dev → 返回匹配候选 |
| 对话 | dsh LlmRuntime → NewApiAdapter → 网关 `/chat/completions` → SSE → dsh StreamChunk |

设置页通过 `settings.section` 注册，因此不需要给官方 Models 页面增加专用布局。客户端使用 dsh Remote 命名空间读写设置、凭据和模型目录；自有 RPC 仅负责 models.dev 参数查询。

## 代码导航

| 文件 | 职责 |
| --- | --- |
| [src/index.ts](src/index.ts) | 配置定义（.volatile）、最低宿主检查、服务注册、volatile 引用读取、设置写入校验和 RPC |
| [src/adapter.ts](src/adapter.ts) | 模型目录与发现、参数匹配、请求发送、重试策略元数据与错误处理 |
| [src/serialize.ts](src/serialize.ts) | 将消息和工具定义转换为网关请求 |
| [src/sse.ts](src/sse.ts) | 将字节流拆成 SSE payload，检查结束标记 |
| [src/translate.ts](src/translate.ts) | 合并文本、思考与工具调用增量，转换用量和结束原因 |
| [src/types.ts](src/types.ts) | 网关协议与模型参数查询的数据类型 |
| [src/client/apply.ts](src/client/apply.ts) | 设置页、语言字典、样式及远程服务接线 |
| [src/client/NewApiSection.tsx](src/client/NewApiSection.tsx) | 表单、候选模型、参数确认和保存交互 |
| [src/client/locale.ts](src/client/locale.ts) | 中英文界面文案 |
| [cordis.patch.yml](cordis.patch.yml) | 在 profile 中插入插件行 |

## 配置与凭据的生命周期

插件加载时注册供应商、适配器和模型发现处理器。settings 或 connection 服务稍后就绪时，通过 `ctx.inject` 安装设置呈现策略与 RPC，避免因加载顺序而漏注册。注册和样式等资源随对应的 Cordis 作用域释放。

设置接缝在 0.1.7 上换了实现。0.1.5 的 `ctx.settings.installSection(namespace, Schema, defaults, hooks)` 已被删除；现在 `SettingsForms` 直接遍历 `configEditor.configuration()`，把每个插件条目自己的 `Config` schema 投影成表单，因此：

- 插件把可编辑字段声明为 `.volatile()`，表单只显示这些字段；普通字段仍由 Cordis 配置文件管理。
- 写入不再经过插件的 `setSource`/`validate`/`onChange` 回调，而是写进 profile patch，再由 Loader 调用 `Entry.update`。**只改 volatile 字段**时 Loader 走 `_commitVolatile`：解析候选值、与当前快照逐字段比对、把新值原地写进运行中的 `Volatile` 引用，然后在该 fiber 上发出 `loader/volatile-update`，整个过程不重挂插件。
- 插件用 `ctx.inject(['settings'], child => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))` 声明「本插件自带设置页，不要自动生成表单」。
- 设置命名空间不再是固定字符串，而是 profile 条目 id（`ctx.fiber.entry?.options.id`，默认即 `llm-newapi`）。`registerConfigurableProviders` 的 `settingsNs` 与 `registerModelDiscovery` 共用这个值，官方 Models 页才能把目录条目与设置段对上。

写入时的校验落在 `internal/config` waterfall 上：`configEditor.edit` 与 Loader 的 `_commitVolatile` 都会先跑这条瀑布，插件在这里把候选值重新过一遍 `resolveAdapterOptions`，越界或不可服务（非 http(s) 的 baseURL、空的排除项、启用却非法的代理 URL）直接抛错，写入被拒绝，运行中的引用保持上一次可用值。这与上游 `llm-pi-ai` 的 `assertServiceable` 是同一形状。

自定义 RPC 通道的注册方式需要单独说明：0.1.7 宿主线上 `connection.rpc.handle(channel, handler)` 依然不可用（与 0.1.5 同因）。它的 `rpc` getter 捕获 `this.ctx`，而该上下文是 connection 服务自身的作用域，没有注入 `webServer`；`handle` 内部最终求值 `owner.webServer.register(route)`，cordis 抛出 `cannot get property "webServer" without inject`，异常又被 effect 吞掉，于是通道静默缺失，浏览器只能撞上 SPA fallback 的 405。插件改为注入 `connection` 与 `webServer`，并把自身作用域作为 owner 传给 connection 服务上的 `register(owner, channel, handler)`——也就是 `rpc.handle` 实际委托的那个方法。该方法在 0.1.7 上仍是服务原型上的私有方法（不在 `HostConnectionHandle` 类型里），因此保留原有的类型转换；处理函数多出的第四个 `peer` 参数被忽略。上游没有任何插件调用 `rpc.handle`；`dsh-api-gateway` 对需要 `webServer` 的工作同样注入这一对服务。这一契约由 CI 的真实启动检查守护，单元测试的替身无法复现该守卫。

每次请求读取一次 `Volatile` 引用的当前值，并据此解析密钥。配置热更新不会改变正在进行的请求。重试策略是在注册时读取的，所以修改它时通过 `registration.replace` 更新，避免短暂移除模型路由；触发点是 `loader/volatile-update` 事件。

密钥使用固定引用 `newapi`，不将 `NEWAPI_API_KEY` 作为回退来源。缺少密钥时插件仍能加载设置页，实际请求会报 `MISSING_CREDENTIAL`。浏览器不读取明文密钥。

## 网关协议的关键选择

| 选择 | 原因与行为 |
| --- | --- |
| 默认模型目录为空 | 不同网关的模型不同；由发现或用户配置补充 |
| 不设置统一输出上限 | 模型与全局配置均未指定时，省略 `max_tokens`，使用上游默认值 |
| 声明文本输入 | 当前序列化不提供图片能力；显式拒绝图片，避免静默丢失 |
| 按配置提供思考等级 | 声明列表决定可选等级，选中的值通过 `reasoning_effort` 发送；不额外发送 `thinking` |
| 保留空 assistant 文本为 `""` | 避免部分网关拒绝纯工具调用轮次中的 `null` 内容 |
| 工具调用轮次回传 `reasoning_content` | 保留部分 DeepSeek 系上游需要的推理上下文 |
| 只接受非空工具 ID / 名称增量 | 防止后续空字符串覆盖首段正确值 |
| 要求 SSE `[DONE]` | 区分正常完成与连接意外中断；结束前统一发出最终块、用量和 finish |
| 区分输入与缓存用量 | 从 prompt 总量中减去缓存命中，符合 dsh 的不相交计数约定 |
| 补充聚合总用量 | `totalTokens` 取 `prompt_tokens + completion_tokens` 的原始聚合值；网关给出总量时要求与聚合值一致，否则省略 |
| 工具结果用 `role: 'tool'` 消息 | 0.1.7 把工具结果提升为带 `toolCallId` 的一等消息；不再从内容块里找 `tool-result` |

`inputTokens` 扣除了缓存命中，而 `totalTokens` 是包含缓存命中的聚合总量，因此缓存命中非零时 `totalTokens` 大于 `inputTokens + outputTokens`。这与 dsh `TokenUsage`「聚合 prompt 与 output 的整次调用总量」的定义一致，不是记账矛盾。

### 0.1.7 消息词表里被显式拒绝的部分

0.1.7 引入了三样 chat-completions 线无法表达的东西，插件选择**明确报错**而不是静默丢弃：

| 形状 | 处理 | 原因 |
| --- | --- | --- |
| `role: 'developer'` 消息 | `UNSUPPORTED_CONTENT` | Session V4 用它承载动态工具增删；OpenAI-compatible 线没有对应角色 |
| `tool-addition` / `tool-removal` 内容块 | `UNSUPPORTED_CONTENT` | 同上；上游 `llm-deepseek`、`llm-pi-ai` 也尚未实现 |
| `ToolSchema.deferLoading` | `UNSUPPORTED_CONTENT` | 网关无法按需延迟加载工具定义；静默内联会让模型看到的工具集与 harness 的认知不一致 |

这三条都是上游自己标注为「为 V4 持久化预留、provider 与 UI 在生产者与消费者一起落地前一律拒绝」的行为，插件与之一致。

请求保留 `attributionHeaders()` 提供的 User-Agent，并发送必要的认证与内容类型头，不附加插件自行生成的用户或会话遥测标识。

模型发现的名称过滤只是一种启发式规则，不能验证模型是否真的支持文本或工具。models.dev 匹配同样只是参数建议；家族偏好、精确模型覆盖和近似匹配都不能代替网关实测。

## 构建与运行时依赖

宿主产物是 ESM，宿主包作为外部依赖，普通运行依赖包括 `undici` 和 `eventsource-parser`。浏览器产物由 esbuild 生成模块工厂，通过 `window.__ModuleLoader__.load` 登记；当前浏览器运行时导入为 React 及 JSX runtime，dsh 类型导入在构建时擦除。

类型声明由 TypeScript 生成，构建脚本会修正声明中的相对扩展名。JS、source map 和类型声明都提交至 `lib/`。测试范围和产物检查见[开发指南](docs/development.md)。

0.1.5 时期保留的四项 `overrides`（把 `dsh-type-meta`、`dsh-compact`、`dsh-paths`、`dsh-user-interaction` 别名到 `dsh-brand`）在本轮已**删除**。这四个名字在 0.1.7 线上确实仍不存在，但 0.1.7 的解析树同样不请求它们：`dsh-settings` 现在依赖 `@deepseek-ai/cosmokit`、`@deepseek-ai/dsh-config-editor` 与 `@deepseek-ai/cordis-plugin-loader`，没有任何包再引用那四个旧名。别名是防御性配置，而 0.1.7 的 peer 范围（`~4.0.4` / `~3.18.4`）已经足够精确，因此本轮按「无请求即删除」处理；若将来某个依赖重新请求这些名字，npm 会直接报 404，而不是被静默替换。

## 版本兼容的边界

入口读取宿主 `dsh-llm/package.json` 并拒绝低于 `0.1.7-rc.1` 的版本。这只能实现最低版本诊断，不能保证所有更高版本都兼容。ESM 具名导出还可能在入口求值之前失败，因此另有宿主导出与链接测试。

兼容性以**宿主线**为单位，而不是单个补丁号。`test/fixtures/dsh-llm-0.1.7.exports.json` 记录 0.1.7 线的具名导出面，并列出实测共享该导出面的版本。上游会以完全相同的代码重切 RC，因此按补丁号相等来判定兼容会误报。清单是有意显式的：遇到未列出的版本时门禁会失败，要求先比对导出面再决定是登记该版本还是重新生成快照。

0.1.7 相对 0.1.5 的导出面差异是 4 增 2 减：新增 `IMAGE_OFFLOAD_REQUIRED_CODE`、`createDeveloperMessage`、`projectOffloadedImages`、`requiredImageOffload`，移除 `offloadRequestImagesWithPolicy`、`offloadedImagePrefixCount`。插件只使用了两个面共有的符号，因此 `lib/index.js` 的静态导入能在被拒绝的 0.1.5 宿主上完成 ESM 链接，版本 guard 才有机会给出升级提示——这一点由 `test/host-compat.mjs` 的 Block E 守护。

宿主包在构建时是 external，不参与打包，所以换用共享同一导出面的版本不会改变产物。

npm 对 prerelease 范围的判断与自定义最低版本比较不同：`>=0.1.5-rc.1 <0.1.6` 这类范围不会自动纳入 `0.1.7-rc.1`，因此 peer 范围写作 `>=0.1.7-rc.1 <0.1.8`，明确只接受这一条宿主线。最低版本 guard、peer 元数据与文档中的已验证版本是三个不同层面的约束。

0.1.7 宿主在启动时安装全局代理 dispatcher；插件 models.dev 的显式 ProxyAgent 覆盖该次下载。关闭插件代理不等于绕过宿主代理。网络行为详见[配置指南](docs/configuration.md)。

## 当前未提供的能力

- 图片输入和统一的多模态网关支持。
- 多个独立 NewAPI 网关配置。
- 逐模型的 `systemPromptUpdate: 'in-history'` 能力声明。
- Session V4 的 `developer` 角色与动态工具增删（见上表）。

这些功能与「在新宿主上正常加载和完成现有任务」是不同的工作项，应分别验证。
