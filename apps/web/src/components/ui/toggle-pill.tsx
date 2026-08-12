import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type TogglePillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: ReactNode;
};

export function TogglePill({ active = false, icon, className, children, type = "button", ...props }: TogglePillProps) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "ui-toggle-pill inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface px-3 text-xs font-semibold text-muted-foreground shadow-xs transition-[color,background-color,border-color,box-shadow,transform] duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px",
        active && "border-foreground bg-foreground text-background",
        className,
      )}
      data-slot="toggle-pill"
      type={type}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
