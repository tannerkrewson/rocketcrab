import { cn } from "../../lib/cn";
import { BrandLogo } from "./BrandLogo";

export function BrandHeader({ nova = false, className }: { nova?: boolean; className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-center gap-2 self-center", className)}
      data-testid="browser-brand-row"
    >
      <BrandLogo nova={nova} />
      <span className="font-title shrink-0 text-xl font-black text-foreground">
        rocketcrab<span className={nova ? "text-nova-text" : "text-primary"}>.com</span>
      </span>
    </div>
  );
}
