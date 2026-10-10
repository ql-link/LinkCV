import { t, useLocale } from "@/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Minus, Plus, Rows2, Type } from "lucide-react";
import { Select } from "../../v3/primitives";
import { resumeSerifFontStack, type ResumeSettings } from "../../store/resumeStore";
import { WorkbenchPanelHeader } from "./WorkbenchPanelHeader";

export const WORKBENCH_VERTICAL_PAGE_MARGIN_MIN_MM = 6;

export const workbenchFontOptions = [
  { get label() { return t("思源宋体"); }, value: resumeSerifFontStack },
  { get label() { return t("霞鹜文楷"); }, value: '"LXGW WenKai", KaiTi, STKaiti, "Songti SC", serif' },
  { get label() { return t("系统黑体"); }, value: '"DrawOffer Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif' },
];

export function steppedSettingValue(value: number, direction: -1 | 1, min: number, max: number, step: number) {
  const precision = Math.max(0, step.toString().split(".")[1]?.length ?? 0);
  return Math.min(max, Math.max(min, Number((value + direction * step).toFixed(precision))));
}

// 把滑杆位置吸附到步长上，避免浮点尾数（例如 1.3500000000000001）
export function snapSettingValue(value: number, min: number, max: number, step: number) {
  const precision = Math.max(0, step.toString().split(".")[1]?.length ?? 0);
  const snapped = Math.round((value - min) / step) * step + min;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(precision))));
}

// 字体下拉（v3 Select）：只列候选字体名称，选项用对应字体渲染
export function FontPreviewSelect({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  useLocale();
  const selected = workbenchFontOptions.find((font) => font.value === value) ?? workbenchFontOptions[0];
  return (
    <div className="wb3-type-field">
      <span className="wb3-type-label" id="wb3-font-label">{t("字体")}</span>
      <Select
        value={selected.value}
        options={workbenchFontOptions}
        onChange={onChange}
        disabled={disabled}
        label={t("字体")}
        className="wb3-font-select"
      />
    </div>
  );
}

// 设置滑杆（Figma 509:1040 · ewSlider）：左标签、右当前值，4px 轨道 + 16px 白色旋钮
export function SettingsSlider({
  label,
  unit,
  value,
  min,
  max,
  step,
  digits,
  onChange,
  disabled,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  useLocale();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const percent = ((draft - min) / (max - min)) * 100;
  const shown = digits === undefined ? String(Number(draft.toFixed(2))) : draft.toFixed(digits);
  return (
    <div className="wb3-slider">
      <div className="wb3-slider-head">
        <span>{label}</span>
        <output aria-label={t("{value0}当前值", { value0: label })}>{shown}{unit ? ` ${unit}` : ""}</output>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        style={{ "--wb3-slider-fill": `${percent}%` } as React.CSSProperties}
        onChange={(event) => {
          const next = snapSettingValue(Number(event.target.value), min, max, step);
          setDraft(next);
          if (next !== value) onChange(next);
        }}
      />
    </div>
  );
}

function SettingStepper({ label, unit, value, min, max, step, onChange, disabled }: {
  label: string; unit: string; value: number; min: number; max: number; step: number;
  onChange: (value: number) => void; disabled: boolean;
}) {
  useLocale();
  return <div className="wb3-setting-row">
    <span>{label}</span>
    <div className="wb3-setting-stepper">
      <button type="button" aria-label={t("减小{value0}", { value0: label })} disabled={disabled || value <= min}
        onClick={() => onChange(steppedSettingValue(value, -1, min, max, step))}><Minus size={14} /></button>
      <output aria-label={t("{value0}当前值", { value0: label })}>{Number(value.toFixed(2))}{unit ? ` ${unit}` : ""}</output>
      <button type="button" aria-label={t("增大{value0}", { value0: label })} disabled={disabled || value >= max}
        onClick={() => onChange(steppedSettingValue(value, 1, min, max, step))}><Plus size={14} /></button>
    </div>
  </div>;
}

export function WorkbenchTypePanel({ settings, disabled, onChange, onClose, pageControls }: {
  settings: Pick<ResumeSettings, "fontFamily" | "fontSize" | "lineHeight" | "pageMargin" | "verticalPageMargin">;
  disabled: boolean;
  onChange: (patch: Partial<ResumeSettings>) => void;
  onClose: () => void;
  pageControls: ReactNode;
}) {
  useLocale();
  return (
    <div className="wb3-type-panel">
      <WorkbenchPanelHeader titleId="workbench-type-title" title={t("设置")}
        closeLabel={t("关闭排版面板")} onClose={onClose} />
      <div className="wb3-panel-body wb3-type-body">
        {pageControls}
        <hr className="wb3-type-divider" />
        <div className="wb3-type-section"><strong>{t("页边距")}</strong><small>{t("分别调整上下和左右留白，单位为毫米。")}</small></div>
        <div className="wb3-margin-settings">
          <div>
            <SettingStepper label={t("上下边距")} unit="mm" value={settings.verticalPageMargin} min={WORKBENCH_VERTICAL_PAGE_MARGIN_MIN_MM} max={30} step={2} onChange={(verticalPageMargin) => onChange({ verticalPageMargin })} disabled={disabled} />
            <SettingStepper label={t("左右边距")} unit="mm" value={settings.pageMargin} min={10} max={30} step={2} onChange={(pageMargin) => onChange({ pageMargin })} disabled={disabled} />
          </div>
          <div className="wb3-margin-preview" aria-hidden="true"><Rows2 size={28} /><small>{t("页面预览")}</small></div>
        </div>
        <hr className="wb3-type-divider" />
        <div className="wb3-type-section"><strong className="wb3-type-heading"><Type size={16} />{t("排版")}</strong><small>{t("统一调整简历正文的字体、字号和行距。")}</small></div>
        <FontPreviewSelect value={settings.fontFamily} onChange={(fontFamily) => onChange({ fontFamily })} disabled={disabled} />
        <SettingStepper label={t("正文字号")} unit="pt" value={settings.fontSize} min={8} max={16} step={0.5} onChange={(fontSize) => onChange({ fontSize })} disabled={disabled} />
        <SettingStepper label={t("正文行距")} unit="" value={settings.lineHeight} min={1.1} max={1.8} step={0.05} onChange={(lineHeight) => onChange({ lineHeight })} disabled={disabled} />
      </div>
    </div>
  );
}
