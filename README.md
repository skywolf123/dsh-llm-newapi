# dsh-llm-newapi

**English** | [中文](README.zh-CN.md)

Use your NewAPI gateway in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). The plugin adds a **NewAPI settings page** for credentials, model discovery and model parameters, plus streaming text and tool calls. It requires no changes to dsh.

## Choose a compatible version

**Install the host and plugin as a pair.** Status checked on September 24, 2026.

| dsh host | Plugin | Status |
| --- | --- | --- |
| `0.1.1-rc.2` | `0.8.4` | Published; plugin npm `latest` |
| `0.1.2-rc.1` | `0.8.6-rc.1` | Published; the last release for that host line |
| `0.1.5-rc.1`, `0.1.5-rc.2` | `0.8.6-rc.3` | Published (npm `next`); the last release for that host line |
| **`0.1.7-rc.1`** | **`0.8.6-rc.3` + this branch** | **Unpublished**: the repository development branch targets the 0.1.7 line, pending a PR and a new RC |

This branch (`adapt-dsh-0.1.7-rc.1`) moves the plugin to the **dsh `0.1.7` line only**. Host `0.1.7` removed the old `settings.installSection` seam in favour of "declare Config fields `.volatile()`, read the references directly, react to `loader/volatile-update`", and one code base cannot serve both. Hosts on `0.1.5` or earlier are rejected with an explicit upgrade message.

The published npm `0.8.6-rc.3` and this branch therefore target different hosts: **the published `0.8.6-rc.3` serves the `0.1.5` line; this branch's source serves the `0.1.7` line.** Until the upstream project cuts a new RC, `0.1.7-rc.1` users should build from this branch. See the [0.1.7 assessment (Chinese)](docs/2026-09-24-dsh-0.1.7-rc.1-assessment.md).

Releases stay on the **pre-release channel**: npm `next` and a GitHub Pre-release. Nothing here promotes a stable version or moves the plugin's `latest` tag, which stays on `0.8.4`. The host and plugin have separate release channels; their respective `latest` versions are not necessarily compatible.

## Install exact versions

You need Node.js, npm and pnpm. Repository CI uses Node.js 24. Install the host with npm, then install the plugin from the npm registry into dsh's `web` profile.

### Published RC pair (dsh `0.1.2-rc.1`)

```sh
npm install -g @deepseek-ai/dsh@0.1.2-rc.1
npm install -g pnpm
dsh plugin --profile web add --save-exact dsh-llm-newapi@0.8.6-rc.1
```

### Pair for the older host

```sh
npm install -g @deepseek-ai/dsh@0.1.1-rc.2
npm install -g pnpm
dsh plugin --profile web add --save-exact dsh-llm-newapi@0.8.4
```

Choose one pair. `--save-exact` records an exact plugin dependency so a later dependency update does not switch versions automatically. Use `dsh plugin` to manage the profile; installing `dsh-llm-newapi` globally by itself does not register it there.

### Published 0.1.5 pair

```sh
npm view dsh-llm-newapi@0.8.6-rc.3 version
npm install -g @deepseek-ai/dsh@0.1.5-rc.2
npm install -g pnpm
dsh plugin --profile web add --save-exact dsh-llm-newapi@0.8.6-rc.3
```

### dsh `0.1.7-rc.1` (this branch, not yet on npm)

The published `0.8.6-rc.3` tarball targets the `0.1.5` line and is refused at load time by this branch's host-line guard. Until the upstream project cuts a new RC, build from this branch:

```sh
git clone https://github.com/skywolf123/dsh-llm-newapi
cd dsh-llm-newapi
git checkout adapt-dsh-0.1.7-rc.1
npm install && npm run build
npm install -g @deepseek-ai/dsh@0.1.7-rc.1
npm install -g pnpm
dsh plugin --profile web add "$(pwd)"
```

Once a new RC is published, replace the last line with `--save-exact dsh-llm-newapi@<version>`.

### Check that the plugin is enabled

Open `$DSH_HOME/profiles/web/package.json`. With no `DSH_HOME` override, this is `.dsh/profiles/web/package.json` under your home directory.

