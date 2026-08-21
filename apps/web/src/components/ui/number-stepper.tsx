import { Minus, Plus } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";

type NumberStepperProps = {
  label: string;
  value: number;
  step?: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

export function NumberStepper({ label, value, step = 1, min, max, onChange }: NumberStepperProps) {
  const change = (direction: -1 | 1) => {
    const precision = step < 1 ? 2 : 0;
    onChange(Math.min(max, Math.max(min, Number((value + step * direction).toFixed(precision)))));
  };

  return (
    <div aria-label={label} className="ui-number-stepper flex h-9 items-center gap-1 rounded-full border border-border bg-surface px-1 shadow-xs" data-slot="number-stepper">
      <span className="pl-2 text-xs text-muted-foreground">{label}</span>
      <IconButton className="size-7" disabled={value <= min} label={`${label}减小`} onClick={() => change(-1)}><Minus size={13} /></IconButton>
      <strong className="min-w-8 text-center text-xs tabular-nums">{value}</strong>
      <IconButton className="size-7" disabled={value >= max} label={`${label}增大`} onClick={() => change(1)}><Plus size={13} /></IconButton>
    </div>
  );
}
