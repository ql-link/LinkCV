import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import "./expandable-search.css";

type ExpandableSearchProps = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  placeholder?: string;
};

export function ExpandableSearch({
  label,
  value,
  onValueChange,
  className,
  placeholder = "搜索…",
}: ExpandableSearchProps) {
  const [expanded, setExpanded] = useState(value.length > 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocusRef = useRef(false);

  useEffect(() => {
    if (expanded) {
      inputRef.current?.focus();
      return;
    }
    if (restoreTriggerFocusRef.current) {
      triggerRef.current?.focus();
      restoreTriggerFocusRef.current = false;
    }
  }, [expanded]);

  const collapse = () => {
    onValueChange("");
    restoreTriggerFocusRef.current = true;
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <button
        ref={triggerRef}
        aria-label={label}
        className={cn("expandable-search-trigger", className)}
        type="button"
        onClick={() => setExpanded(true)}
      >
        <Search aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className={cn("expandable-search", className)} role="search" aria-label={label}>
      <Search aria-hidden="true" className="expandable-search-icon" />
      <input
        ref={inputRef}
        aria-label={label}
        autoComplete="off"
        data-slot="expandable-search-input"
        name="resume-search"
        placeholder={placeholder}
        spellCheck={false}
        type="search"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Escape") {
            event.preventDefault();
            collapse();
          }
        }}
      />
      <button
        aria-label="清除并收起搜索"
        className="expandable-search-close"
        type="button"
        onClick={collapse}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

export type { ExpandableSearchProps };
