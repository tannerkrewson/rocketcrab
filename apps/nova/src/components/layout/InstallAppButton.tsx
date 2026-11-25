import { installApp, useAppInstallAvailable } from "../../lib/app-install";
import { Button, type ButtonSize } from "../ui/Button";

/** Offer to add rocketcrab to the home screen or dock, only where that works. */
export function InstallAppButton({
  size = "lg",
  className,
}: {
  size?: ButtonSize;
  className?: string;
}) {
  const available = useAppInstallAvailable();
  if (!available) return null;
  return (
    <Button variant="accent" size={size} className={className} onClick={installApp}>
      {/* Larger than an icon, so the crab overhangs the label line slightly. */}
      <img
        src="/rocketcrab-logo-no-glow.svg"
        alt=""
        className={size === "lg" ? "-my-2 size-9" : "-my-2 size-8"}
      />
      Get the app
    </Button>
  );
}
