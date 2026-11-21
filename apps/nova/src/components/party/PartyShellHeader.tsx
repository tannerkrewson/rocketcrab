import { BrandHeader } from "../layout/BrandHeader";

/** The shared brand row with the party header spacing. */
export function PartyShellHeader() {
  return (
    <header className="flex justify-center py-3">
      <BrandHeader />
    </header>
  );
}
