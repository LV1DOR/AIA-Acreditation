"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { IconBell } from "@tabler/icons-react";
import { RefreshCcwIcon } from "lucide-react";
import { PortalIcon } from "./portal-icon.tsx";
import { Badge, type BadgeVariant } from "./ui/badge.tsx";
import { Card, CardFooter, CardHeader, CardTitle } from "./ui/card.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs.tsx";
import { Button } from "./ui/button.tsx";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty.tsx";

type SubmissionRow = {
  id: string;
  company: string;
  peopleCount: number;
  relativeTime: string;
  status: "AIA_REVIEW" | "RETURNED_FOR_CORRECTION";
  statusLabel: string;
  href: string;
};

type Tab = { value: "all" | SubmissionRow["status"]; label: string };

const variants: Record<SubmissionRow["status"], BadgeVariant> = { AIA_REVIEW: "warning", RETURNED_FOR_CORRECTION: "neutral" };

export function SubmissionsReviewCard({ rows, title, allLabel, reviewLabel, correctionsLabel, peopleLabel, emptyLabel, emptyDescription, refreshLabel, viewAllLabel, viewAllHref }: {
  rows: SubmissionRow[];
  title: string;
  allLabel: string;
  reviewLabel: string;
  correctionsLabel: string;
  peopleLabel: string;
  emptyLabel: string;
  emptyDescription: string;
  refreshLabel: string;
  viewAllLabel: string;
  viewAllHref: string;
}) {
  const router = useRouter();
  const tabs = useMemo<Tab[]>(() => [
    { value: "all", label: allLabel },
    { value: "AIA_REVIEW", label: reviewLabel },
    { value: "RETURNED_FOR_CORRECTION", label: correctionsLabel },
  ], [allLabel, correctionsLabel, reviewLabel]);
  return <Card className="submissions-review-card">
    <CardHeader className="submissions-review-header">
      <span className="submissions-review-icon"><PortalIcon name="document" size={19}/></span>
      <CardTitle>{title}</CardTitle>
      <Link href={viewAllHref} aria-label={viewAllLabel}><PortalIcon name="arrow" size={18}/></Link>
    </CardHeader>
    <Tabs defaultValue="all">
      <TabsList variant="line" aria-label={title}>{tabs.map(tab => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}<Badge variant="neutral">{tab.value === "all" ? rows.length : rows.filter(row => row.status === tab.value).length}</Badge></TabsTrigger>)}</TabsList>
      {tabs.map(tab => {
        const matching = (tab.value === "all" ? rows : rows.filter(row => row.status === tab.value)).slice(0, 7);
        return <TabsContent key={tab.value} value={tab.value}>
          {matching.length ? <ul className="submission-review-list">{matching.map(row => <li key={row.id}><Link href={row.href}>
            <span className="submission-company-avatar" aria-hidden="true"><PortalIcon name="building" size={20}/></span>
            <span className="submission-company"><strong>{row.company}</strong><small>{row.peopleCount} {peopleLabel.toLocaleLowerCase()}</small></span>
            <time>{row.relativeTime}</time>
            <Badge variant={variants[row.status]}>{row.statusLabel}</Badge>
            <PortalIcon name="arrow" size={17}/>
          </Link></li>)}</ul> : <Empty className="submission-review-empty"><EmptyHeader><EmptyMedia variant="icon"><IconBell size={22}/></EmptyMedia><EmptyTitle>{emptyLabel}</EmptyTitle><EmptyDescription>{emptyDescription}</EmptyDescription></EmptyHeader><EmptyContent><Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}><RefreshCcwIcon size={15} data-icon="inline-start"/>{refreshLabel}</Button></EmptyContent></Empty>}
        </TabsContent>;
      })}
    </Tabs>
    <CardFooter><Link href={viewAllHref}>{viewAllLabel}<PortalIcon name="arrow" size={16}/></Link></CardFooter>
  </Card>;
}
