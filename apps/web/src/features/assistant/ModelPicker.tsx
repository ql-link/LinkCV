import { useRef, useState } from "react";
import type { AgentModelSummary } from "../../api/client";
import claudeIcon from "@/assets/model-icons/claude.svg";
import deepseekIcon from "@/assets/model-icons/deepseek.svg";
import geminiIcon from "@/assets/model-icons/gemini.svg";
import grokIcon from "@/assets/model-icons/grok.svg";
import kimiIcon from "@/assets/model-icons/kimi.svg";
import openaiIcon from "@/assets/model-icons/openai.svg";
import { Icon } from "../../v3/Icon";
import { Popover } from "../../v3/primitives";
import { LoadingText } from "../../components/ui/page-loading";

const VENDOR_ICONS = { openai: openaiIcon, claude: claudeIcon, gemini: geminiIcon, deepseek: deepseekIcon, kimi: kimiIcon, grok: grokIcon };
export type ModelVendor = keyof typeof VENDOR_ICONS;

// 按模型名匹配厂商（01.1b 模型选择）；认不出的返回 null，用 spark 图标
export function modelVendor(name: string): ModelVendor | null {
  const value = name.toLowerCase();
  if (/gpt|(^|[^a-z])o[1-9]|openai/.test(value)) return "openai";
  if (value.includes("claude")) return "claude";
  if (value.includes("gemini")) return "gemini";
  if (value.includes("deepseek")) return "deepseek";
  if (value.includes("kimi") || value.includes("moonshot")) return "kimi";
  if (value.includes("grok")) return "grok";
  return null;
}

export function ModelIcon({ name, size = 18 }: { name: string; size?: number }) {
  const vendor = modelVendor(name);
  if (!vendor) return <Icon name="spark" size={size} style={{ color: "var(--v3-sub)" }} />;
  return <img className="assistant-model-icon" src={VENDOR_ICONS[vendor]} alt="" width={size} height={size} data-vendor={vendor} />;
}

// 输入框右下角的模型按钮 + 248 宽「选择模型」弹层
export function ModelPicker({
  models,
  selectedId,
  label,
  loading,
  disabled,
  onSelect,
  compact = false,
}: {
  models: AgentModelSummary[];
  selectedId: string | null | undefined;
  label: string;
  loading: boolean;
  disabled: boolean;
  onSelect: (modelId: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const selected = models.find((model) => model.id === selectedId) ?? null;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`assistant-model-trigger${compact ? " is-compact" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        aria-busy={loading || undefined}
        disabled={loading}
        title={selected?.name}
        onClick={() => setOpen((value) => !value)}
      >
        {selected && <ModelIcon name={selected.name} size={compact ? 13 : 15} />}
        {loading ? <LoadingText width={110} /> : <span>{label}</span>}
        {!compact && <Icon name="chevd" size={12} />}
      </button>
      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        placement="top-end"
        role="menu"
        label="选择模型"
        className="assistant-model-menu"
      >
        <div className="assistant-model-menu-head">选择模型</div>
        <div className="assistant-model-menu-list">
          {models.length ? models.map((model) => (
            <button
              key={model.id}
              type="button"
              role="menuitemradio"
              aria-checked={model.id === selectedId}
              className={model.id === selectedId ? "is-active" : undefined}
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onSelect(model.id);
              }}
            >
              <ModelIcon name={model.name} />
              <span>{model.name}</span>
              {model.id === selectedId && <Icon className="assistant-model-check" name="check" size={12} />}
            </button>
          )) : <p className="assistant-model-menu-empty">{loading ? "正在读取模型" : "当前没有可用模型"}</p>}
        </div>
      </Popover>
    </>
  );
}
