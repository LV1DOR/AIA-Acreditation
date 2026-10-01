"use client";
import { UserButton } from "@clerk/nextjs";
import { useEffect, useState } from "react";
export function AccountControls() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return <div className="account-controls">
    {mounted ? <UserButton appearance={{ elements: { avatarBox: "portal-account-avatar" } }} /> : <span className="account-avatar-placeholder" aria-hidden="true" />}
  </div>;
}
