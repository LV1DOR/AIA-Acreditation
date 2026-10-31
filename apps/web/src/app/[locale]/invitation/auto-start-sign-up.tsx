"use client";

import { useEffect, useRef } from "react";
import type { Locale } from "@aia/i18n";
import { startInvitedSignUp } from "./actions.ts";

export function AutoStartInvitedSignUp({ locale, autoStart, retryLabel }: {
  locale: Locale;
  autoStart: boolean;
  retryLabel: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (!autoStart || submitted.current) return;
    submitted.current = true;
    form.current?.requestSubmit();
  }, [autoStart]);

  return <form ref={form} action={startInvitedSignUp}>
    <input type="hidden" name="locale" value={locale}/>
    {!autoStart && <button className="button primary" type="submit">{retryLabel}</button>}
  </form>;
}
