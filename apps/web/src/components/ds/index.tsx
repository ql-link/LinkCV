import {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import brandMark from "../../assets/linkcv-mark.svg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "text" | "danger";
  size?: "sm" | "md";
  icon?: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`ds-button ds-press ds-button-${variant} ds-button-${size} ${className}`.trim()}
      type={type}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  variant?: "ghost" | "circular";
  danger?: boolean;
};

export function IconButton({
  label,
  variant = "ghost",
  danger = false,
  className = "",
  children,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`ds-icon-button ds-press ds-icon-button-${variant}${danger ? " is-danger" : ""} ${className}`.trim()}
      title={props.title ?? label}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: ReactNode;
};

export function Pill({ active = false, icon, className = "", children, type = "button", ...props }: PillProps) {
  return (
    <button
      aria-pressed={active}
      className={`ds-pill ds-press${active ? " is-active" : ""} ${className}`.trim()}
      type={type}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function TextInput({ label, hint, className = "", ...props }: TextInputProps) {
  return (
    <label className={`ds-field ${className}`.trim()}>
      <span className="ds-field-label">{label}</span>
      <input className="ds-text-input" {...props} />
      {hint && <span className="ds-field-hint">{hint}</span>}
    </label>
  );
}

type CardProps = HTMLAttributes<HTMLElement> & {
  icon: ReactNode;
  title: string;
  caption: string;
  onOpen: () => void;
  action?: ReactNode;
};

export function Card({ icon, title, caption, onOpen, action, className = "", ...props }: CardProps) {
  return (
    <article className={`ds-card ${className}`.trim()} {...props}>
      <button className="ds-card-main" type="button" onClick={onOpen}>
        <span className="ds-card-icon">{icon}</span>
        <strong className="ds-card-title">{title}</strong>
        <span className="ds-card-caption">{caption}</span>
      </button>
      {action}
    </article>
  );
}

export function Toast({ kind = "success", children }: { kind?: "success" | "error"; children: ReactNode }) {
  return (
    <div className={`ds-toast is-${kind}`} role="status" aria-live="polite">
      {children}
    </div>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: Array<{ label: string; value: string }>;
};

export function Select({ label, options, className = "", ...props }: SelectProps) {
  return (
    <select aria-label={label} className={`ds-select ${className}`.trim()} {...props}>
      {options.map((option) => (
        <option key={option.label} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

type StepperProps = {
  label: string;
  value: number;
  step?: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

export function Stepper({ label, value, step = 1, min, max, onChange }: StepperProps) {
  const change = (direction: -1 | 1) => {
    const precision = step < 1 ? 2 : 0;
    onChange(Math.min(max, Math.max(min, Number((value + step * direction).toFixed(precision)))));
  };

  return (
    <div className="ds-stepper" aria-label={label}>
      <span>{label}</span>
      <button type="button" onClick={() => change(-1)} aria-label={`${label}减小`}>
        −
      </button>
      <strong>{value}</strong>
      <button type="button" onClick={() => change(1)} aria-label={`${label}增大`}>
        +
      </button>
    </div>
  );
}

export function Brand({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  return (
    <span className={`ds-brand ${className}`.trim()} aria-label="LinkCV">
      <span className="ds-brand-mark" aria-hidden="true">
        <img src={brandMark} alt="" />
      </span>
      {!compact && <span className="ds-brand-name">LinkCV</span>}
    </span>
  );
}
