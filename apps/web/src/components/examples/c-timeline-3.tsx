// Adapted from REUI @reui/c-timeline-3 installed with the shadcn CLI.
// The order-status sample is replaced with verified email observations.
import { Check, Clock, Mail, Ban, TriangleAlert, MessageSquareWarning } from "lucide-react";
import type { Locale } from "@aia/i18n";
import type { monitoredEmailDetail } from "@aia/domain";
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "../reui/timeline.tsx";
import { emailCopy, emailStatusLabels } from "../../lib/email-monitoring-copy.ts";
import { emailInvestigationCopy, emailEventExplanation } from "../../lib/email-investigation-copy.ts";

type Events = Awaited<ReturnType<typeof monitoredEmailDetail>>["events"];
export function EmailEventsTimeline({ locale, events }: { locale: Locale; events: Events }) {
  const t = emailCopy[locale], c = emailInvestigationCopy[locale];
  const format = new Intl.DateTimeFormat(locale === "pt" ? "pt-PT" : "en-GB", { timeZone: "Europe/Lisbon", dateStyle: "medium", timeStyle: "medium" });
  return <Timeline value={events.length} render={<ol/>} aria-label={c.events} className="email-event-track">
    {events.map((event, index) => {
      const status = event.type.replace("email.", "").toUpperCase();
      const tone = status === "DELIVERED" ? "success" : ["FAILED", "BOUNCED", "SUPPRESSED", "COMPLAINED"].includes(status) ? "danger" : status === "DELIVERY_DELAYED" ? "warning" : "neutral";
      const Icon = status === "DELIVERED" ? Check : status === "DELIVERY_DELAYED" ? Clock : status === "COMPLAINED" ? MessageSquareWarning : status === "SUPPRESSED" ? Ban : tone === "danger" ? TriangleAlert : Mail;
      const explanation = emailEventExplanation(locale, event.reasonCode, status);
      return <TimelineItem key={event.id} step={index + 1} render={<li/>} className={`email-event-item email-event-${tone}`}>
        <TimelineHeader>
          <TimelineSeparator className="email-event-line"/>
          <TimelineDate dateTime={event.occurredAt.toISOString()} className="email-event-date">{format.format(event.occurredAt)}</TimelineDate>
          <TimelineTitle className="email-event-title">{emailStatusLabels[locale][status] ?? t.unknown}</TimelineTitle>
          <TimelineIndicator className="email-event-indicator"><Icon size={14} strokeWidth={2} aria-hidden="true"/></TimelineIndicator>
        </TimelineHeader>
        <TimelineContent className="email-event-content">
          {explanation.title !== emailStatusLabels[locale][status] && <p className="email-event-reason"><strong>{explanation.title}</strong></p>}
          <p>{explanation.description}</p>
          <details className="emails-technical"><summary>{c.technical}</summary>
            {event.providerMessage && <div><h4>{c.providerMessage}</h4><pre>{event.providerMessage}</pre></div>}
            {event.smtpResponse && <div><h4>{c.smtp}</h4><pre>{event.smtpResponse}</pre></div>}
            {!event.providerMessage && !event.smtpResponse && <p>{c.noDiagnostics}</p>}
            <dl><div><dt>{c.received}</dt><dd><time dateTime={event.receivedAt.toISOString()}>{format.format(event.receivedAt)}</time></dd></div><div><dt>{t.providerId}</dt><dd>{event.resendEmailId ?? t.unknown}</dd></div><div><dt>{t.webhookId}</dt><dd>{event.svixId}</dd></div></dl>
          </details>
        </TimelineContent>
      </TimelineItem>;
    })}
  </Timeline>;
}