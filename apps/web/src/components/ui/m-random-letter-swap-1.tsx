import { RandomLetterSwap } from "@/components/ui/random-letter-swap";
import { cn } from "@/lib/utils";
import type { CSSProperties, ComponentType } from "react";

type NavigationLink = {
  activeColor: string;
  gradient: string;
  href: string;
  icon?: ComponentType<{ "aria-hidden"?: boolean; className?: string; strokeWidth?: number }>;
  label: string;
};

type RandomLetterSwapNavProps = {
  activeItem: string;
  className?: string;
  links: readonly NavigationLink[];
  navigationMode?: "client" | "native";
  onItemClick?: (href: string) => void;
  currentType?: "location" | "page";
};

type NavigationTone = CSSProperties & {
  "--nav-item-color": string;
  "--nav-item-glow": string;
};

export default function RandomLetterSwapNav({
  activeItem,
  className,
  links,
  navigationMode = "native",
  onItemClick,
  currentType = "location",
}: RandomLetterSwapNavProps) {
  return (
    <div
      className={cn(
        "flex w-max items-center gap-0.5 overflow-hidden rounded-full border border-black/[0.06] bg-white/70 p-1 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-950/65 dark:shadow-[0_8px_24px_rgba(0,0,0,0.22)]",
        className,
      )}
    >
      {links.map((link) => {
        const isActive = activeItem === link.href;
        const Icon = link.icon;

        return (
          <RandomLetterSwap
            aria-current={isActive ? currentType : undefined}
            className="relative isolate items-center gap-2 rounded-full px-3 py-2 text-[13px] text-zinc-500 no-underline transition-colors duration-fast ease-press before:absolute before:-inset-x-4 before:-inset-y-2 before:z-0 before:rounded-full before:opacity-0 before:content-[''] before:transition-opacity before:duration-slow before:ease-standard before:[background:var(--nav-item-glow)] hover:text-zinc-900 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-ring)] data-[active=true]:font-medium data-[active=true]:text-[var(--nav-item-color)] data-[active=true]:before:opacity-100 motion-reduce:before:transition-none dark:text-zinc-400 dark:hover:text-white dark:data-[active=true]:text-[var(--nav-item-color)]"
            data-active={isActive}
            href={link.href}
            key={link.href}
            label={link.label}
            leading={Icon ? <Icon aria-hidden className="relative z-[1] size-4 shrink-0" strokeWidth={1.8} /> : undefined}
            onClick={(event) => {
              if (navigationMode === "client") {
                const shouldUseClientNavigation = event.button === 0
                  && !event.altKey
                  && !event.ctrlKey
                  && !event.metaKey
                  && !event.shiftKey;
                if (!shouldUseClientNavigation) return;
                event.preventDefault();
              }
              onItemClick?.(link.href);
            }}
            style={{
              "--nav-item-color": link.activeColor,
              "--nav-item-glow": link.gradient,
            } as NavigationTone}
          />
        );
      })}
    </div>
  );
}

export type { NavigationLink, RandomLetterSwapNavProps };
