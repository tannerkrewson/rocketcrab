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
      <img src="/icon-192.png" alt="" className="size-6 rounded-md" />
      Get the app
    </Button>
  );
}
