import * as React from "react";
import { cn } from "@/lib/utils";
export const Input=React.forwardRef<HTMLInputElement,React.ComponentProps<"input">>(({className,type,...props},ref)=><input ref={ref} type={type} className={cn("flex h-9 w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50",className)} {...props}/>);
Input.displayName="Input";
