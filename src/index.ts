/**
 * Register a {@link NewApiAdapter} for the `newapi` provider route on
 * `ctx.llm`, with connection facts resolved per request: the plugin layers
 * its profile entry config under `fiber.entry.options.config` (the dsh 0.1.7
 * settings seam — `ctx.settings` now projects forms off `Config` directly, no
 * `installSection` and no `setSource`/`validate`/`onChange` callbacks) and
 * resolves the API key through the credential seam (`ctx.credentials`), so a
 * changed base URL, catalog, or key reaches the very next request without
 * restarting anything while an in-flight stream keeps the facts it started
 * with. The one registration-captured fact — the retry policy — re-registers
 * the route in place when it changes; the listener hooks `loader/volatile-update`
 * so the in-place swap survives a volatile-only edit. A candidate section
 * that fails serviceability is refused at the write boundary by the
 * `internal/config` waterfall hook (mirroring `llm-pi-ai`'s `assertServiceable`).
 * @module dsh-llm-newapi
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { assertUsableApiKey, LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import llmManifest from '@deepseek-ai/dsh-llm/package.json' with { type: 'json' }
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
// Type-only: pulls the cordis `Context` merge that adds the `settings`
// service (`SettingsForms`) and the `loader/volatile-update` event into this
// program.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODEL_EXCLUDE_PATTERNS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  NewApiAdapter,
  normalizeBaseUrl,
  PKG,
} from './adapter.ts'
import type { NewApiCatalogModel, NewApiConnectionOptions } from './adapter.ts'
import type { ModelsDevParamsRequest, ProviderHints } from './types.ts'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODEL_EXCLUDE_PATTERNS,
  DEFAULT_PROVIDER_HINTS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  matchModelsDev,
  modelNameFromId,
  NewApiAdapter,
  normalizeBaseUrl,
  PKG,
} from './adapter.ts'
export { serializeRequest } from './serialize.ts'
export type { NewApiAdapterOptions, NewApiCatalogModel, NewApiConnectionOptions } from './adapter.ts'
export type * from './types.ts'

const MINIMUM_DSH_VERSION = '0.1.7-rc.1'

type SemverIdentifier = number | string
interface ParsedSemver {
  core: [number, number, number]
  prerelease?: SemverIdentifier[]
}

function parseSemver(version: string): ParsedSemver | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(version)
  if (match === null) return undefined
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  const prerelease = match[4]?.split('.').map(part => /^\d+$/u.test(part) ? Number(part) : part)
  return prerelease === undefined ? { core: [major, minor, patch] } : { core: [major, minor, patch], prerelease }
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  const [leftMajor, leftMinor, leftPatch] = left.core
  const [rightMajor, rightMinor, rightPatch] = right.core
  for (const difference of [leftMajor - rightMajor, leftMinor - rightMinor, leftPatch - rightPatch]) {
    if (difference !== 0) return difference
  }
  if (left.prerelease === undefined) return right.prerelease === undefined ? 0 : 1
  if (right.prerelease === undefined) return -1
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined) return rightPart === undefined ? 0 : -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    if (typeof leftPart === 'number' && typeof rightPart === 'number') return leftPart - rightPart
    if (typeof leftPart === 'number') return -1
    if (typeof rightPart === 'number') return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

function isSupportedHostVersion(version: string): boolean {
  const actual = parseSemver(version)
  const minimum = parseSemver(MINIMUM_DSH_VERSION)
  return actual !== undefined && minimum !== undefined && compareSemver(actual, minimum) >= 0
}

const hostLlmVersion = typeof llmManifest.version === 'string' ? llmManifest.version : 'unknown'
if (!isSupportedHostVersion(hostLlmVersion)) {
  throw new Error(
    `dsh-llm-newapi requires dsh >= ${MINIMUM_DSH_VERSION} ` +
    `(host ships @deepseek-ai/dsh-llm ${hostLlmVersion}); ` +
    `upgrade the host: npm install -g @deepseek-ai/dsh@${MINIMUM_DSH_VERSION}`,
  )
}

/** Compare JSON-compatible values structurally without requiring a new host package. */
function deepEqualJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((entry, index) => deepEqualJson(entry, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  if (keys.length !== Object.keys(rightRecord).length) return false
  return keys.every(key => key in rightRecord && deepEqualJson(leftRecord[key], rightRecord[key]))
}

export const name = 'llm-newapi'
export const inject = ['llm']

const NS = 'llm-newapi'
/**
 * Fixed credential reference for the gateway API key. Deliberately not an
 * environment-variable-style name: the inherited process environment is the
 * credentials service's read-only top layer, so an `NEWAPI_API_KEY`-style
 * ref would let a stray exported variable shadow the web-stored key and lock
 * the settings input read-only. `newapi` names the route, and the web
 * settings page is the one configuration surface for the value.
 */
const API_KEY_REF = 'newapi'
/** Environment variable naming this provider's endpoint, honored only from trusted layers. */
const BASE_URL_ENV = 'NEWAPI_BASE_URL'
/** Placeholder gateway base used when neither config nor environment names one. */
export const DEFAULT_BASE_URL = 'https://newapi.example.com/v1'
/** The single provider route this plugin owns. */
const PROVIDER = 'newapi'

/**
 * Volatile field protocol key from `@deepseek-ai/cosmokit`. `Symbol.for`
 * makes it stable across ESM/CJS copies, so the predicate identifies
 * references without depending on cosmokit at runtime — the entry must still
 * load against the previously supported dsh line without resolving any package
 * that host version did not install.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the live `llm-newapi` settings-section shape on the dsh 0.1.7 line.
 * Every field is marked `.volatile()` so the form projects every editable
 * field, the loader writes them through the profile patch, and the plugin
 * reads the current value through {@link Volatile} references — the references
 * are committed in place by the loader on `loader/volatile-update`. Every
 * field is optional in yml: `baseURL` falls back to $NEWAPI_BASE_URL from a
 * trusted environment layer, then the placeholder {@link DEFAULT_BASE_URL} —
 * a request against the placeholder fails as TRANSPORT at first use, naming
 * the endpoint to fix. The API key is not a config value at all: it lives in
 * the credentials store under the fixed reference `newapi` (the web settings
 * page writes it), and a request without any stored key fails with
 * `MISSING_CREDENTIAL`, not at plugin load.
 */
export interface Config {
  /** Gateway base including the `/v1` prefix; defaults to $NEWAPI_BASE_URL from a trusted layer, then the placeholder `https://newapi.example.com/v1`. */
  baseURL: Volatile<string | undefined>
  /** Advisory models shown by discovery consumers; defaults to none — a gateway's model set is deployment-specific. */
  models: Volatile<NewApiCatalogModel[]>
  /**
   * Case-insensitive id substrings excluding discovered models that cannot
   * serve chat completions (embedding, rerank, ranker families). Replaces the
   * default {@link DEFAULT_MODEL_EXCLUDE_PATTERNS} list; an empty array
   * disables filtering. The hand-curated {@link models} catalog is unaffected.
   */
  modelExcludePatterns: Volatile<string[]>
  /** Positive context capacity used when the selected model has no exact value (default 128,000). */
  defaultContextWindow: Volatile<number>
  /** Default per-request output cap; omission sends no cap and lets each upstream default apply. */
  maxTokens: Volatile<number | undefined>
  /** Maximum gateway idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs: Volatile<number>
  /**
   * Forward proxy for the models.dev catalog download performed by the
   *「更新模型信息」action: disabled by default; when enabled, that one
   * request is routed through `proxy.url` (a plain HTTP forward proxy).
   * Gateway traffic is untouched.
   */
  proxy: Volatile<ProxyConfig>
  /**
   * Match-shaping hints for the models.dev params lookup: family prefixes
   * and exact ids name which catalog provider counts as official (leading
   * match, flagged). Built-in families (glm→zai, gpt→openai, claude→
   * anthropic, …) apply first; these entries override and extend them.
   */
  providerHints: Volatile<ProviderHints>
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy: Volatile<RetryPolicyConfig | undefined>
}

/** Forward-proxy settings for the models.dev catalog download. */
export interface ProxyConfig {
  /** Whether the proxy is used; defaults to false. */
  enabled?: boolean
  /** Proxy URL; presets default to `http://127.0.0.1:7890`. */
  url?: string
}

/**
 * Plain options the resolver consumes. Volatile refs (or a programmatically
 * built plain object that bypassed the schema) are unwrapped through
 * {@link plainOptions}; the resolver never sees a `Volatile` wrapper.
 */
export type Options = {
  [K in keyof Config]?: Config[K] extends Volatile<infer T> ? Exclude<T, undefined> : never
}

/**
 * Unwrap every {@link Volatile} reference on a parsed Config. Tolerates
 * programmatically constructed plain objects (tests, programmatic callers)
 * by falling back to the raw value when the volatile write key is absent.
 */
export function plainOptions(config: Config): Options {
  const read = (value: unknown): unknown => typeof value === 'object' && value !== null && VOLATILE_WRITE in value
    ? (value as unknown as Volatile<unknown>).get()
    : value
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) out[key] = read(value)
  return out as Options
}

