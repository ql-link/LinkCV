import { useId, type InputHTMLAttributes } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  inputClassName?: string;
};

export function TextField({ label, hint, className, inputClassName, id, "aria-label": ariaLabel, ...props }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cn("ui-text-field grid gap-2", className)} data-slot="text-field">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        aria-describedby={hintId}
        aria-label={ariaLabel ?? `${label}${hint ?? ""}`}
        className={inputClassName}
        id={inputId}
        {...props}
      />
      {hint && <span className="text-xs leading-normal text-muted-foreground" id={hintId}>{hint}</span>}
    </div>
  );
}
