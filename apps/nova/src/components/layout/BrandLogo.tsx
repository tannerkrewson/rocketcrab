/** Decorative brand mark, shared at one size on every page. */
export function BrandLogo({ nova = false }: { nova?: boolean }) {
  return (
    <img
      src={nova ? "/rocketcrab-logo-nova.svg" : "/rocketcrab-logo-no-glow.svg"}
      alt=""
      draggable={false}
      className="block size-14 shrink-0"
      width={56}
      height={56}
      data-testid="brand-logo"
    />
  );
}
