"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationPresentation } from "../lib/notification-presentation.ts";
import { PortalIcon } from "./portal-icon.tsx";

export function NotificationItem({item,compact=false,forceRead=false,unreadLabel="Unread",onRead}:{item:NotificationPresentation;compact?:boolean;forceRead?:boolean;unreadLabel?:string;onRead?:(id:string)=>void}){
  const router=useRouter();
  const [unread,setUnread]=useState(item.unread);
  const [pending,setPending]=useState(false);

  const isUnread=unread&&!forceRead;
  async function openNotification(){
    if(pending)return;
    setPending(true);
    if(isUnread){
      const response=await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
      if(response.ok){setUnread(false);onRead?.(item.id);}
    }
    router.push(item.href);
    router.refresh();
  }

  return <button type="button" disabled={pending} onClick={openNotification} className={`notification-item${compact?" compact":""}${isUnread?" unread":""}`}><span className="notification-item-icon"><PortalIcon name={item.icon} size={compact?18:21}/></span><span className="notification-item-copy"><strong>{item.title}</strong><span>{item.description}</span><time>{item.time}</time></span>{isUnread&&<span className="notification-unread-dot" aria-label={unreadLabel}/>}<PortalIcon name="arrow" size={17}/></button>;
}
