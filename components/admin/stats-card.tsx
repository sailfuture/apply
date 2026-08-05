"use client";

import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: number | string;
  description?: string;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  /** When set, the whole card is a link to that page — the dashboard
   *  tiles each jump to the list they summarize. */
  href?: string;
}

export function StatsCard({
  title,
  value,
  description,
  icon,
  trend,
  href,
}: StatsCardProps) {
  const card = (
    <Card
      className={cn(
        href &&
          "h-full transition-colors hover:border-foreground/30 hover:bg-muted/30"
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {(description || trend) && (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {trend && (
              <span
                className={cn(
                  "font-medium",
                  trend.value >= 0
                    ? "text-emerald-600"
                    : "text-red-600"
                )}
              >
                {trend.value >= 0 ? "+" : ""}
                {trend.value}%
              </span>
            )}
            {trend && <span>{trend.label}</span>}
            {description && !trend && <span>{description}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {card}
    </Link>
  ) : (
    card
  );
}
