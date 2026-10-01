import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export function Card({ className, ...props }: ComponentProps<"section">) { return <section className={cn("ui-card", className)} {...props}/>; }
export function CardHeader({ className, ...props }: ComponentProps<"header">) { return <header className={cn("ui-card-header", className)} {...props}/>; }
export function CardTitle({ className, ...props }: ComponentProps<"h3">) { return <h3 className={cn("ui-card-title", className)} {...props}/>; }
export function CardDescription({ className, ...props }: ComponentProps<"p">) { return <p className={cn("ui-card-description", className)} {...props}/>; }
export function CardAction({ className, ...props }: ComponentProps<"div">) { return <div className={cn("ui-card-action", className)} {...props}/>; }
export function CardFooter({ className, ...props }: ComponentProps<"footer">) { return <footer className={cn("ui-card-footer", className)} {...props}/>; }
