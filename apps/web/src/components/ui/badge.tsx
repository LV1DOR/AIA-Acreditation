import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export type BadgeVariant = "default" | "danger" | "warning" | "neutral" | "success";

export function Badge({ className, variant = "default", ...props }: ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return <span className={cn("ui-badge", `ui-badge-${variant}`, className)} {...props}/>;
}
