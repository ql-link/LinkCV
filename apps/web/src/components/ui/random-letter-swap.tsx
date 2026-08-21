import {
  motion,
  useReducedMotion,
  type HTMLMotionProps,
} from "motion/react";
import {
  useCallback,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type RandomLetterSwapProps = Omit<
  HTMLMotionProps<"a">,
  "children" | "transition"
> & {
  label: string;
  leading?: ReactNode;
  staggerDuration?: number;
  transition?: HTMLMotionProps<"span">["transition"];
};

const DEFAULT_TRANSITION = {
  duration: 0.32,
  ease: [0.22, 1, 0.36, 1],
} as const;

export function RandomLetterSwap({
  className,
  label,
  leading,
  staggerDuration = 0.035,
  transition = DEFAULT_TRANSITION,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...props
}: RandomLetterSwapProps) {
  const sourceCharacters = Array.from(label);
  let rollOrder = 0;
  const rollDelays = sourceCharacters.map((character) => {
    if (character.trim().length === 0) return 0;
    const delay = Number((rollOrder * staggerDuration).toFixed(3));
    rollOrder += 1;
    return delay;
  });
  const [animationRun, setAnimationRun] = useState(0);
  const [isRolling, setIsRolling] = useState(false);
  const isRollingRef = useRef(false);
  const shouldReduceMotion = useReducedMotion();

  const restoreLabel = useCallback(() => {
    isRollingRef.current = false;
    setIsRolling(false);
  }, []);

  const startSwap = useCallback(() => {
    if (shouldReduceMotion || isRollingRef.current) return;
    isRollingRef.current = true;
    setAnimationRun((current) => current + 1);
    setIsRolling(true);
  }, [shouldReduceMotion]);

  const handleFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    startSwap();
    onFocus?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLAnchorElement>) => {
    restoreLabel();
    onBlur?.(event);
  };

  const handleMouseEnter = (event: MouseEvent<HTMLAnchorElement>) => {
    startSwap();
    onMouseEnter?.(event);
  };

  const handleMouseLeave = (event: MouseEvent<HTMLAnchorElement>) => {
    restoreLabel();
    onMouseLeave?.(event);
  };

  return (
    <motion.a
      aria-label={label}
      className={cn("inline-flex whitespace-nowrap", className)}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      {leading}
      <span aria-hidden="true" className="relative z-[1] inline-flex">
        {sourceCharacters.map((character, index) => {
          const isWhitespace = character.trim().length === 0;
          const rollDelay = rollDelays[index] ?? 0;
          const characterTransition = {
            ...transition,
            delay: rollDelay,
          };

          return (
            <span
              className="relative inline-block overflow-hidden align-bottom"
              data-character={character}
              data-roll-delay={rollDelay}
              data-slot="random-letter-swap-character"
              key={`${index}-${character}`}
            >
              <span className="invisible" data-slot="random-letter-swap-character-size">
                {isWhitespace ? "\u00a0" : character}
              </span>
              {!isRolling || shouldReduceMotion || isWhitespace ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  {isWhitespace ? "\u00a0" : character}
                </span>
              ) : (
                <>
                  <motion.span
                    animate={{ y: "-100%" }}
                    className="pointer-events-none absolute inset-0 flex items-center justify-center will-change-transform"
                    data-roll-layer="outgoing"
                    initial={{ y: 0 }}
                    key={`outgoing-${animationRun}-${index}-${character}`}
                    transition={characterTransition}
                  >
                    {character}
                  </motion.span>
                  <motion.span
                    animate={{ y: 0 }}
                    className="pointer-events-none absolute inset-0 flex items-center justify-center will-change-transform"
                    data-roll-layer="incoming"
                    initial={{ y: "100%" }}
                    key={`incoming-${animationRun}-${index}-${character}`}
                    transition={characterTransition}
                  >
                    {character}
                  </motion.span>
                </>
              )}
            </span>
          );
        })}
      </span>
    </motion.a>
  );
}

export type { RandomLetterSwapProps };
