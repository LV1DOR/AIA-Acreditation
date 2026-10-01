"use client";

import { Check, ChevronsUpDown, LoaderCircle, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type { Locale } from "@aia/i18n";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

type EventOption = { id: string; name: string; startDate: Date; endDate: Date };

export function AdminEventSwitcher({ locale, events }: { locale: Locale; events: EventOption[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const selectedId = events.find(event => event.id === params.get("eventId"))?.id ?? events[0]?.id;
  const selected = events.find(event => event.id === selectedId);
  const formatDate = (value: Date) => new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Lisbon" }).format(new Date(value));
  const secondary = (event: EventOption) => `${formatDate(event.startDate)} – ${formatDate(event.endDate)}`;

  function selectEvent(eventId: string) {
    setOpen(false);
    startTransition(() => {
      const next = new URLSearchParams(params.toString());
      next.set("eventId", eventId);
      next.delete("result");
      const root = `/${locale}/admin`;
      if (pathname.startsWith(`${root}/setup`)) { next.delete("wizard"); next.delete("step"); next.delete("section"); }
      const destination = pathname.startsWith(`${root}/companies/`) ? `${root}/companies`
        : pathname.startsWith(`${root}/people/`) ? `${root}/people`
        : pathname.startsWith(`${root}/queue/`) ? `${root}/submissions`
        : pathname.startsWith(`${root}/setup/`) ? `${root}/setup` : pathname;
      router.push(`${destination}?${next.toString()}`);
    });
  }

  function createEvent() {
    setOpen(false);
    startTransition(() => router.push(`/${locale}/admin/setup?wizard=create&step=1`));
  }

  return <div className="admin-event-switcher">
    <span>{locale === "pt" ? "Evento selecionado" : "Selected event"}</span>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" className="admin-event-trigger" aria-expanded={open} aria-haspopup="listbox" disabled={pending}>
        <span><strong>{selected?.name ?? (locale === "pt" ? "Sem eventos" : "No events")}</strong>{selected && <small>{secondary(selected)}</small>}</span>
        {pending ? <LoaderCircle className="event-switcher-spinner" size={17}/> : <ChevronsUpDown size={17}/>}
      </button></PopoverTrigger>
      <PopoverContent className="admin-event-popover" align="start">
        <Command>
          <CommandInput placeholder={locale === "pt" ? "Pesquisar evento…" : "Search events…"}/>
          <CommandList>
            <CommandEmpty>{locale === "pt" ? "Nenhum evento encontrado." : "No event found."}</CommandEmpty>
            <CommandGroup heading={locale === "pt" ? "Eventos" : "Events"}>{events.map(event => <CommandItem key={event.id} value={event.name} keywords={[secondary(event)]} onSelect={() => selectEvent(event.id)} aria-current={event.id === selectedId ? "true" : undefined}>
              <span className="admin-event-option"><strong>{event.name}</strong><small>{secondary(event)}</small></span>
              <Check className={event.id === selectedId ? "event-check visible" : "event-check"} size={16}/>
            </CommandItem>)}</CommandGroup>
          </CommandList>
        </Command>
        <button type="button" className="admin-event-create" onClick={createEvent}><Plus size={17}/>{locale === "pt" ? "Adicionar evento" : "Add event"}</button>
      </PopoverContent>
    </Popover>
  </div>;
}
