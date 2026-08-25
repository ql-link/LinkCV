import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const contentFrameVariants = cva("ui-content-frame", {
  variants: {
    variant: {
      default: "ui-content-frame--default",
      narrow: "ui-content-frame--narrow",
      wide: "ui-content-frame--wide",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface ContentFrameProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof contentFrameVariants> {}

/** A width constraint for readable page content; it does not impose card styling. */
export const ContentFrame = React.forwardRef<HTMLDivElement, ContentFrameProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(contentFrameVariants({ variant }), className)} {...props} />
  ),
);

ContentFrame.displayName = "ContentFrame";

export { contentFrameVariants };
