// Dynamic model list fetch + fallback.
//
// Ported from deveco-code packages/opencode/src/plugin/deveco-models.ts,
// replacing effect Schema with hand-written type guards (no effect runtime dep).
// Behaviour is otherwise equivalent: GET modelConfig with the access token,
// map to opencode's ModelInfo shape, apply blacklist, fall back to defaults
// on any failure.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEVECO_DEFAULTS, DEVECO_MODEL_CONFIG_URL, PLUGIN_VERSION, STATIC_PROVIDER_FIELDS, log, } from "./config.js";
import { envFetch } from "./env-fetch.js";
function stringItems(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === "string" && item.length > 0)
        : [];
}
export function parseReasoningEfforts(raw) {
    if (typeof raw !== "string")
        return { levels: [] };
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
            return { levels: stringItems(parsed) };
        if (typeof parsed === "object" && parsed !== null) {
            const obj = parsed;
            const levels = stringItems(obj.level);
            const def = typeof obj.default === "string" && levels.includes(obj.default) ? obj.default : undefined;
            return { levels, default: def };
        }
        return { levels: [] };
    }
    catch {
        return { levels: [] };
    }
}
// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------
function parseOutputLimit(output) {
    if (output == null)
        return undefined;
    if (typeof output === "number")
        return output;
    const num = parseInt(output, 10);
    return isNaN(num) ? undefined : num;
}
/** Fallbacks the upstream plugin applies when the cloud omits a size: leaving
 * them unset makes opencode treat the model as 0-context. */
