# dsh-llm-newapi

**English** | [中文](README.zh-CN.md)

Use your NewAPI gateway in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). The plugin adds a **NewAPI settings page** for credentials, model discovery and model parameters, plus streaming text and tool calls. It requires no changes to dsh.

## Choose a compatible version

**Install the host and plugin as a pair.** Status checked on October 1, 2026.

| dsh host | Plugin version line | npm channel | Status |
| --- | --- | --- | --- |
| `0.1.5-rc.3` | `0.1.5-rc.3-v0.3` | — | Published, that line is frozen |
| `0.1.7-rc.1` | `0.1.7-rc.1-v0.x` | `latest` | Published; rejected by this branch |
| **`0.2.0-rc.2`** | **`0.2.0-rc.2-v0.x`** | — | **This branch; not published yet — build it from this branch** |

On a host line only the last segment increments (`-v0.1` → `-v0.2` → …), so the promoted line is named as `v0.x`. Query the exact version each channel currently points at:

```sh
npm view dsh-llm-newapi dist-tags --json
```

### Version scheme

The plugin version follows the upstream host: `<dsh version>-v<plugin revision>`. Only the last segment is this plugin's own revision:

| Case | dsh version | Plugin version (npm) | Git tag / Release |
| --- | --- | --- | --- |
| Upstream RC | `0.2.0-rc.2` | `0.2.0-rc.2-v0.1` | `v0.2.0-rc.2-v0.1` |
| Later plugin change on the same host line | `0.2.0-rc.2` | `0.2.0-rc.2-v0.2` | `v0.2.0-rc.2-v0.2` |
| Upstream stable | `0.2.0` | `0.2.0-v0.1` | `v0.2.0-v0.1` |
| Host line changes (revision restarts) | `0.2.1-rc.1` | `0.2.1-rc.1-v0.1` | `v0.2.1-rc.1-v0.1` |

- npm forbids a leading `v` in the version field, so the package reads `0.2.0-rc.2-v0.1` while the Git tag and GitHub Release use `v0.2.0-rc.2-v0.1`.
- **Channel split**: npm `latest` points at the currently promoted host line (the 0.1.7 line today); `next` is reserved for other lines or future previews. Promoting or switching a line is a one-line change (`LATEST_LINE` in CI); a stable `0.2.0` tag (`v0.2.0-v0.x`) also lands on `latest`. This branch's 0.2.0 tag is not published, so neither channel carries it yet.
- The older **`0.8.x` series** (dsh `0.1.1-rc.2` / `0.1.2-rc.1` host lines) had its tags removed and is marked deprecated on npm.

### Compatibility and upgrades

Plugin `0.2.0-rc.2-v0.x` supports the **dsh `0.2.0` line** (minimum `0.2.0-rc.1`) and rejects the `0.1.7` and `0.1.5` hosts with an explicit upgrade message; `0.1.7-rc.1` users run `0.1.7-rc.1-v0.x` and `0.1.5-rc.3` users run `0.1.5-rc.3-v0.3`. Compatibility is keyed to the host line rather than one patch: a later `0.2.0-rc` cut is covered as long as its export surface matches — `npm run test:host` compares the installed surface against the checked-in one and fails loudly when it does not, instead of assuming. The 0.2.0 line also replaced the private `connection.register(owner, channel, handler)` workaround with the public `connection.rpc.handle(channel, handler)`, so this is not a pure dependency bump: see the [compatibility assessment (Chinese)](docs/2026-10-01-dsh-0.2.0-rc.2-assessment.md).

Both published lines are GitHub Pre-releases (the plugin has no stable release yet). The host and plugin use `latest` with different meanings, so do not assume they pair — pick a host line from the table and query `dist-tags` for the exact version.

## Install exact versions

You need Node.js, npm and pnpm. Repository CI uses Node.js 24. Install the host with npm, then install the plugin from the npm registry into dsh's `web` profile.

### This branch (dsh `0.2.0-rc.2`, not published)

This branch is not on npm. Build it from the repository and install the local path:

```sh
npm install -g @deepseek-ai/dsh@0.2.0-rc.2
npm install -g pnpm
npm ci && npm run build
dsh plugin --profile web add --save-exact "$(pwd)"
```

### Current published pair (dsh `0.1.7-rc.1`, npm `latest`)

The 0.1.7 line is what the published plugin serves; this branch rejects it.

