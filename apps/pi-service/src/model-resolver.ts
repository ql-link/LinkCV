import type { Model } from "@earendil-works/pi-ai";
import { flattenModelCatalog } from "../../../third_party/pi/packages/ai/src/model-catalog.ts";
import deepseekValues from "../../../third_party/pi/packages/ai/src/providers/data/deepseek.json";
import qwenTokenPlanCnValues from "../../../third_party/pi/packages/ai/src/providers/data/qwen-token-plan-cn.json";

const DEEPSEEK_MODELS = flattenModelCatalog("deepseek", deepseekValues);
const QWEN_TOKEN_PLAN_CN_MODELS = flattenModelCatalog("qwen-token-plan-cn", qwenTokenPlanCnValues);

export interface RuntimeModelInput {
  adapter: string;
  id: string;
  name: string;
  baseUrl?: string;
}

const DEEPSEEK_FALLBACK = DEEPSEEK_MODELS["deepseek-v4-flash"];
const DASHSCOPE_FALLBACK = QWEN_TOKEN_PLAN_CN_MODELS["qwen3.7-plus"];

function validatedBaseUrl(value: string | undefined, fallback: string): string {
  const url = new URL(value?.trim() || fallback);
  const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("PI_MODEL_BASE_URL_UNSUPPORTED");
  }
  return url.toString().replace(/\/$/, "");
}

function cloneProfile(
  profile: Model<"openai-completions">,
  input: RuntimeModelInput,
): Model<"openai-completions"> {
  return {
    ...profile,
    id: input.name,
    name: input.name,
    baseUrl: validatedBaseUrl(input.baseUrl, profile.baseUrl),
    compat: profile.compat ? { ...profile.compat } : undefined,
    thinkingLevelMap: profile.thinkingLevelMap ? { ...profile.thinkingLevelMap } : undefined,
  };
}

export function resolveRuntimeModel(input: RuntimeModelInput): Model<"openai-completions"> {
  const adapter = input.adapter.trim();
  const modelName = input.name.trim();
  if (!input.id.trim() || !modelName) throw new Error("PI_MODEL_INVALID");

  if (adapter === "deepseek") {
    const profile = DEEPSEEK_MODELS[modelName as keyof typeof DEEPSEEK_MODELS] ?? DEEPSEEK_FALLBACK;
    return cloneProfile(profile, input);
  }
  if (adapter === "dashscope") {
    const profile =
      QWEN_TOKEN_PLAN_CN_MODELS[modelName as keyof typeof QWEN_TOKEN_PLAN_CN_MODELS] ?? DASHSCOPE_FALLBACK;
    return cloneProfile(profile, input);
  }
  throw new Error("PI_MODEL_ADAPTER_UNSUPPORTED");
}
