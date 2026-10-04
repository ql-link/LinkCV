import { cn } from "@/lib/utils";
import "./page-loading.css";

export type PageLoadingProps = {
  label: string;
  scope?: "page" | "workspace" | "panel";
  className?: string;
};

/** Reserve a text slot without showing a guessed value before its request settles. */
export function LoadingText({ width = "8em" }: { width?: string | number }) {
  return <span aria-hidden="true" className="ui-loading-text ui-loading-placeholder" style={{ width }} />;
}

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
      <span aria-hidden="true" className="page-loading-spinner" />
      <p>{label}</p>
    </div>
  );
}
