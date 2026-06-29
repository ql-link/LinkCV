import {
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import { resumeSerifFontStack, useResumeStore } from "../../store/resumeStore";

const fonts = [
  { label: "简历宋体", value: resumeSerifFontStack },
  { label: "霞鹜文楷", value: '"LXGW WenKai", KaiTi, STKaiti, "Songti SC", serif' },
  { label: "系统黑体", value: '"PingFang SC", "Microsoft YaHei", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  {
    label: "JetBrains Mono",
    value:
      "JetBrains Mono, SFMono-Regular, Cascadia Code, Fira Code, Menlo, Consolas, ui-monospace, monospace",
  },
  { label: "宋体", value: "SimSun, Songti SC, serif" },
  { label: "楷体", value: "KaiTi, STKaiti, serif" },
];

export function PreviewToolbar() {
  const settings = useResumeStore((state) => state.settings);
  const updateSettings = useResumeStore((state) => state.updateSettings);

  return (
    <div className="preview-toolbar" aria-label="预览控制栏">
      <button
        className={settings.smartOnePage ? "pill active" : "pill"}
        onClick={() => {
          updateSettings({ smartOnePage: !settings.smartOnePage });
        }}
      >
        <Sparkles size={14} />
        智能一页
      </button>
      <select
        className="toolbar-select"
        value={settings.fontFamily}
        onChange={(event) => updateSettings({ fontFamily: event.target.value })}
        aria-label="字体"
      >
        {fonts.map((font) => (
          <option key={font.label} value={font.value}>
            {font.label}
          </option>
        ))}
      </select>
      <NumberStepper
        label="字号"
        value={settings.fontSize}
        step={0.5}
        min={8}
        max={14}
        onChange={(fontSize) => updateSettings({ fontSize })}
      />
      <NumberStepper
        label="行距"
        value={settings.lineHeight}
        step={0.05}
        min={1.1}
        max={1.8}
        onChange={(lineHeight) => updateSettings({ lineHeight })}
      />
      <NumberStepper
        label="左右"
        value={settings.pageMargin}
        step={0.5}
        min={8}
        max={28}
        onChange={(pageMargin) => updateSettings({ pageMargin })}
      />
      <NumberStepper
        label="上下"
        value={settings.verticalPageMargin}
        step={0.5}
        min={6}
        max={36}
        onChange={(verticalPageMargin) => updateSettings({ verticalPageMargin })}
      />
    </div>
  );
}

type NumberStepperProps = {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

function NumberStepper({ label, value, step, min, max, onChange }: NumberStepperProps) {
  const next = (direction: -1 | 1) => {
    const precision = step < 1 ? 2 : 0;
    const updated = Math.min(max, Math.max(min, Number((value + step * direction).toFixed(precision))));
    onChange(updated);
  };

  return (
    <div className="stepper" aria-label={label}>
      <span>{label}</span>
      <button onClick={() => next(-1)} aria-label={`${label}减小`}>
        <Minus size={12} />
      </button>
      <strong>{value}</strong>
      <button onClick={() => next(1)} aria-label={`${label}增大`}>
        <Plus size={12} />
      </button>
    </div>
  );
}
