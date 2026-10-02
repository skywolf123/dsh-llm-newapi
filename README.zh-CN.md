# dsh-llm-newapi

[English](README.md) | **中文**

> **本项目已归档，不再维护。**
>
> dsh 0.2.0 已自带 **Custom Provider（自定义 Provider）** 功能，覆盖了本插件原有的能力；剩余缺口由第三方插件在原生的基础上补齐。新用户请勿安装本插件，已有用户请按下文[迁移](#迁移) 。

## 为什么归档

本插件写就时，DeepSeek Harness 还没有办法把模型层接到任意 OpenAI 兼容网关上：需要插件自己注册 provider 路由、通过 `/models` 发现模型、并自带一个设置页。`dsh-llm-newapi` 就是为 NewAPI 网关做这件事的。

这个缺口已经关闭。dsh 0.2.0 加入了原生 **Custom Provider** 功能（**设置 → 模型 → 添加模型提供方 → 自定义模型 API**），不装任何东西就能声明一个 provider：地址、协议、凭据和模型。对 NewAPI 这个场景，原生现在已经覆盖、并在多数方面超过本插件：

| 能力 | dsh-llm-newapi | 原生 Custom Provider（dsh 0.2.0） |
| --- | --- | --- |
| 自定义网关地址 + 密钥 | ✅ | ✅ |
| `/models` 模型发现 | ✅ 过滤 `embed`/`rerank`/`ranker` | ✅ 不过滤 |
| 多网关 | ❌ 固定单一 `newapi` 路由 | ✅ 每个路由一个 provider |
| 协议 | 仅 Chat Completions | Chat Completions / Responses / Anthropic Messages |
| 图片输入 | ❌ 恒为 text-only | ✅ 按模型声明 |
| 思考强度 | ✅ | ✅ 支持线上值映射与 DeepSeek `thinkingFormat` |
| 请求兼容开关 | ❌ | ✅ `compat.*` |
| models.dev 参数自动补齐 | ✅ | ❌ |

本插件有两项原生没有直接对应物：**从 models.dev 自动补齐模型参数**，以及**写入前的核对确认步骤**。这两项现在都由第三方插件提供——它们**补丁**原生 Custom Provider，而不是替换它。这是更好的位置：它们跟随宿主发布节奏，而不是钉在一个 pre-1.0 的适配器 seam 上。

与其继续对着不断移动的 seam 维护一条并行适配器，本仓库选择归档，转向原生功能 + 下列插件。

## 可替代项目

以下四个都是给原生 Custom Provider 补参数的插件——它们写入 `llm-pi-ai` 设置命名空间，由原生适配器负责通信，都不替换 dsh。

### [dsh-model-fix](https://github.com/TikaFlow/dsh-model-fix) —— 推荐

四者中最完整、维护最活跃的一个。

- 从 [models.dev](https://models.dev) 自动补齐自定义 provider 模型的 `reasoningEfforts`、`contextWindow`、`maxTokens` 与 `input`（图片模态）。
- 内置**离线缓存**：启动无需网络即可工作，随后后台刷新。
- 还会为 `openai-completions` 路由写入 `compat.supportsDeveloperRole: false`——这正是"只有推理模型报错"这类网关拒绝的修法。
- 设置卡片支持草稿/编辑/保存、**强制更新**、**恢复备份**和**排除提供方**列表；危险写入前有二次确认弹窗。
- 按模型记住推理档位，切换模型时自动恢复；可选"默认使用 high"。
- 支持 dsh `0.1.2-rc.1` ~ `0.2.0-rc.2`，测试覆盖较完整。

```sh
dsh plugin --profile web add https://github.com/TikaFlow/dsh-model-fix/releases/latest/download/dsh-model-fix.tgz
```

### [dsh-model-extension](https://github.com/lovezi0/dsh-model-extension)

最激进的一个：用自建的「模型+」页**替换**官方模型页，在表单里逐模型编辑 `reasoningEfforts`、`input` 和 `compat`，并支持 models.dev 预填。

- 如果你想要一个图形界面来改原生刻意留给 YAML 的字段，选它。
- 代价：它通过 bundle patch 禁用官方 `ui-settings-models` 入口。未来 dsh 若改掉这个入口名，patch 会静默失效、官方页悄悄回归——需要随适配器锚点更新重新核对。同时会连带移除该包里的官方 onboarding 组件。

### [dsh-model-info-fill](https://github.com/11zld22/dsh-model-info-fill)

折中方案：从 models.dev 补齐 `contextWindow`、`maxTokens`、`reasoningEfforts` 和 `input`，可为目录匹配不到的模型配置默认值，并提供"默认档位"选项（正好补上原生只有路由级 `reasoning` 的缺口）。

- 比上面两个更小更简单；同时兼容 dsh 0.1.6 与 0.1.7 的设置接口。
- 依赖前请自行确认 0.2.0 支持——它的 README 仍停留在 0.1.6/0.1.7。

### [dsh-models-dev-reasoning](https://github.com/aerince/dsh-models-dev-reasoning)

最精简的一个：单个零构建 `index.js`，只为未声明 `reasoningEfforts` 的模型写入该字段。无界面、无配置。

- 如果你只想补推理档位、又不想多一个设置卡片，选它。
- 最后更新于 2026-08-15，四者中维护最弱。

### 对照表

| | dsh-model-fix | dsh-model-extension | dsh-model-info-fill | dsh-models-dev-reasoning |
| --- | --- | --- | --- | --- |
| 思考档位 | ✅ | ✅ | ✅ | ✅ |
| 上下文 / 输出上限 | ✅ | ✅ | ✅ | ❌ |
| 图片模态 | ✅ | ✅ | ✅ | ❌ |
| `compat` 开关 | ✅ | ✅ | ❌ | ❌ |
| 设置界面 | ✅ | ✅ | ✅ | ❌ |
| 用户确认环节 | 草稿+保存，可备份/恢复 | 逐行表单+保存 | 开关+按钮 | 无（静默写入） |
| 数据来源 | models.dev + 离线缓存 | `models.json`（自行下载） | models.dev | models.dev，GitHub 回退 |
| 官方模型页 | 保留 | **替换** | 保留 | 保留 |
| dsh 支持 | 0.1.2-rc.1 – 0.2.0-rc.2 | 0.1.7 – 0.2.0 | 0.1.6 / 0.1.7 | 未声明 |

## 迁移

**建议：迁移到原生 Custom Provider；如果你依赖 models.dev 参数补齐，再装上 [dsh-model-fix](https://github.com/TikaFlow/dsh-model-fix)。**

- **完整指引：[从 dsh-llm-newapi 迁移](docs/migrating-from-dsh-llm-newapi.md)**——逐字段对照（`llm-newapi` → `llm-pi-ai`）、思考强度的结构变化、以及验证步骤。
- 原生 Custom Provider 文档：[Configure models](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md)。

简要步骤：

1. 升级到 dsh 0.2.0+ 即得到原生功能，网关本身不再需要插件。
2. 新建一个自定义 provider，填入你的 base URL、`openai-completions` 协议、密钥和模型。
3. 按对照表手工搬迁字段——或装 `dsh-model-fix` 让它补齐参数。
4. 新路由可用后，移除本插件。

有两件事不会自动搬过去，需要留意：

- **思考强度的结构变了。** 原来的字符串数组 `reasoningEfforts: [low, medium, high]` 变成"档位 → 线上拼写"的字典（`low: low, …`），原来的模型级 `defaultReasoningEffort` 变成原生的路由级 `reasoning:`。`dsh-model-fix` 会替你写成新结构；手工路径见迁移指引里的对照表。
- **API 密钥需要重新填一次。** 旧密钥存在凭据存储的 `newapi` 引用下；原生 provider 使用它自己的引用，且两个界面都不会回显密钥。

## 历史文档

以下文档描述的是插件当时的状态，保留供参考。它们在其所述版本上是准确的，但不再更新。

- [配置与排障](docs/configuration.md)：字段、模型匹配、代理与保存失败。
- [开发与 RC 发布](docs/development.md)：构建、测试覆盖与发布检查。
- [实现设计](DESIGN.md)：源码导航、数据流与实现决策。
- [0.2.0-rc.2 适配评估](docs/2026-10-01-dsh-0.2.0-rc.2-assessment.md)：本分支最后对齐的 seam 变更。
- [0.1.7-rc.1 适配评估](docs/2026-09-24-dsh-0.1.7-rc.1-assessment.md)：历史快照。
- [0.1.5-rc.1 适配评估](docs/2026-09-10-dsh-0.1.5-rc.1-assessment.md)：历史快照。

npm 上的包仍保持已发布、可安装状态，但不会再更新。已发布版本及其配套宿主见仓库历史。
