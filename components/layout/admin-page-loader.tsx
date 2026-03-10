"use client";

import { Skeleton } from "@/components/ui/skeleton";

interface AdminPageLoaderProps {
  title?: string;
  message?: string;
  showStats?: boolean;
  statsCount?: number;
  rows?: number;
}

export function AdminPageLoader({
  title = "Cargando información",
  message = "Espera un momento mientras preparamos los datos.",
  showStats = true,
  statsCount = 4,
  rows = 6,
}: AdminPageLoaderProps) {
  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-xl bg-secondary/80" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-52 bg-secondary/60" />
            <Skeleton className="h-3 w-72 bg-secondary/40" />
          </div>
        </div>
        <div className="sr-only">
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
      </div>

      {showStats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: statsCount }).map((_, index) => (
            <div key={`stat-${index}`} className="rounded-2xl border border-border/50 bg-card/80 p-6 backdrop-blur-sm">
              <div className="flex items-start justify-between">
                <div className="space-y-3 flex-1">
                  <Skeleton className="h-3 w-24 bg-secondary/50" />
                  <Skeleton className="h-8 w-16 bg-secondary/80" />
                  <Skeleton className="h-3 w-20 bg-secondary/50" />
                </div>
                <Skeleton className="h-12 w-12 rounded-xl bg-secondary/60" />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Skeleton className="h-10 w-full max-w-sm rounded-xl bg-secondary/60" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-32 rounded-xl bg-secondary/50" />
          <Skeleton className="h-10 w-36 rounded-xl bg-secondary/80" />
        </div>
      </div>

      <div className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
        <div className="border-b border-border/50 p-4">
          <div className="grid grid-cols-4 gap-4 md:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={`head-${index}`} className="h-4 w-full max-w-24 bg-secondary/40" />
            ))}
          </div>
        </div>
        <div className="p-4 space-y-3">
          {Array.from({ length: rows }).map((_, index) => (
            <div key={`row-${index}`} className="grid grid-cols-1 gap-3 rounded-xl border border-border/40 bg-secondary/20 p-4 md:grid-cols-6">
              <Skeleton className="h-4 w-24 bg-secondary/50" />
              <Skeleton className="h-4 w-32 bg-secondary/50" />
              <Skeleton className="h-4 w-28 bg-secondary/50" />
              <Skeleton className="h-4 w-20 bg-secondary/50" />
              <Skeleton className="h-4 w-36 bg-secondary/50" />
              <Skeleton className="h-4 w-16 bg-secondary/50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
