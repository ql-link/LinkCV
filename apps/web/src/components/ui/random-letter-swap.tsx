import {
  motion,
  useReducedMotion,
  type HTMLMotionProps,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
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

const FALLBACK_CHARACTERS = Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
const SWAP_ROUNDS = 3;
const ROUND_DURATION_MS = 44;

function pickReplacement(character: string, pool: string[]) {
  const alternatives = pool.filter((candidate) => candidate !== character);
  const candidates = alternatives.length > 0
    ? alternatives
    : FALLBACK_CHARACTERS.filter((candidate) => candidate !== character);

  return candidates[Math.floor(Math.random() * candidates.length)] ?? character;
}

export function RandomLetterSwap({
  className,
  label,
  leading,
  staggerDuration = 0.025,
  transition = { duration: 0.6, type: "spring" },
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
  ...props
}: RandomLetterSwapProps) {
  const sourceCharacters = useMemo(() => Array.from(label), [label]);
  const replacementPool = useMemo(
    () => sourceCharacters.filter((character) => character.trim().length > 0),
    [sourceCharacters],
  );
  const [characters, setCharacters] = useState(sourceCharacters);
  const timersRef = useRef<number[]>([]);
  const shouldReduceMotion = useReducedMotion();

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const restoreLabel = useCallback(() => {
    clearTimers();
    setCharacters(sourceCharacters);
  }, [clearTimers, sourceCharacters]);

  const startSwap = useCallback(() => {
    clearTimers();
    setCharacters(sourceCharacters);

    if (shouldReduceMotion) return;

    sourceCharacters.forEach((character, index) => {
      if (character.trim().length === 0) return;

      const staggerMs = index * staggerDuration * 1000;

      for (let round = 0; round < SWAP_ROUNDS; round += 1) {
        const timer = window.setTimeout(() => {
          setCharacters((current) => {
            const next = [...current];
            next[index] = pickReplacement(character, replacementPool);
            return next;
          });
        }, staggerMs + round * ROUND_DURATION_MS);
        timersRef.current.push(timer);
      }

      const restoreTimer = window.setTimeout(() => {
        setCharacters((current) => {
          const next = [...current];
          next[index] = character;
          return next;
        });
      }, staggerMs + SWAP_ROUNDS * ROUND_DURATION_MS);
      timersRef.current.push(restoreTimer);
    });
  }, [clearTimers, replacementPool, shouldReduceMotion, sourceCharacters, staggerDuration]);

  useEffect(() => {
    clearTimers();
    setCharacters(sourceCharacters);
    return clearTimers;
  }, [clearTimers, shouldReduceMotion, sourceCharacters]);

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
        {characters.map((character, index) => (
          <span className="inline-grid overflow-hidden" key={`${index}-${sourceCharacters[index]}`}>
            <motion.span
              animate={{ opacity: 1, y: 0 }}
              className="col-start-1 row-start-1 inline-block min-w-[0.5ch]"
              initial={shouldReduceMotion ? false : { opacity: 0, y: "0.35em" }}
              key={character}
              transition={shouldReduceMotion ? { duration: 0 } : transition}
            >
              {character === " " ? "\u00a0" : character}
            </motion.span>
          </span>
        ))}
      </span>
    </motion.a>
  );
}

export type { RandomLetterSwapProps };
