import { BrandLogo } from "../layout/BrandLogo";
export function PartyShellHeader({
  compact = false,
}: {
  compact?: boolean;
  inviteUrl?: string | null;
}) {
  return (
    <header className="flex flex-col items-center gap-2 py-3 text-center">
      <BrandLogo size={compact ? 24 : 40} />
      <span className="text-xl font-bold">Nova party</span>
    </header>
  );
}
