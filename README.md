# dsh-llm-newapi

**English** | [中文](README.zh-CN.md)

> **This project is archived and no longer maintained.**
>
> dsh 0.2.0 ships a native **Custom Provider** feature that covers what this plugin did, and third-party plugins now fill the remaining gap on top of it. New users should not install this plugin. Existing users should migrate — see [Migration](#migration) below.

## Why this project is archived

When this plugin was written, DeepSeek Harness had no way to point the model layer at an arbitrary OpenAI-compatible gateway: you needed a plugin that registered its own provider route, discovered models over `/models`, and shipped a settings page. That is what `dsh-llm-newapi` did for NewAPI gateways.

That gap has closed. dsh 0.2.0 added the native **Custom Provider** feature (**Settings → Models → Add model provider → Custom model API**), which lets you declare a provider — endpoint, API protocol, credential, and models — without installing anything. For the NewAPI use case it now covers, and in most respects exceeds, what this plugin offered:

| Capability | dsh-llm-newapi | Native Custom Provider (dsh 0.2.0) |
| --- | --- | --- |
| Custom gateway endpoint + API key | Yes | Yes |
| Model discovery via `/models` | Yes, filtering `embed`/`rerank`/`ranker` | Yes, unfiltered |
| Multiple gateways | No — one fixed `newapi` route | Yes, one route per provider |
| Wire protocols | Chat Completions only | Chat Completions, Responses, Anthropic Messages |
| Image input | No — declares text-only | Yes, per model |
| Reasoning effort | Yes | Yes, with wire-value mapping and DeepSeek `thinkingFormat` |
| Request compatibility switches | No | Yes (`compat.*`) |
| models.dev parameter auto-fill | Yes | No |

Two things this plugin offered have no direct native equivalent: **automatic model-parameter fill from models.dev**, and a **review-and-confirm step before parameters are written**. Both are now provided by third-party plugins that patch the native Custom Provider rather than replacing it — which is a far better place for them, because they follow the host's release cadence instead of pinning to a pre-1.0 adapter seam.

Rather than keep maintaining a parallel adapter against a moving seam, this repository is archived in favor of the native feature plus the plugins below.

## Alternatives

All four are plugins that fill in native Custom Provider profiles — they write into the `llm-pi-ai` settings namespace and let the native adapter do the talking. None of them replaces dsh.

### [dsh-model-fix](https://github.com/TikaFlow/dsh-model-fix) — recommended

The most complete and the most actively maintained of the four.

- Auto-fills `reasoningEfforts`, `contextWindow`, `maxTokens`, and `input` (image modalities) from [models.dev](https://models.dev), for custom provider models only.
- Ships an **offline cache**, so it works without network at startup and refreshes in the background.
- Also writes `compat.supportsDeveloperRole: false` on `openai-completions` routes — the fix for the common "only reasoning models fail" gateway rejection.
- Settings card with draft/edit/save, **force update**, **restore backup**, and a **provider exclusion list**; dangerous writes are behind a confirmation dialog.
- Remembers the reasoning level per model and restores it when you switch models; optional "default to `high`".
- Supports dsh `0.1.2-rc.1` through `0.2.0-rc.2`, with a substantial test suite.

```sh
dsh plugin --profile web add https://github.com/TikaFlow/dsh-model-fix/releases/latest/download/dsh-model-fix.tgz
```

### [dsh-model-extension](https://github.com/lovezi0/dsh-model-extension)

The most aggressive option: it **replaces** the official Models page with its own "Models+" page, where `reasoningEfforts`, `input`, and `compat` are editable per model in a form, plus models.dev prefill.

- Use it if you want a UI for the fields the native page deliberately leaves to YAML.
- Trade-off: it disables the official `ui-settings-models` entry via a bundle patch. If a future dsh release renames that entry, the patch silently stops matching and the official page returns — it needs re-checking against adapter-anchor bumps. It also removes the official onboarding components that live in that package.

### [dsh-model-info-fill](https://github.com/11zld22/dsh-model-info-fill)

A middle ground: fills `contextWindow`, `maxTokens`, `reasoningEfforts`, and `input` from models.dev, with configurable defaults for models the catalog does not match, and a "default effort" option (which covers the native per-route `reasoning` gap).

- Smaller and simpler than the two above; interfaces with both the dsh 0.1.6 and 0.1.7 settings surfaces.
- Verify 0.2.0 support yourself before relying on it — its README still targets 0.1.6/0.1.7.

### [dsh-models-dev-reasoning](https://github.com/aerince/dsh-models-dev-reasoning)

The most minimal: a single zero-build `index.js` that writes only `reasoningEfforts` for models that do not already declare it. No UI, no configuration.

- Use it if reasoning levels are the only thing you want filled in and you do not want a settings card.
- Last updated 2026-08-15; the least maintained of the four.

### Comparison

| | dsh-model-fix | dsh-model-extension | dsh-model-info-fill | dsh-models-dev-reasoning |
| --- | --- | --- | --- | --- |
| Reasoning efforts | Yes | Yes | Yes | Yes |
| Context / max tokens | Yes | Yes | Yes | No |
| Image modalities | Yes | Yes | Yes | No |
| `compat` switches | Yes | Yes | No | No |
| Settings UI | Yes | Yes | Yes | No |
| User confirmation | Draft + save, backup/restore | Per-row form + save | Toggle + button | None (silent) |
| Data source | models.dev + offline cache | `models.json` (download yourself) | models.dev | models.dev, GitHub fallback |
| Official Models page | Kept | **Replaced** | Kept | Kept |
| dsh support | 0.1.2-rc.1 – 0.2.0-rc.2 | 0.1.7 – 0.2.0 | 0.1.6 / 0.1.7 | Not stated |

## Migration

**Recommendation: migrate to the native Custom Provider, and add [dsh-model-fix](https://github.com/TikaFlow/dsh-model-fix) if you relied on the models.dev parameter fill.**

- **Full guide: [Migrating from dsh-llm-newapi](docs/migrating-from-dsh-llm-newapi.md)** — field-by-field mapping (`llm-newapi` → `llm-pi-ai`), the reasoning-effort structure change, and validation steps.
- Native Custom Provider reference: [Configure models](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md).

The short version:

1. Upgrading to dsh 0.2.0+ gives you the native feature; no plugin needed for the gateway itself.
2. Create a custom provider with your base URL, `openai-completions` protocol, key, and models.
3. Map the old fields by hand — or install `dsh-model-fix` and let it fill the parameters.
4. Remove this plugin once the new route works.

Two things that do not carry over automatically and need attention:

- **Reasoning efforts change shape.** The old string array `reasoningEfforts: [low, medium, high]` becomes a mapping whose values are wire spellings (`low: low, …`), and the old model-level `defaultReasoningEffort` becomes the native route-level `reasoning:`. `dsh-model-fix` writes the new shape for you; the mapping table in the migration guide covers the manual path.
- **Your API key must be re-entered.** The old key lived in the credentials store under the `newapi` reference; the native provider uses its own reference, and the key is never echoed back by either page.

## Historical documentation

The documents below describe the plugin as it was, and are kept for reference. They are accurate as of the versions they name and are no longer updated.

- [Configuration and troubleshooting](docs/configuration.md): fields, model matching, proxies and save failures.
- [Development and RC releases](docs/development.md): builds, test coverage and release checks.
- [Design](DESIGN.md): source map, data flow and implementation decisions.
- [0.2.0-rc.2 assessment](docs/2026-10-01-dsh-0.2.0-rc.2-assessment.md): the last seam change this branch targeted.
- [0.1.7-rc.1 assessment](docs/2026-09-24-dsh-0.1.7-rc.1-assessment.md): historical snapshot.
- [0.1.5-rc.1 assessment](docs/2026-09-10-dsh-0.1.5-rc.1-assessment.md): historical snapshot.

The npm packages remain published and installable; they will not receive further updates. Published versions and their host pairings are recorded in the repository history.