```sh
npm install -g @deepseek-ai/dsh@0.1.7-rc.1
npm install -g pnpm
dsh plugin --profile web add --save-exact "dsh-llm-newapi@$(npm view dsh-llm-newapi dist-tags.latest)"
```

### Older host pair (dsh `0.1.5-rc.3`, that line is frozen)

```sh
npm install -g @deepseek-ai/dsh@0.1.5-rc.3
npm install -g pnpm
dsh plugin --profile web add --save-exact dsh-llm-newapi@0.1.5-rc.3-v0.3
```

Choose one pair. The published pair resolves the current version through `dist-tags`, so no version needs to be copied by hand; the 0.1.5 line is frozen at `0.1.5-rc.3-v0.3`. `--save-exact` records an exact plugin dependency so a later dependency update does not switch versions automatically. Use `dsh plugin` to manage the profile; installing `dsh-llm-newapi` globally by itself does not register it there.

### Check that the plugin is enabled

Open `$DSH_HOME/profiles/web/package.json`. With no `DSH_HOME` override, this is `.dsh/profiles/web/package.json` under your home directory.

Ensure `dsh.profile.bundles` contains `dsh-llm-newapi`. Recent dsh hosts register installed bundle plugins automatically. On an older host or an existing profile where the entry is missing, append it once and preserve the other entries. This is a JSON fragment to check, **not a replacement for the entire file**:

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
| Image input | The adapter currently declares text-only input |
| Model discovery | Queries `/models` and filters names containing `embed`, `rerank` or `ranker`; this is not a capability probe |
| Model parameters | Edit manually or match against models.dev; verify against your gateway |
| API key | Saved through settings, never echoed; a blank input preserves the stored key |
| Multiple gateways | One `newapi` route and one gateway configuration are currently supported |

## Upgrading and troubleshooting

Check the version table, stop dsh Web and back up your dsh configuration and session data before upgrading. Install the target host and exact plugin version, keep the existing bundle entry and restart. The plugin retains the `newapi` credential reference; configuration now persists through the profile's Cordis patch (see [configuration](docs/configuration.md)).

Host `0.1.7` migrates sessions from V3 to V4 (tool results become tool-role messages, message sources are renamed); older hosts cannot directly read migrated sessions. Reinstalling an older npm version alone is not a complete rollback. See the [upstream migration guide](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/session/session-format-v3-to-v4/README.md).

| Symptom | Check first |
| --- | --- |
| No NewAPI settings page | The `web` profile, bundle entry, host compatibility and whether Web was restarted |
| Startup fails with `requires dsh >= 0.2.0-rc.1` | This branch does not run on the `0.1.7` or `0.1.5` host lines. Upgrade the host: `npm install -g @deepseek-ai/dsh@0.2.0-rc.1` (or a newer `0.2.0` cut), or install the published plugin line that matches your host instead |
| Missing credential | Enter and save the key in NewAPI settings; the plugin does not read `NEWAPI_API_KEY` |
| Discovery fails | The `/v1` base URL, API key and gateway support for `/models` |
| Empty model list | Name-based filtering; manually add a model only if it supports chat-completions |
| models.dev download fails | Network and proxy settings; the plugin proxy applies to this download, while dsh also applies environment proxy settings through `dsh-http-proxy` |
| Missing-peer warnings during install | dsh supplies host packages. If installation and startup succeed, do not install duplicate host packages just to silence these warnings; investigate actual startup errors separately |

## Documentation

The detailed guides below are currently in Chinese:

- [Configuration and troubleshooting](docs/configuration.md): fields, model matching, proxies and save failures.
- [Development and RC releases](docs/development.md): builds, test coverage and release checks.
- [Design](DESIGN.md): source map, data flow and implementation decisions.
- [0.2.0-rc.2 assessment](docs/2026-10-01-dsh-0.2.0-rc.2-assessment.md): this branch's seam change, version inventory and verification.
- [0.1.7-rc.1 assessment](docs/2026-09-24-dsh-0.1.7-rc.1-assessment.md): historical snapshot (published line).
- [0.1.5-rc.1 assessment](docs/2026-09-10-dsh-0.1.5-rc.1-assessment.md): historical snapshot.

See [GitHub Releases](https://github.com/wenzetan/dsh-llm-newapi/releases) for published changes and downloadable packages.
