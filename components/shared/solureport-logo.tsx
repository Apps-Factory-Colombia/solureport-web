import Image from "next/image";
import { cn } from "@/lib/utils";

interface SoluReportLogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { size: 32, text: "text-sm" },
  md: { size: 40, text: "text-lg" },
  lg: { size: 154, text: "text-2xl" },
};

export function SoluReportLogo({
  size = "md",
  showText = false,
  className,
}: SoluReportLogoProps) {
  const s = sizeMap[size];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative">
        <Image
          src="/logo.png"
          alt="SoluReport Logo"
          width={s.size}
          height={s.size}
          className="object-contain"
          priority
        />
      </div>
      {showText && (
        <span className={cn("font-bold text-foreground tracking-tight", s.text)}>
          Solu<span className="text-gold">Report</span>
        </span>
      )}
    </div>
  );
}
