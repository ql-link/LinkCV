import brandMark from "@/assets/drawoffer-mark.png";
import brandWordmark from "@/assets/drawoffer-wordmark.png";
import { cn } from "@/lib/utils";

export function Brand({
  compact = false,
  className,
  label = "DrawOffer",
  name = "DrawOffer",
}: {
  compact?: boolean;
  className?: string;
  label?: string;
  name?: string;
}) {
  return (
    <span
      aria-label={label}
      className={cn("ui-brand inline-flex items-center", className)}
      data-slot="brand"
      title={name}
    >
      <img
        alt=""
        aria-hidden="true"
        className={cn("ui-brand-mark", !compact && "ui-brand-responsive-mark")}
        height="1080"
        src={brandMark}
        width="1080"
      />
      {!compact && (
        <img
          alt=""
          aria-hidden="true"
          className="ui-brand-wordmark"
          height="349"
          src={brandWordmark}
          width="1701"
        />
      )}
    </span>
  );
}
