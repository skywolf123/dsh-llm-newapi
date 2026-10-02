# 从 dsh-llm-newapi 迁移

[返回 README](../README.zh-CN.md)

本项目已归档。dsh 0.2.0 起，宿主自带 **Custom Provider（自定义 Provider）** 功能，已覆盖本插件的绝大部分能力，且随宿主一起维护。本文件说明如何把现有配置迁移过去。

## 迁移到哪里

按你的需要三选一：

| 目标 | 适用情况 |
| --- | --- |
| **dsh 原生 Custom Provider**（dsh 0.2.0+） | 只想接一个网关、手写一次 YAML 即可。零额外依赖。**推荐作为基线。** |
| **dsh-model-fix**（第三方插件） | 希望在设置界面里自动补齐 `reasoningEfforts` / 容量 / 图片模态，并带动画化开关与备份。**推荐给不想手写参数的场景。** |
| 两者组合 | 用原生 Custom Provider 建 route，再用 dsh-model-fix 补参数。常见做法。 |

迁移到 dsh-model-fix 的安装与使用见 [dsh-model-fix](https://github.com/TikaFlow/dsh-model-fix)。下面主要讲与原生 Custom Provider 的字段对应，因为那是共同的地基。

## 前提：宿主版本

原生 Custom Provider（设置页里的「自定义模型 API」）需要 **dsh 0.2.0 及以上**。0.1.7 及更早宿主没有这个功能，只能继续使用 dsh-model-fix 等第三方插件，或停留在旧插件版本。

```sh
npm install -g @deepseek-ai/dsh@0.2.0-rc.2   # 或更新的 0.2.0 正式版
```

## 第一步：先固化当前配置

归档后本插件不再更新，但已安装的版本仍能运行。迁移前请先记录：

1. **网关地址**：设置页里的 `baseURL`（含 `/v1`），或在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 的 `llm-newapi` 行里找。
2. **模型列表**：每个模型的 `id`、`name`、`contextWindow`、`maxTokens`、`reasoningEfforts`、`defaultReasoningEffort`。
3. **API 密钥**：设置页里不再回显，迁移时需要在新的 provider 里重新填入一次（密钥存在 dsh credentials store，引用名为 `newapi`）。

`<profile>` 通常是 `web`。

## 第二步：在原生里新建一个自定义 provider

**设置 → 模型 → 添加模型提供方 → 自定义模型 API**，填写：

- **Provider ID**：小写字母开头，此后小写字母/数字/短横线（如 `newapi`）。此 ID 永久，请求、会话、模型默认值与凭据名都用它。
- **显示名称**：随便填。
- **Base URL**：原 `baseURL`。
- **API 协议**：选 **OpenAI Chat Completions**（对应 `openai-completions`）——本插件原先就是 chat-completions。
- **API Key**：重新填入。
- **模型**：可点「获取可用模型」从网关拉取，或手动添加。

原来由 `modelExcludePatterns` 过滤掉的 embedding / rerank 模型，原生不会自动过滤，拉取后需要自己取消勾选或不勾选。

保存后，provider 配置落在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 的 `llm-pi-ai.providers.<route>` 下。

## 第三步：字段对照

### 路由级

| dsh-llm-newapi (`llm-newapi`) | 原生 (`llm-pi-ai.providers.<route>`) | 说明 |
| --- | --- | --- |
| `baseURL` | `baseURL` | 同名 |
| —（固定 `newapi` route） | 由设置页选定的 route id | 原生每个 route 一个 provider，可配多个 |
| —（固定 chat-completions） | `api: openai-completions` | 手写 route 必须显式声明 |
| `streamIdleTimeoutMs` | `streamIdleTimeoutMs` | 同名 |
| `retryPolicy` | `retryPolicy` | 同宿主 schema |
| `defaultContextWindow` | `defaultContextWindow` | **默认值不同**：插件是 `128000`，原生是 `262144`。想保持原行为需显式写 `128000` |
| `maxTokens`（路由级全局输出上限） | — | **无等价物**。原生的路由级 `defaultMaxTokens` 只用于给模型定尺寸，不会变成每次请求的默认上限。要保留需写进每个模型的 `maxTokens` |
| `modelExcludePatterns` | — | 无等价物；原生拉取不过滤 |
| `proxy.*` | — | 无插件等价物；改用 dsh 宿主的环境代理（`HTTP_PROXY` 等） |
| `providerHints` | — | 无等价物 |

### 模型级

| dsh-llm-newapi (`models[]`) | 原生 (`models[]`) | 说明 |
| --- | --- | --- |
| `id` | `id` | 同名 |
| `name` | `name` | 同名 |
| `contextWindow` | `contextWindow` | 同名 |
| `maxTokens` | `maxTokens` | 同名 |
| `description` | — | 无等价物，丢弃 |
| `reasoningEfforts: [low, medium, high]`（字符串数组） | `reasoningEfforts: { low: low, medium: medium, high: high }`（字典） | **结构不同**：原生的 key 是档位，value 是**线上拼写**，可为该网关改名。只有 `off` 允许留空（发空值 = 不发送该参数） |
| `defaultReasoningEffort: medium` | 路由级 `reasoning: medium` | **粒度不同**：原生默认档是**路由级**的，不是模型级。同一 route 下多个模型若默认档不同，原生表达不了 |
| —（插件恒为 text-only） | `input: [text, image]` | 原生可选声明图片输入；这是能力提升 |

### 思考强度：迁移时最容易出错的地方

原插件的写法（数组）：

```yaml
models:
  - id: deepseek-v4-pro
    reasoningEfforts: [low, medium, high, max]
    defaultReasoningEffort: high
```

原生的等价写法（字典 + 路由级默认档）：

```yaml
providers:
  newapi:
    apiKeyEnv: NEWAPI_API_KEY
    api: openai-completions
    baseURL: https://your-gateway.example/v1
    reasoning: high                # 路由级默认档（原 defaultReasoningEffort）
    models:
      - id: deepseek-v4-pro
        reasoningEfforts:
          low: low
          medium: medium
          high: high
          max: max
```

几个要点：

- **只有 `off` 可以留空**：`off:` 表示"该档位可用，但不发送 reasoning 参数"。其余档位必须给线上值；`max: xhigh` 这种写法可以把档位名翻译成网关认的拼写。
- **不写 `off` 就等于强制思考**：如果字典里没有 `off`，模型选择器里就没有"关闭"这一档。
- **DeepSeek 系默认就思考的模型**，需要额外加 `compat.thinkingFormat: deepseek`，否则选 `off` 也停不下来：

  ```yaml
        models:
          - id: deepseek-v4-pro
            compat:
              thinkingFormat: deepseek
            reasoningEfforts:
              off:
              high: high
              max: max
  ```

- **网关闭关会拒绝 `developer` 角色**（很多 OpenAI 兼容网关的通病，症状是"只有推理模型报错"）时，加 `compat.supportsDeveloperRole: false`。dsh-model-fix 会自动写这一条。

原生的档位取值顺序为 `off / minimal / low / medium / high / xhigh / max`；未声明的档位一律视为不支持。

## 第四步：验证

1. 重启 dsh，进入 **设置 → 模型**，确认新 provider 出现在列表里。
2. 开一个新会话，在模型选择器里选 `newapi` 下的模型；声明过 `reasoningEfforts` 的模型应出现 **Effort** 菜单。
3. 选一个思考档位发一条消息，确认网关按预期响应。

## 第五步：清理旧插件

确认新路由可用后，移除旧插件并删除旧配置：

```sh
dsh plugin --profile web remove dsh-llm-newapi
```

然后从 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 删除 `llm-newapi` 那一行，并从 profile 的 `package.json` 的 `dsh.profile.bundles` 里去掉 `dsh-llm-newapi`。旧的 `newapi` 凭据引用可以保留，也可以在设置页里删除。

## 参数不会自动搬过去

原插件的 `reasoningEfforts` / `contextWindow` / `maxTokens` 不会被原生自动读取——原生只认 `llm-pi-ai` 命名空间下的字段。两种做法：

- **手动**：按上面的对照表逐条搬。
- **交给 dsh-model-fix**：装好插件后，在 **设置 → 模型 → 模型参数填充** 卡片里点「补全全部缺失」，它会按 models.dev 的数据自动补齐缺失字段。注意它也不读旧插件的配置，只是在 `llm-pi-ai` 里补齐。

## 相关链接

- 原生 Custom Provider 文档：[Configure models](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md)
- [dsh-model-fix](https://github.com/TikaFlow/dsh-model-fix)（推荐迁移目标）
- [dsh-model-extension](https://github.com/lovezi0/dsh-model-extension)
- [dsh-model-info-fill](https://github.com/11zld22/dsh-model-info-fill)
- [dsh-models-dev-reasoning](https://github.com/aerince/dsh-models-dev-reasoning)