const catalogModel: z<NewApiCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  reasoningEfforts: z.array(z.string()),
  defaultReasoningEffort: z.string(),
})

/** Default forward proxy: the conventional Clash port on loopback. */
export const DEFAULT_PROXY_URL = 'http://127.0.0.1:7890'

const proxySchema: z<ProxyConfig> = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(DEFAULT_PROXY_URL),
})

/**
 * Schema-backed plugin Config. Every field is `.volatile()` so the dsh
 * 0.1.7 settings form projects every editable field; the loader writes
 * them through the profile patch and commits new values into the running
 * `Volatile` references in place. Required fields use `.required()` so the
 * output type is `Volatile<T>` (mode `volatile-defined`); optional fields
 * produce `Volatile<T | undefined>` (mode `volatile`) and are allowed to
 * default or be omitted.
 */
export const Config = z.object({
  baseURL: z.string().volatile(),
  models: z.array(catalogModel).default([]).volatile(),
  modelExcludePatterns: z.array(z.string()).default([...DEFAULT_MODEL_EXCLUDE_PATTERNS]).volatile(),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).volatile(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).volatile(),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS).volatile(),
  proxy: proxySchema.default({ enabled: false, url: DEFAULT_PROXY_URL }).volatile(),
  providerHints: z.object({
    defaults: z.object({}),
    models: z.object({}),
  }).volatile(),
  retryPolicy: RetryPolicySchema.volatile(),
})

