"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion, type Transition, type Variants } from "motion/react";
import { X } from "lucide-react";
import { useClickOutside } from "@/hooks/use-click-outside";
import { cn } from "@/lib/utils";

const transition: Transition = { type:"spring", bounce:.08, duration:.38 };
type ContextValue = { isOpen:boolean; open:()=>void; close:()=>void; uniqueId:string; variants?:Variants };
const Context = createContext<ContextValue | null>(null);

function useLogic({ defaultOpen=false, open:controlled, onOpenChange }:{ defaultOpen?:boolean; open?:boolean; onOpenChange?:(open:boolean)=>void }) {
  const uniqueId=useId(); const [uncontrolled,setUncontrolled]=useState(defaultOpen); const isOpen=controlled??uncontrolled;
  const set=useCallback((value:boolean)=>{ if(controlled===undefined) setUncontrolled(value); onOpenChange?.(value); },[controlled,onOpenChange]);
  return { isOpen, open:useCallback(()=>set(true),[set]), close:useCallback(()=>set(false),[set]), uniqueId };
}

export function MorphingPopover({ children, transition:configured=transition, defaultOpen, open, onOpenChange, variants, className, ...props }:{ children:ReactNode; transition?:Transition; defaultOpen?:boolean; open?:boolean; onOpenChange?:(open:boolean)=>void; variants?:Variants } & ComponentProps<"div">) {
  const logic=useLogic({defaultOpen,open,onOpenChange});
  return <Context.Provider value={{...logic,variants}}><MotionConfig transition={configured}><div className={cn("relative",className)} {...props}>{children}</div></MotionConfig></Context.Provider>;
}

export function MorphingPopoverTrigger({ children, className, ...props }:{ children:ReactNode; className?:string } & ComponentProps<typeof motion.button>) {
  const context=useContext(Context); if(!context) throw new Error("MorphingPopoverTrigger must be used within MorphingPopover");
  return <motion.button {...props} type="button" layoutId={`popover-trigger-${context.uniqueId}`} onClick={context.open} className={className} aria-expanded={context.isOpen} aria-controls={`popover-content-${context.uniqueId}`}>{children}</motion.button>;
}

export function MorphingPopoverContent({ children, className, ...props }:{ children:ReactNode; className?:string } & ComponentProps<typeof motion.div>) {
  const context=useContext(Context); if(!context) throw new Error("MorphingPopoverContent must be used within MorphingPopover");
  const ref=useRef<HTMLDivElement>(null); const [mounted,setMounted]=useState(false);
  useClickOutside(ref,context.close);
  useEffect(()=>setMounted(true),[]);
  useEffect(()=>{ if(!context.isOpen) return; const previous=document.activeElement as HTMLElement|null; const key=(event:KeyboardEvent)=>{if(event.key==="Escape") context.close();}; document.addEventListener("keydown",key); requestAnimationFrame(()=>ref.current?.focus()); return()=>{document.removeEventListener("keydown",key);previous?.focus();}; },[context.close,context.isOpen]);
  if(!mounted) return null;
  return <AnimatePresence>{context.isOpen&&<motion.div className="morphing-popover-layer" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}><motion.button className="morphing-popover-backdrop" type="button" aria-label="Close" onClick={context.close}/><motion.div {...props} ref={ref} tabIndex={-1} layoutId={`popover-trigger-${context.uniqueId}`} id={`popover-content-${context.uniqueId}`} role="dialog" aria-modal="true" className={cn("morphing-popover-content",className)} initial="initial" animate="animate" exit="exit" variants={context.variants??{initial:{opacity:0,y:18,scale:.965,filter:"blur(5px)"},animate:{opacity:1,y:0,scale:1,filter:"blur(0px)"},exit:{opacity:0,y:10,scale:.98,filter:"blur(3px)"}}}><button type="button" className="morphing-popover-close" onClick={context.close} aria-label="Close"><X size={19}/></button>{children}</motion.div></motion.div>}</AnimatePresence>;
}

export function MorphingPopoverClose({ children, className, ...props }:ComponentProps<typeof motion.button>) {
  const context=useContext(Context); if(!context) throw new Error("MorphingPopoverClose must be used within MorphingPopover");
  return <motion.button {...props} type="button" onClick={context.close} className={className}>{children}</motion.button>;
}
