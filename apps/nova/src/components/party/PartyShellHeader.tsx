import { BrandHeader } from "../layout/BrandHeader";

/** The standard rocketcrab.com brand row; not a link, so it can't pull a player out of the party. */
export function PartyShellHeader({
  compact = false,
}: {
  compact?: boolean;
  inviteUrl?: string | null;
}) {
  return (
    <header className="flex justify-center py-3">
      <BrandHeader noLink size={compact ? 24 : 40} />
    </header>
  );
}
