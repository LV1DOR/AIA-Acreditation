"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NotificationPresentation } from "../lib/notification-presentation.ts";
import { NotificationBadge } from "./notification-badge.tsx";
import { NotificationItem } from "./notification-item.tsx";
import { MarkAllNotificationsRead } from "./mark-all-notifications-read.tsx";
import { PortalIcon } from "./portal-icon.tsx";

export function NotificationMenu({ unread: initialUnread, label, title, unreadLabel, markAllRead, emptyTitle, emptyText, viewAll, allHref, items }: { unread:number; label:string; title:string; unreadLabel:string; markAllRead:string; emptyTitle:string; emptyText:string; viewAll:string; allHref:string; items:NotificationPresentation[] }) {
  const [unread,setUnread]=useState(initialUnread);
  const [open,setOpen]=useState(false);
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    function outside(event:MouseEvent){if(container.current&&!container.current.contains(event.target as Node))setOpen(false);}
    function escape(event:KeyboardEvent){if(event.key==="Escape")setOpen(false);}
    document.addEventListener("mousedown",outside);document.addEventListener("keydown",escape);
    return()=>{document.removeEventListener("mousedown",outside);document.removeEventListener("keydown",escape);};
  },[]);
  function toggle(){setOpen(value=>!value);}
  function itemRead(){setUnread(value=>Math.max(0,value-1));setOpen(false);}
  return <div className="notification-menu" ref={container}><NotificationBadge count={unread} label={label} expanded={open} onClick={toggle}><PortalIcon name="bell"/></NotificationBadge>{open&&<section className="notification-popover" role="dialog" aria-label={label}><header><strong>{title}</strong><div>{unread>0&&<span>{unread}</span>}<MarkAllNotificationsRead label={markAllRead} disabled={unread===0} onMarked={()=>setUnread(0)}/></div></header><div className="notification-popover-list">{items.length?items.slice(0,5).map(item=><NotificationItem key={item.id} item={item} compact forceRead={unread===0} unreadLabel={unreadLabel} onRead={itemRead}/>):<div className="notification-empty"><span><PortalIcon name="bell"/></span><strong>{emptyTitle}</strong><p>{emptyText}</p></div>}</div><Link href={allHref} className="notification-view-all" onClick={()=>setOpen(false)}>{viewAll}<PortalIcon name="arrow" size={16}/></Link></section>}</div>;
}
