import * as React from "react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * Shared workspace heading. The `className` escape hatch is intentional: pages
 * can tune their local geometry without inventing another heading pattern.
 */
export const PageHeader = React.forwardRef<HTMLElement, PageHeaderProps>(
  ({ eyebrow, title, description, actions, className, ...props }, ref) => (
    <header ref={ref} className={cn("ui-page-header page-hero", className)} {...props}>
      <div className="ui-page-header__text page-hero-text">
        <p className="ui-page-header__eyebrow page-hero-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="ui-page-header__description page-hero-description">{description}</p>}
      </div>
      {actions && <div className="ui-page-header__actions page-hero-actions">{actions}</div>}
    </header>
  ),
);

PageHeader.displayName = "PageHeader";
