import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
