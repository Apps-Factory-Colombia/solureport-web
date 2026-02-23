import { Lock, Home } from "lucide-react";
import { cn } from "@/lib/utils";

interface SoluReportLogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { container: "h-8 w-8", icon: "h-4 w-4", text: "text-sm" },
  md: { container: "h-10 w-10", icon: "h-5 w-5", text: "text-lg" },
  lg: { container: "h-16 w-16", icon: "h-8 w-8", text: "text-2xl" },
};

export function SoluReportLogo({
  size = "md",
  showText = false,
  className,
}: SoluReportLogoProps) {
  const s = sizeMap[size];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "relative flex items-center justify-center rounded-xl bg-gradient-to-br from-gold to-gold-dark glow-gold",
          s.container
        )}
      >
        <Lock className={cn("text-background", s.icon)} />
        <div className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-cyan-neon glow-cyan" />
      </div>
      {showText && (
        <div className="flex flex-col">
          <span className={cn("font-bold text-gold leading-tight", s.text)}>
            SoluReport
          </span>
          <span className="text-[10px] text-cyan-neon/70 tracking-wider">
            AUTOMATIZACIONES
          </span>
        </div>
      )}
    </div>
  );
}
