import type { ButtonHTMLAttributes } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: "ghost" | "circular";
  danger?: boolean;
};

export function IconButton({
  label,
  variant = "ghost",
  danger = false,
  className,
  children,
  title,
  ...props
}: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      className={cn("ui-icon-button rounded-full", variant === "circular" && "border border-border bg-surface shadow-xs", className)}
      data-slot="icon-button"
      size="icon"
      title={title ?? label}
      variant={danger ? "destructive" : "ghost"}
      {...props}
    >
      {children}
    </Button>
  );
}
