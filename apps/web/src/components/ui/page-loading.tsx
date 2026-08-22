import { LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import "./page-loading.css";

export type PageLoadingProps = {
  label: string;
  scope?: "page" | "workspace" | "panel";
  className?: string;
};

export function PageLoading({
  label,
  scope = "workspace",
  className,
}: PageLoadingProps) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      aria-live="polite"
      className={cn("page-loading", `is-${scope}`, className)}
      role="status"
    >
      <LoaderCircle aria-hidden="true" className="page-loading-spinner" />
      <p>{label}</p>
    </div>
  );
}
