import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const settingsLayoutVariants = cva("ui-settings-layout", {
  variants: {
    variant: {
      framed: "ui-settings-layout--framed",
      plain: "ui-settings-layout--plain",
    },
  },
  defaultVariants: { variant: "framed" },
});

const settingsSectionVariants = cva("ui-settings-section", {
  variants: {
    variant: {
      default: "ui-settings-section--default",
      identity: "ui-settings-section--identity",
      compact: "ui-settings-section--compact",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface SettingsLayoutProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof settingsLayoutVariants> {}

export const SettingsLayout = React.forwardRef<HTMLDivElement, SettingsLayoutProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(settingsLayoutVariants({ variant }), className)} {...props} />
  ),
);

SettingsLayout.displayName = "SettingsLayout";

export interface SettingsSectionProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof settingsSectionVariants> {}

export function SettingsSection({ className, variant, ...props }: SettingsSectionProps) {
  return <section className={cn(settingsSectionVariants({ variant }), className)} {...props} />;
}

export function SettingsSectionHeader({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <header className={cn("ui-settings-section__header", className)} {...props} />;
}

export const SettingsRow = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("ui-settings-row", className)} {...props} />
  ),
);

SettingsRow.displayName = "SettingsRow";

export { settingsLayoutVariants, settingsSectionVariants };