/**
 * One resolution's complete request facts. Connection and credential facts
 * are one value on purpose: a snapshot the resolver rejects keeps the whole
 * previous generation, so a request can never pair a stale endpoint with a
 * newer key.
 */
export type ResolvedNewApiOptions = NewApiConnectionOptions

/** Resolve, validate, and detach the advisory model catalog. */
function resolveModels(models: readonly NewApiCatalogModel[] | undefined): NewApiCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? []).map((model) => {
    if (model.id.length === 0) throw new Error(`${PKG}: catalog model ids must be non-empty`)
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`${PKG}: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    if (seen.has(model.id)) throw new Error(`${PKG}: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    for (const effort of model.reasoningEfforts ?? []) {
      if (effort.length === 0) throw new Error(`${PKG}: catalog model "${model.id}" has an empty reasoning effort`)
    }
    if (model.defaultReasoningEffort !== undefined
      && !(model.reasoningEfforts ?? []).includes(model.defaultReasoningEffort)) {
      throw new Error(
        `${PKG}: catalog model "${model.id}" default reasoning effort "${model.defaultReasoningEffort}" is not among its reasoning efforts`,
      )
    }
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      ...model.reasoningEfforts === undefined || model.reasoningEfforts.length === 0 ? {} : { reasoningEfforts: model.reasoningEfforts },
      ...model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort },
    }
  })
}