const DEFAULT_CONTEXT_LIMIT = 32768;
const DEFAULT_OUTPUT_LIMIT = 8192;
/** Modality names opencode's schema accepts; the cloud may send others. */
const KNOWN_MODALITIES = ["text", "audio", "image", "video", "pdf"];
function toInputModalities(modalities) {
    const known = (modalities ?? []).filter((m) => KNOWN_MODALITIES.includes(m));
    return known.length > 0 ? known : ["text"];
}
function mapModelConfigToInternal(config) {
    const info = {
        name: config.model_id,
        limit: {
            context: config.context_window || DEFAULT_CONTEXT_LIMIT,
            output: parseOutputLimit(config.output) ?? DEFAULT_OUTPUT_LIMIT,
        },
        modalities: { input: toInputModalities(config.input_modalities), output: ["text"] },
    };
    if (config.thinking_mode === "on")
        info.reasoning = true;
    if (config.tool_call_mode === "tool_calls")
        info.tool_call = true;
    // The cloud declares which effort tiers the model understands and which one
    // to use by default. Exposing the tiers as variants lets the client switch
    // them; the default rides options into every request until it does. Only
    // reasoning models get either — same gate as the upstream plugin.
    const efforts = parseReasoningEfforts(config.reasoning_effort);
    if (info.reasoning && efforts.levels.length > 0) {
        info.variants = Object.fromEntries(efforts.levels.map((effort) => [effort, { reasoningEffort: effort }]));
    }
    if (info.reasoning && efforts.default) {
        info.options = { reasoningEffort: efforts.default };
    }
    return info;
}
function filterBlacklist(models, blacklist) {
    const filteredModels = Object.fromEntries(Object.entries(models).filter(([id]) => !blacklist.includes(id)));
    return { ...STATIC_PROVIDER_FIELDS, models: filteredModels };
}
// ---------------------------------------------------------------------------
// API fetch
// ---------------------------------------------------------------------------
function modelConfigUrl() {
    return `${DEVECO_MODEL_CONFIG_URL}?localVersion=0&pluginVersion=CLI.${PLUGIN_VERSION}`;
}
async function fetchModelsFromAPI(accessToken) {
    const response = await envFetch(modelConfigUrl(), {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Model config API returned ${response.status}: ${body}`);
    }
    const raw = (await response.json());
    if (raw.code !== 200) {
        throw new Error(`Model config API returned code ${raw.code}`);
    }
    // extract task_default_model_map directly from raw (not modelled above)
    let taskDefaultModelMap;
    const innerModels = raw.body?.inner_models;
    if (Array.isArray(innerModels)) {
        for (const group of innerModels) {
            if (group?.task_default_model_map && typeof group.task_default_model_map === "object") {
                taskDefaultModelMap = group.task_default_model_map;
            }
        }
    }
    const models = {};
    for (const group of innerModels ?? []) {
        for (const config of group.model_configs ?? []) {
            if (typeof config.model_id === "string" && config.model_id) {
                models[config.model_id] = mapModelConfigToInternal(config);
            }
        }
    }
    log.debug("fetched models config", { count: Object.keys(models).length });
    return { models, taskDefaultModelMap };
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
let cachedConfig = null;
let cachedConfigAt = 0;
let cachedTaskDefaultModelMap = null;
/** Cache TTL in ms — after this, the next request re-fetches from the API. */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
/**
 * Returns the DevEco provider config. Tries the dynamic API first (cached on
 * success), and falls back to the static defaults on any failure.
 */
export async function getDevecoProviderConfig(accessToken) {
    if (cachedConfig && Date.now() - cachedConfigAt < CACHE_TTL_MS)
        return cachedConfig;
    // Expired or missing — clear so a failed fetch doesn't return stale data forever.
    cachedConfig = null;
    // Keep this semantic intentionally: upstream puts the vision-only model
    // (tool_call: none) into task_default_model_map.blacklist, so
    // the public list keeps the text models that support the full agent/tool
    // loop. The hidden VL model is still used internally as the image fallback
    // (src/vision-routing.ts), so no blacklist change is needed.
    const defaultBlacklist = DEVECO_DEFAULTS.taskDefaultModelMap.blacklist?.split(",") ?? [];
    try {
        const { models, taskDefaultModelMap } = await fetchModelsFromAPI(accessToken);
        if (!models || Object.keys(models).length === 0) {
            log.warn("API returned empty models, using defaults");
            return filterBlacklist({ ...DEVECO_DEFAULTS.provider.models }, defaultBlacklist);
        }
        cachedConfig = filterBlacklist(models, taskDefaultModelMap?.blacklist?.split(",") ?? []);
        cachedConfigAt = Date.now();
        cachedTaskDefaultModelMap = taskDefaultModelMap ?? DEVECO_DEFAULTS.taskDefaultModelMap;
        persistModels(cachedConfig, cachedTaskDefaultModelMap);
        return cachedConfig;
    }
    catch (err) {
        log.warn("failed to fetch models, using defaults", { error: String(err) });
        return filterBlacklist({ ...DEVECO_DEFAULTS.provider.models }, defaultBlacklist);
    }
}
/** Returns the cached task→model map (defaults until dynamic config is fetched). */
export function getTaskDefaultModelMap() {
    return cachedTaskDefaultModelMap ?? DEVECO_DEFAULTS.taskDefaultModelMap;
}
/**
 * Model ids the upstream declares as text-input-only, derived from the cached
 * model config — `input_modalities` is the authoritative answer, so a model the
 * upstream adds (or whose modalities change) is classified correctly without a
 * code change.
 *
 * Returns null when no config is cached (cold start, offline, not logged in),
 * which tells the caller to fall back to its static list. A cached config wins
 * even when it yields an empty set: "no text-only models" is then the
 * upstream's own statement, not a gap to fill in.
 */
/**
 * The effort tiers the cloud declared for a model, or null when it declared
 * none (or nothing is cached). A client speaking the wider OpenAI vocabulary
 * can name a tier the model never advertised; callers snap such a request onto
 * a tier the upstream actually understands.
 */
export function reasoningLevelsFromConfig(modelId) {
    const variants = cachedConfig?.models?.[modelId]?.variants;
    if (!variants)
        return null;
    const levels = Object.keys(variants);
    return levels.length > 0 ? levels : null;
}
export function textOnlyModelsFromConfig() {
    const models = cachedConfig?.models;
    if (!models)
        return null;
    const ids = new Set();
    for (const [id, info] of Object.entries(models)) {
        const input = info.modalities?.input;
        if (Array.isArray(input) && input.length > 0 && !input.includes("image")) {
            ids.add(id);
        }
    }
    return ids;
}
// ---------------------------------------------------------------------------
// Persisted catalog
//
// opencode's config hook is synchronous and runs before any network call can
// happen, so the cloud catalog — including the effort tiers each model
// declares — has to be on disk for the hook to inject it. The file sits next
// to the jwtToken and is rewritten whenever a fetch succeeds.
// ---------------------------------------------------------------------------
function modelsCachePath() {
    const base = process.env.OPENCODE_CONFIG_DIR ||
        path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode");
    return path.join(base, "opencode-deveco", "models.json");
}
/** Persist the fetched catalog so the next start can inject it without waiting
 * for a network round-trip. Best effort: a failure only costs a cold start on
 * the static defaults. */
export function persistModels(config, taskMap) {
    const file = modelsCachePath();
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ fetchedAt: Date.now(), config, taskMap }), { mode: 0o600 });
        fs.renameSync(tmp, file);
    }
    catch (err) {
        log.warn("failed to persist the model catalog", { error: String(err) });
    }
}
/** Read the persisted catalog, or null when there is none / it is unreadable. */
export function loadPersistedModels() {
    try {
        const parsed = JSON.parse(fs.readFileSync(modelsCachePath(), "utf8"));
        if (!parsed || typeof parsed !== "object")
            return null;
        if (!parsed.config || typeof parsed.config !== "object")
            return null;
        return { config: parsed.config, taskMap: parsed.taskMap };
    }
    catch {
        return null;
    }
}
/** Reset caches (used when the user re-logs in). */
export function resetModelCache() {
    cachedConfig = null;
    cachedConfigAt = 0;
    cachedTaskDefaultModelMap = null;
}
