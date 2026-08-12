import brandMark from "@/assets/linkcv-mark.svg";
import { cn } from "@/lib/utils";

export function Brand({
  compact = false,
  className,
  label = "LinkCV",
  name = "LinkCV",
}: {
  compact?: boolean;
  className?: string;
  label?: string;
  name?: string;
}) {
  return (
    <span aria-label={label} className={cn("ui-brand inline-flex items-center gap-2", className)} data-slot="brand">
      <span aria-hidden="true" className="ui-brand-mark grid size-8 place-items-center overflow-hidden rounded-md bg-foreground">
        <img alt="" className="size-full [filter:brightness(0)_invert(1)]" src={brandMark} />
      </span>
      {!compact && <span className="ui-brand-name font-display text-base font-bold tracking-[-0.02em]">{name}</span>}
    </span>
  );
}
