"use client";

import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps } from "react";
import { Search } from "lucide-react";
import { cn } from "../../lib/utils.ts";

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) { return <CommandPrimitive className={cn("country-command", className)} {...props}/>; }
export function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) { return <div className="country-command-input"><Search size={16}/><CommandPrimitive.Input className={className} {...props}/></div>; }
export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) { return <CommandPrimitive.List className={cn("country-command-list", className)} {...props}/>; }
export function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) { return <CommandPrimitive.Empty className="country-command-empty" {...props}/>; }
export function CommandGroup(props: ComponentProps<typeof CommandPrimitive.Group>) { return <CommandPrimitive.Group {...props}/>; }
export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) { return <CommandPrimitive.Item className={cn("country-command-item", className)} {...props}/>; }
