"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, variant = "default", ...props }: ComponentProps<typeof TabsPrimitive.List> & { variant?: "default" | "line" }) {
  return <TabsPrimitive.List className={cn("ui-tabs-list", variant === "line" && "ui-tabs-line", className)} {...props}/>;
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) { return <TabsPrimitive.Trigger className={cn("ui-tabs-trigger", className)} {...props}/>; }
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) { return <TabsPrimitive.Content className={cn("ui-tabs-content", className)} {...props}/>; }
