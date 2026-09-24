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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Volatile } from '@deepseek-ai/cordis';
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import type { NewApiCatalogModel, NewApiConnectionOptions } from './adapter.js';
import type { ProviderHints } from './types.js';
export { DEFAULT_CONTEXT_WINDOW, DEFAULT_MODEL_EXCLUDE_PATTERNS, DEFAULT_PROVIDER_HINTS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, matchModelsDev, modelNameFromId, NewApiAdapter, normalizeBaseUrl, PKG, } from './adapter.js';
export { serializeRequest } from './serialize.js';
export type { NewApiAdapterOptions, NewApiCatalogModel, NewApiConnectionOptions } from './adapter.js';
export type * from './types.js';
export declare const name = "llm-newapi";
export declare const inject: string[];
/** Placeholder gateway base used when neither config nor environment names one. */
export declare const DEFAULT_BASE_URL = "https://newapi.example.com/v1";
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
    baseURL: Volatile<string | undefined>;
    /** Advisory models shown by discovery consumers; defaults to none — a gateway's model set is deployment-specific. */
    models: Volatile<NewApiCatalogModel[]>;
    /**
     * Case-insensitive id substrings excluding discovered models that cannot
     * serve chat completions (embedding, rerank, ranker families). Replaces the
     * default {@link DEFAULT_MODEL_EXCLUDE_PATTERNS} list; an empty array
     * disables filtering. The hand-curated {@link models} catalog is unaffected.
     */
    modelExcludePatterns: Volatile<string[]>;
    /** Positive context capacity used when the selected model has no exact value (default 128,000). */
    defaultContextWindow: Volatile<number>;
    /** Default per-request output cap; omission sends no cap and lets each upstream default apply. */
    maxTokens: Volatile<number | undefined>;
    /** Maximum gateway idle time while one stream read is outstanding (default five minutes). */
    streamIdleTimeoutMs: Volatile<number>;
    /**
     * Forward proxy for the models.dev catalog download performed by the
     *「更新模型信息」action: disabled by default; when enabled, that one
     * request is routed through `proxy.url` (a plain HTTP forward proxy).
     * Gateway traffic is untouched.
     */
    proxy: Volatile<ProxyConfig>;
    /**
     * Match-shaping hints for the models.dev params lookup: family prefixes
     * and exact ids name which catalog provider counts as official (leading
     * match, flagged). Built-in families (glm→zai, gpt→openai, claude→
     * anthropic, …) apply first; these entries override and extend them.
     */
    providerHints: Volatile<ProviderHints>;
    /** Provider-owned model-request retry policy; omission uses normal defaults. */
    retryPolicy: Volatile<RetryPolicyConfig | undefined>;
}
/** Forward-proxy settings for the models.dev catalog download. */
export interface ProxyConfig {
    /** Whether the proxy is used; defaults to false. */
    enabled?: boolean;
    /** Proxy URL; presets default to `http://127.0.0.1:7890`. */
    url?: string;
}
/**
 * Plain options the resolver consumes. Volatile refs (or a programmatically
 * built plain object that bypassed the schema) are unwrapped through
 * {@link plainOptions}; the resolver never sees a `Volatile` wrapper.
 */
export type Options = {
    [K in keyof Config]?: Config[K] extends Volatile<infer T> ? Exclude<T, undefined> : never;
};
/**
 * Unwrap every {@link Volatile} reference on a parsed Config. Tolerates
 * programmatically constructed plain objects (tests, programmatic callers)
 * by falling back to the raw value when the volatile write key is absent.
 */
export declare function plainOptions(config: Config): Options;
/** Default forward proxy: the conventional Clash port on loopback. */
export declare const DEFAULT_PROXY_URL = "http://127.0.0.1:7890";
/**
 * Schema-backed plugin Config. Every field is `.volatile()` so the dsh
 * 0.1.7 settings form projects every editable field; the loader writes
 * them through the profile patch and commits new values into the running
 * `Volatile` references in place. Required fields use `.required()` so the
 * output type is `Volatile<T>` (mode `volatile-defined`); optional fields
 * produce `Volatile<T | undefined>` (mode `volatile`) and are allowed to
 * default or be omitted.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    baseURL: z<string, string, "volatile">;
    models: z<NoInfer<NewApiCatalogModel[]>, NoInfer<NewApiCatalogModel[]>, "volatile-defined">;
    modelExcludePatterns: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    defaultContextWindow: z<number, number, "volatile-defined">;
    maxTokens: z<number, number, "volatile">;
    streamIdleTimeoutMs: z<number, number, "volatile-defined">;
    proxy: z<NoInfer<ProxyConfig>, NoInfer<ProxyConfig>, "volatile-defined">;
    providerHints: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        defaults: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>, "plain">;
        models: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>, "plain">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        defaults: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>, "plain">;
        models: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>, "plain">;
    }>>>, "volatile">;
    retryPolicy: z<NoInfer<RetryPolicyConfig>, NoInfer<RetryPolicyConfig>, "volatile">;
}>>, Schemastery.ObjectT<NoInfer<{
    baseURL: z<string, string, "volatile">;
    models: z<NoInfer<NewApiCatalogModel[]>, NoInfer<NewApiCatalogModel[]>, "volatile-defined">;
    modelExcludePatterns: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    defaultContextWindow: z<number, number, "volatile-defined">;
    maxTokens: z<number, number, "volatile">;
    streamIdleTimeoutMs: z<number, number, "volatile-defined">;
    proxy: z<NoInfer<ProxyConfig>, NoInfer<ProxyConfig>, "volatile-defined">;
    providerHints: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        defaults: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>, "plain">;
        models: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>, "plain">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        defaults: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>, "plain">;
        models: z<Schemastery.ObjectS<{}>, Schemastery.ObjectT<{}>, "plain">;
    }>>>, "volatile">;
    retryPolicy: z<NoInfer<RetryPolicyConfig>, NoInfer<RetryPolicyConfig>, "volatile">;
}>>, "plain">;
/**
 * One resolution's complete request facts. Connection and credential facts
 * are one value on purpose: a snapshot the resolver rejects keeps the whole
 * previous generation, so a request can never pair a stale endpoint with a
 * newer key.
 */
export type ResolvedNewApiOptions = NewApiConnectionOptions;
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
export declare function resolveAdapterOptions(options: Options, environment?: ReturnType<typeof launchEnvironmentOf>): ResolvedNewApiOptions;
export declare function apply(ctx: Context, config: Config): void;