Ensure `dsh.profile.bundles` contains `dsh-llm-newapi`. Host `0.1.5` and later register installed bundle plugins automatically. On an older host or an existing profile where the entry is missing, append it once and preserve the other entries. This is a JSON fragment to check, **not a replacement for the entire file**:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-llm-newapi"
      ]
    }
  }
}
```

Check the installed versions, then restart dsh Web:

```sh
dsh --version
dsh plugin --profile web list dsh-llm-newapi
dsh web
```

## First use

1. Open **NewAPI** in dsh Web settings.
2. Enter your gateway URL, such as `https://your-gateway.example/v1`, and API key. Include `/v1`; do not enter the full `/chat/completions` path.
3. Click **Fetch models**, select the models you need and add the selected entries.
4. Optionally fetch model information from models.dev. Review context limits, output limits and reasoning efforts before applying values.
5. Click **Save**, then choose a model under the `newapi` provider in the conversation model picker.

Model discovery queries your gateway for available models. models.dev is a public parameter catalog; a match does not establish that your gateway supports a model or feature. Save after applying catalog values.

## Capabilities and limits

| Feature | Behavior |
| --- | --- |
| Text, reasoning content and tool calls | Streaming supported; an explicit reasoning effort is sent as `reasoning_effort` |
| Session V4 tool changes | Developer-role history and `tool-addition`/`tool-removal` blocks are refused with `UNSUPPORTED_CONTENT`: the OpenAI-compatible wire cannot carry them, and dropping them silently would desync the model's tool set |
| Deferred tool loading | `ToolSchema.deferLoading` is refused with `UNSUPPORTED_CONTENT`; a chat-completions gateway cannot honour deferred materialisation |
| Image input | The adapter currently declares text-only input |
| Model discovery | Queries `/models` and filters names containing `embed`, `rerank` or `ranker`; this is not a capability probe |
| Model parameters | Edit manually or match against models.dev; verify against your gateway |
| API key | Saved through settings, never echoed; a blank input preserves the stored key |
| Multiple gateways | One `newapi` route and one gateway configuration are currently supported |

## Upgrading and troubleshooting

Check the version table, stop dsh Web and back up your dsh configuration and session data before upgrading. Install the target host and exact plugin version, keep the existing bundle entry and restart. The plugin retains the `llm-newapi` settings namespace and `newapi` credential reference.

Host `0.1.5` migrated session data to V3 and `0.1.7` moves it to V4; older hosts cannot directly read migrated sessions. Reinstalling an older npm version alone is not a complete rollback. See the [upstream V3→V4 migration guide](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/session/session-format-v3-to-v4/README.md).

| Symptom | Check first |
| --- | --- |
| No NewAPI settings page | The `web` profile, bundle entry, host compatibility and whether Web was restarted |
| Startup refuses the host (`requires dsh >= 0.1.7-rc.1`) | The host predates this branch's supported line; install the published `0.8.6-rc.3` (for `0.1.5`) or upgrade the host |
| Missing credential | Enter and save the key in NewAPI settings; the plugin does not read `NEWAPI_API_KEY` |
| Discovery fails | The `/v1` base URL, API key and gateway support for `/models` |
| Empty model list | Name-based filtering; manually add a model only if it supports chat-completions |
| models.dev download fails | Network and proxy settings; the plugin proxy applies to this download, while host `0.1.7` also applies environment proxy settings |
| Missing-peer warnings during install | dsh supplies host packages. If installation and startup succeed, do not install duplicate host packages just to silence these warnings; investigate actual startup errors separately |

## Documentation

The detailed guides below are currently in Chinese:

- [Configuration and troubleshooting](docs/configuration.md): fields, model matching, proxies and save failures.
- [Development and RC releases](docs/development.md): builds, test coverage and release checks.
- [Design](DESIGN.md): source map, data flow and implementation decisions.
- [0.1.7-rc.1 assessment](docs/2026-09-24-dsh-0.1.7-rc.1-assessment.md): seam changes, verification scope and this branch's release status.
- [0.1.5-rc.1 assessment](docs/2026-09-10-dsh-0.1.5-rc.1-assessment.md): the previous adaptation round, kept as history.

See [GitHub Releases](https://github.com/wenzetan/dsh-llm-newapi/releases) for published changes and downloadable packages.
