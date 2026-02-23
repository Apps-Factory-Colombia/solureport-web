"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; positive: boolean };
  accentColor?: "gold" | "cyan" | "green" | "red";
}

const accentStyles = {
  gold: {
    iconBg: "bg-gold/10",
    iconColor: "text-gold",
    glow: "glow-gold",
  },
  cyan: {
    iconBg: "bg-cyan-neon/10",
    iconColor: "text-cyan-neon",
    glow: "glow-cyan",
  },
  green: {
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-500",
    glow: "",
  },
  red: {
    iconBg: "bg-red-500/10",
    iconColor: "text-red-500",
    glow: "",
  },
};

export function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accentColor = "gold",
}: StatsCardProps) {
  const styles = accentStyles[accentColor];

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm hover:border-border transition-all duration-300">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold text-foreground">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
            {trend && (
              <p
                className={cn(
                  "text-xs font-medium",
                  trend.positive ? "text-emerald-500" : "text-red-500"
                )}
              >
                {trend.positive ? "↑" : "↓"} {Math.abs(trend.value)}% vs. mes
                anterior
              </p>
            )}
          </div>
          <div className={cn("rounded-xl p-3", styles.iconBg)}>
            <Icon className={cn("h-6 w-6", styles.iconColor)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
