import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";

import { useCallback, useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Icon } from "../../v3/Icon";
import { Popover as V3Popover } from "../../v3/primitives";
import "./template-filter.css";

export const templateStyleOptions = ["简约", "经典", "现代", "创意"];
export const templateUseCaseOptions = ["实习", "校招", "社招"];

type TemplateFilterPopoverProps = {
  styles: string[];
  useCases: string[];
  onChange: (styles: string[], useCases: string[]) => void;
  compact?: boolean;
};

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function TemplateFilterPopover({ styles, useCases, onChange, compact = false }: TemplateFilterPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`template-filter-trigger${compact ? " is-compact" : ""}`}
          aria-label="筛选简历模板"
        >
          <SlidersHorizontal aria-hidden="true" />
          <span>筛选</span>
          {!compact && <ChevronDown aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={4}
        collisionPadding={12}
        className={`template-filter-popover${compact ? " is-compact" : ""}`}
      >
        <div className="template-filter-heading">
          <strong>筛选简历模板</strong>
          <button
            type="button"
            className="template-filter-reset"
            aria-label="重置筛选"
            title="重置筛选"
            disabled={styles.length === 0 && useCases.length === 0}
            onClick={() => onChange([], [])}
          >
            <RotateCcw aria-hidden="true" />
          </button>
        </div>
        <div className="template-filter-section" role="group" aria-label="风格筛选">
          <span>风格</span>
          <div className="template-filter-options">
            {templateStyleOptions.map((style) => (
              <button
                key={style}
                type="button"
                aria-pressed={styles.includes(style)}
                onClick={() => onChange(toggle(styles, style), useCases)}
              >
                {style}
              </button>
            ))}
          </div>
        </div>
        <div className="template-filter-section" role="group" aria-label="适用场景筛选">
          <span>适用场景</span>
          <div className="template-filter-options">
            {templateUseCaseOptions.map((useCase) => (
              <button
                key={useCase}
                type="button"
                aria-pressed={useCases.includes(useCase)}
                onClick={() => onChange(styles, toggle(useCases, useCase))}
              >
                {useCase}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ───────────── V3 · 03.1b 模板筛选（Figma 519:285） ─────────────
   触发按钮 92×30（有选中时变黑边并显示「筛选 · n」），弹层 300 宽、右对齐、按钮下方 6px。
   旧版 TemplateFilterPopover 仍被编辑器模板面板使用，保留不动。 */
export function V3TemplateFilter({
  styles,
  useCases,
  onChange,
}: {
  styles: string[];
  useCases: string[];
  onChange: (styles: string[], useCases: string[]) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const count = styles.length + useCases.length;
  const groups: Array<{ label: string; options: string[]; values: string[]; apply: (next: string[]) => void }> = [
    { label: "风格", options: templateStyleOptions, values: styles, apply: (next) => onChange(next, useCases) },
    { label: "适用场景", options: templateUseCaseOptions, values: useCases, apply: (next) => onChange(styles, next) },
  ];
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`tpl-filter-trigger${open ? " is-open" : ""}${count ? " is-active" : ""}`}
        aria-label="筛选简历模板"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="filter" size={13} />
        <span>{count ? `筛选 · ${count}` : "筛选"}</span>
        <Icon name="chevd" size={12} className="tpl-filter-chev" />
      </button>
      <V3Popover anchorRef={anchorRef} open={open} onClose={close} placement="bottom-end" offset={6} className="tpl-filter-pop" label="筛选简历模板">
        <div className="tpl-filter-head">
          <strong>筛选简历模板</strong>
          <button
            type="button"
            className="tpl-filter-reset"
            aria-label="重置筛选"
            title="重置筛选"
            disabled={count === 0}
            onClick={() => onChange([], [])}
          >
            <Icon name="refresh" size={14} />
          </button>
        </div>
        {groups.map((group) => (
          <div key={group.label} className="tpl-filter-group" role="group" aria-label={`${group.label}筛选`}>
            <span>{group.label}</span>
            <div>
              {group.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={group.values.includes(option)}
                  onClick={() => group.apply(toggle(group.values, option))}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ))}
      </V3Popover>
    </>
  );
}