/**
 * The one explicit resolve step from raw options to validated connection
 * facts. Programmatic construction may bypass Schemastery normalization, so
 * every default and bound is re-judged here — for the composition entry at
 * load (fail loud) and for each settings snapshot at its first use.
 * @param options - plain plugin options or resolved settings snapshot.
 * @param environment - this run's environment layers, or `undefined` outside
 * the product CLI. A trusted layer may supply the gateway endpoint.
 * @returns validated connection facts plus the credential reference.
 */
export function resolveAdapterOptions(options: Options, environment?: ReturnType<typeof launchEnvironmentOf>): ResolvedNewApiOptions {
  // Absent everywhere is the placeholder, not a load failure: the plugin stays
  // mountable so configuration surfaces can offer the route, and a request
  // against the placeholder fails as TRANSPORT at first use, naming the
  // endpoint to fix. A value someone actually typed must still be a usable
  // http(s) URL, which normalizeBaseUrl enforces below.
  const named = options.baseURL !== undefined && options.baseURL.trim().length > 0
    ? options.baseURL
    : environment?.get(BASE_URL_ENV)?.value
  const rawBase = named !== undefined && named.trim().length > 0 ? named : DEFAULT_BASE_URL
  const modelExcludePatterns = options.modelExcludePatterns ?? [...DEFAULT_MODEL_EXCLUDE_PATTERNS]
  for (const pattern of modelExcludePatterns) {
    if (pattern.length === 0) throw new Error(`${PKG}: modelExcludePatterns entries must be non-empty`)
  }
  if (options.defaultContextWindow !== undefined
    && (!Number.isInteger(options.defaultContextWindow) || options.defaultContextWindow <= 0)) {
    throw new Error(`${PKG}: defaultContextWindow must be a positive integer`)
  }
  if (options.maxTokens !== undefined
    && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0)) {
    throw new Error(`${PKG}: maxTokens must be a positive safe integer`)
  }
  const streamIdleTimeoutMs = options.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `${PKG}: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const defaultContextWindow = options.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  const proxyEnabled = options.proxy?.enabled === true
  const proxyUrlRaw = options.proxy?.url ?? DEFAULT_PROXY_URL
  if (proxyEnabled) {
    // Only judged while enabled: a stored disabled proxy with a stale URL
    // must not fail the whole section.
    try { new URL(proxyUrlRaw) } catch {
      throw new Error(`${PKG}: proxy.url must be an absolute URL (got: ${proxyUrlRaw})`)
    }
    if (!/^https?:$/.test(new URL(proxyUrlRaw).protocol)) {
      throw new Error(`${PKG}: proxy.url must be an http(s) URL (got: ${proxyUrlRaw})`)
    }
  }
  return {
    baseURL: normalizeBaseUrl(rawBase),
    apiKeyRef: credentialRef(API_KEY_REF),
    models: resolveModels(options.models),
    modelExcludePatterns,
    defaultContextWindow,
    streamIdleTimeoutMs,
    ...proxyEnabled ? { proxyUrl: proxyUrlRaw } : {},
    providerHints: {
      defaults: { ...options.providerHints?.defaults },
      models: { ...options.providerHints?.models },
    },
    retryPolicy: resolveRetryPolicy(options.retryPolicy, `${PKG}: retryPolicy`),
    ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
  }
}

export function apply(ctx: Context, config: Config): void {
  // The settings seam on the 0.1.7 line is auto-generated from the plugin's
  // own `Config` schema with `.volatile()` markers; installSection no longer
  // exists. `ctx.inject(['settings'], child => child.settings.configure({auto:false}, ctx.fiber))`
  // declares the per-fiber presentation policy — since the plugin ships its
  // own settings page in the browser half (NewApiSection), the shell skips
  // auto-generation of a duplicate form. The `ctx.inject` is conditional:
  // a host composition without the settings service (test harnesses, headless
  // boot) leaves the plugin without a settings page, and the adapter keeps
  // serving requests with whatever the composition entry provided.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  // The settings namespace is now keyed by the profile entry id rather than
  // an arbitrary "llm-newapi" settings section name: `SettingsForms.describe`
  // walks `configEditor.configuration()` and projects each entry's
  // `fiber.runtime.Config`. Fall back to the literal when the fiber carries no
  // entry (a hand-built composition without Loader), matching upstream
  // plugins (`llm-pi-ai`, `llm-deepseek`).
  const settingsNs = ctx.fiber.entry?.options.id ?? NS

  // Each request resolves fresh from the live Volatile references: the loader
  // commits new values into the running refs in place, so an updated section
  // reaches the next request without remounting the adapter. The internal/config
  // waterfall (registered below) refuses unserviceable writes at the profile
  // patch boundary, so the running refs are always serviceable — keep that
  // promise simple here and re-validate on every resolve.
  const options = (): ResolvedNewApiOptions => resolveAdapterOptions(
    plainOptions(config),
    launchEnvironmentOf(ctx),
  )
  options()

  // Refuse an unserviceable section where it is written. The dsh 0.1.7 write
  // path calls `fiber.ctx.waterfall(fiber, 'internal/config', next, ...)`
  // before `configEditor.edit` persists the patch, so a throw here refuses
  // the edit cleanly. Mirrors `llm-pi-ai`'s `assertServiceable` shape:
  // re-validate the candidate, propagate back to upstream, return the raw.
  ctx.on('internal/config', function (this: Fiber, _raw, next) {
    const raw = next() as unknown
    if (this !== ctx.fiber) return raw
    // The schema is a StandardSchema: it validates arbitrary input and
    // returns the typed Config with Volatile refs. `resolveAdapterOptions`
    // then re-judges the across-field bounds the schema cannot express.
    resolveAdapterOptions(
      plainOptions(Config(raw as Parameters<typeof Config>[0]) as Config),
      launchEnvironmentOf(ctx),
    )
    return raw
  })

  const resolveApiKey = async (connection: ResolvedNewApiOptions): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    // The credentials store is the only source: the web settings page owns
    // the value, and this plugin deliberately reads no environment variable
    // for it (a stray export must not shadow a web-configured key).
    const ref = connection.apiKeyRef
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, PKG, ref)
    }
    throw new LlmError(
      `${PKG}: no API key for provider route "${PROVIDER}"; configure it on the NewAPI`
        + ` settings page in dsh web (credentials reference "${ref}")`,
      'MISSING_CREDENTIAL',
    )
  }

  // Official-vendor index for the models.dev params panel: model id → the
  // provider route that serves it officially, read from every OTHER route
  // registered on ctx.llm (the built-in catalogs are the authority — e.g.
  // deepseek-v4-flash under the deepseek route). Rebuilt when the set of
  // routes changes; a route that fails to list models is no authority.
  let indexCache: { routes: string; byModel: Map<string, string> } | undefined
  const officialProviderOf = async (modelId: string): Promise<string | undefined> => {
    const routes = ctx.llm.listProviders().map(provider => provider.id).sort().join(',')
    if (indexCache === undefined || indexCache.routes !== routes) {
      const byModel = new Map<string, string>()
      for (const provider of ctx.llm.listProviders()) {
        if (provider.id === PROVIDER) continue
        try {
          for (const model of await ctx.llm.listModels(provider.id)) {
            byModel.set(model.id, provider.id)
          }
        } catch {
          // An unlistable route contributes nothing; other routes still can.
        }
      }
      indexCache = { routes, byModel }
    }
    return indexCache.byModel.get(modelId)
  }

  const adapter = new NewApiAdapter({ options, resolveApiKey, officialProviderOf })
  ctx.llm.registerConfigurableProviders([
    {
      provider: PROVIDER,
      displayName: 'NewAPI',
      // The dsh 0.1.7 models page joins configurable-provider directory entries
      // with settings namespaces by `settingsNs`. Use the profile entry id so
      // the join works whether the entry id is `llm-newapi` (the default) or
      // a renamed one.
      settingsNs,
      settingsPath: [],
      // The adapter knows this route only because configuration declared it:
      // a self-hosted gateway it ships nothing about.
      declared: true,
    },
  ])
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below.
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  let registeredPolicy = options().retryPolicy
  const ensureRegistrationFacts = (): void => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    // The registry captures the retry policy at registration, so it is the one
    // fact per-request resolution cannot refresh. `replace` re-reads it in one
    // synchronous registry section: disposing and re-registering instead would
    // publish an empty route set between the two, and an observer that reacted
    // to it would see this provider disappear and come back.
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }
  // Model discovery for the settings namespace this plugin owns: the Models
  // page interrogates the gateway's /models with the draft's endpoint and
  // one-shot credential, or the current snapshot's facts. The runtime hands
  // caller cancellation as a separate signal (0.1.7 seam).
  ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => adapter.discoverModels(request, signal))

  // Re-register on live volatile-only updates. The loader emits this event
  // on the owning fiber after a successful volatile commit (no remount). The
  // retry policy is the one registration-captured fact that needs a re-bind;
  // everything else is per-operation, read through the live refs.
  ctx.on('loader/volatile-update', () => {
    try { ensureRegistrationFacts() }
    catch (error) {
      ctx.logger.error(`${PKG}: failed to refresh registration facts after a volatile update`)
      ctx.logger.error(error)
    }
  })

  // Host-side endpoint for the「更新模型信息」action: the browser names
  // the gateway model ids (and optionally the proxy draft) and the host
  // downloads https://models.dev/api.json — no cross-origin fetch happens in
  // the browser, and a plain HTTP forward proxy works because Node performs
  // the request.
  //
  // The channel goes through the connection service's own `register(owner,
  // channel, handler)` rather than the `rpc.handle(channel, handler)` the
  // type advertises. On the 0.1.7 host line `handle` is still unusable for
  // the same reason as 0.1.5: its `rpc` getter captures `this.ctx`, and that
  // captured context is the connection service's own scope, which has no
  // `webServer` injected. `register` then evaluates `owner.webServer.register(route)`,
  // cordis answers `cannot get property "webServer" without inject`, and the
  // throw is swallowed by the effect — so the channel silently never appears
  // and the browser meets the SPA fallback's 405 (the boot check catches
  // exactly this). Passing our own inject-scope context as the owner fixes
  // it, and `register` is the very method `rpc.handle` delegates to. The
  // private `register` method is no longer part of `HostConnectionHandle` on
  // 0.1.7; the cast below mirrors the previous 0.1.5 workaround and the
  // handle signature now receives a fourth `peer` argument that our handler
  // simply ignores (fewer params is still assignable).
  //
  // Both services are injected so registration waits for each to exist and
  // re-runs if either reloads.
  ctx.inject(['connection', 'webServer'], (cctx) => {
    const connection = cctx.get('connection') as HostConnectionHandle
    // The owner-taking overload is on the service prototype but not on
    // `HostConnectionHandle`, so the extra shape is declared here.
    const registrar = connection as unknown as {
      register(
        owner: unknown,
        channel: string,
        handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
      ): () => Promise<void>
    }
    cctx.effect(() => registrar.register(
      cctx,
      '/llm-newapi',
      (endpoint: string, payload: unknown, signal: AbortSignal) => {
        if (endpoint !== 'models-dev-params') {
          return Promise.resolve({
            ok: false as const,
            error: { code: 'internal' as const, message: `llm-newapi: unknown endpoint ${endpoint}`, details: {} },
          })
        }
        const request = payload as ModelsDevParamsRequest
        // Failures answer as the error envelope, never a thrown value: the
        // transport maps a thrown handler to an opaque HTTP 500, which hides
        // the actual reason (unreachable endpoint, dead proxy) from the
        // settings page that asked.
        return adapter.fetchModelsDevParams(request, signal)
          .then(value => ({ ok: true as const, value }))
          .catch((error: unknown) => ({
            ok: false as const,
            error: {
              code: 'internal' as const,
              message: error instanceof Error ? error.message : String(error),
              details: {},
            },
          }))
      },
    ), 'llm-newapi: models-dev RPC channel')
  })
}