"use client";

import * as SeparatorPrimitive from "@radix-ui/react-separator";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export function Separator({ className, orientation = "horizontal", decorative = true, ...props }: ComponentProps<typeof SeparatorPrimitive.Root>) {
  return <SeparatorPrimitive.Root decorative={decorative} orientation={orientation} className={cn("ui-separator", className)} {...props}/>;
}
