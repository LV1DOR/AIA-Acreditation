import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.ts";

export function Empty({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn("ui-empty", className)} {...props}/>; }
export function EmptyHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn("ui-empty-header", className)} {...props}/>; }
export function EmptyMedia({ className, variant, ...props }: HTMLAttributes<HTMLDivElement> & { variant?: "icon" }) { return <div className={cn("ui-empty-media", variant === "icon" && "ui-empty-media-icon", className)} {...props}/>; }
export function EmptyTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) { return <h3 className={cn("ui-empty-title", className)} {...props}/>; }
export function EmptyDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) { return <p className={cn("ui-empty-description", className)} {...props}/>; }
export function EmptyContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn("ui-empty-content", className)} {...props}/>; }
