/*
 * Brand marks for LLM vendors, model families and access providers, from @lobehub/icons-static-svg
 * (MIT). Imported as URLs so Vite ships each SVG as a cached asset instead of inlining it.
 * The "-color" variant is used whenever the brand has one; mono-only brands (OpenAI, xAI…) stay black.
 */
import aihubmix from "@lobehub/icons-static-svg/icons/aihubmix-color.svg?url";
import agnes from "@lobehub/icons-static-svg/icons/agnesai.svg?url";
import alibabacloud from "@lobehub/icons-static-svg/icons/alibabacloud-color.svg?url";
import antgroup from "@lobehub/icons-static-svg/icons/antgroup-color.svg?url";
import baidu from "@lobehub/icons-static-svg/icons/baidu-color.svg?url";
import bytedance from "@lobehub/icons-static-svg/icons/bytedance-color.svg?url";
import claude from "@lobehub/icons-static-svg/icons/claude-color.svg?url";
import cohere from "@lobehub/icons-static-svg/icons/cohere-color.svg?url";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek-color.svg?url";
import dotsstudio from "@lobehub/icons-static-svg/icons/dotsstudio.svg?url";
import doubao from "@lobehub/icons-static-svg/icons/doubao-color.svg?url";
import flux from "@lobehub/icons-static-svg/icons/flux.svg?url";
import gemini from "@lobehub/icons-static-svg/icons/gemini-color.svg?url";
import gemma from "@lobehub/icons-static-svg/icons/gemma-color.svg?url";
import google from "@lobehub/icons-static-svg/icons/google-color.svg?url";
import grok from "@lobehub/icons-static-svg/icons/grok.svg?url";
import hunyuan from "@lobehub/icons-static-svg/icons/hunyuan-color.svg?url";
import inception from "@lobehub/icons-static-svg/icons/inception.svg?url";
import jina from "@lobehub/icons-static-svg/icons/jina.svg?url";
import kimi from "@lobehub/icons-static-svg/icons/kimi-color.svg?url";
import kwaipilot from "@lobehub/icons-static-svg/icons/kwaipilot-color.svg?url";
import liquid from "@lobehub/icons-static-svg/icons/liquid.svg?url";
import longcat from "@lobehub/icons-static-svg/icons/longcat-color.svg?url";
import meta from "@lobehub/icons-static-svg/icons/meta-color.svg?url";
import microsoft from "@lobehub/icons-static-svg/icons/microsoft-color.svg?url";
import minimax from "@lobehub/icons-static-svg/icons/minimax-color.svg?url";
import mistral from "@lobehub/icons-static-svg/icons/mistral-color.svg?url";
import moonshot from "@lobehub/icons-static-svg/icons/moonshot.svg?url";
import nvidia from "@lobehub/icons-static-svg/icons/nvidia-color.svg?url";
import openai from "@lobehub/icons-static-svg/icons/openai.svg?url";
import opencode from "@lobehub/icons-static-svg/icons/opencode.svg?url";
import poolside from "@lobehub/icons-static-svg/icons/poolside-color.svg?url";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg?url";
import siliconcloud from "@lobehub/icons-static-svg/icons/siliconcloud-color.svg?url";
import stepfun from "@lobehub/icons-static-svg/icons/stepfun-color.svg?url";
import volcengine from "@lobehub/icons-static-svg/icons/volcengine-color.svg?url";
import wenxin from "@lobehub/icons-static-svg/icons/wenxin-color.svg?url";
import xai from "@lobehub/icons-static-svg/icons/xai.svg?url";
import xiaomimimo from "@lobehub/icons-static-svg/icons/xiaomimimo.svg?url";
import zhipu from "@lobehub/icons-static-svg/icons/zhipu-color.svg?url";

/** `llm_models.developer_name` slugs (lowercased) → vendor mark. */
const vendorIcons: Record<string, string> = {
  openai, alibaba: alibabacloud, qwen: alibabacloud, google, zhipu, zai: zhipu, minimax,
  anthropic: claude, xiaomi: xiaomimimo, xai, bytedance, moonshot, moonshotai: moonshot, deepseek,
  nvidia, microsoft, cohere, tencent: hunyuan, baidu, meta, mistral, stepfun, agnes,
  inclusionai: antgroup, kuaishou: kwaipilot, poolside, inception, "dots-studio": dotsstudio,
  liquid, jina, "meituan-longcat": longcat,
};

/** `llm_connections.provider_code` → access-provider mark. */
const providerIcons: Record<string, string> = {
  aihubmix, siliconflow: siliconcloud, deepseek, volcengine, aliyun: alibabacloud, opencode_zen: opencode,
};

/**
 * Model families recognised from the display name, first match wins. Ordered so specific names
 * ("gemma", "qwq") are tested before the generic vendor names they would otherwise fall under.
 */
const familyIcons: Array<[RegExp, string]> = [
  [/\bq(wen|wq|vq)/, qwen],
  [/doubao|\bseed[- ]?(\d|oss)/, doubao],
  [/\bgemma/, gemma],
  [/gemini|imagen|\bveo/, gemini],
  [/claude|anthropic/, claude],
  [/\bgrok/, grok],
  [/\b(gpt|o[134]\b|dall|sora|whisper|davinci|babbage|curie|text ada|chatgpt|tts[- ]1|codex|omni moderation|text moderation|text embedding (3|ada))/, openai],
  [/deepseek/, deepseek],
  [/\b(chat)?glm|cogview|cogvideo/, zhipu],
  [/\bkimi|moonshot|moonlight/, kimi],
  [/\bernie|wenxin|qianfan/, wenxin],
  [/hunyuan/, hunyuan],
  [/minimax|abab|hailuo/, minimax],
  [/\bmimo/, xiaomimimo],
  [/\bllama/, meta],
  [/mistral|mixtral|codestral|magistral|devstral/, mistral],
  [/\bcommand|\bcohere/, cohere],
  [/\bstep[- ]?\d/, stepfun],
  [/\bphi[- ]?\d/, microsoft],
  [/nemotron|\bnvidia/, nvidia],
  [/\bjina/, jina],
  [/\bflux/, flux],
  [/\b(ling|ring)[- ](\d|flash|mini)/, antgroup],
  [/longcat/, longcat],
  [/\bwan[- ]?\d|\bwanx|\bgte\b|text embedding v\d/, alibabacloud],
  [/\bgemini|learnlm|text embedding 004/, gemini],
];

export function vendorIcon(developer: string | null | undefined): string | null {
  const key = developer?.trim().toLowerCase();
  return key ? vendorIcons[key] ?? null : null;
}

export function providerIcon(code: string | null | undefined): string | null {
  return code ? providerIcons[code] ?? null : null;
}

/** Icon for one model: its family by name first, then its vendor. Null when neither is known. */
export function modelIcon(displayName: string | null | undefined, developer: string | null | undefined): string | null {
  // Router-style names ("openrouter/qwen/qwen3-8b") keep the family in the last segment.
  const name = (displayName ?? "").toLowerCase();
  const tail = name.split("/").pop() ?? name;
  for (const [pattern, icon] of familyIcons) if (pattern.test(tail)) return icon;
  return vendorIcon(developer);
}
