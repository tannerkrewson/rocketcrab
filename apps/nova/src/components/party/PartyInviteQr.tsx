import { QRCodeSVG } from "qrcode.react";

export interface PartyInviteQrProps {
  /** Full invite URL (session secret lives in the fragment; ADR-0011). */
  readonly inviteUrl: string;
  readonly size?: number;
  readonly className?: string;
  /**
   * Safe display label under the QR (origin + code, e.g.
   * "rocketcrab.com/abcd"). The full invite URL is NEVER rendered on the
   * page — only the QR itself encodes it (10.5 / ADR-0011).
   */
  readonly label?: string;
}

/**
 * QR invite for a party (P2; engineering rule 13 — qrcode.react, no custom
 * QR encoding). Encodes the invite URL; the private session secret stays in
 * the URL fragment, which is never sent to the static host (ADR-0011). The
 * URL text itself is never rendered — a safe label (origin + code) is shown
 * beneath the code instead, so a screenshot of the page never leaks the
 * secret.
 */
export function PartyInviteQr({ inviteUrl, size = 176, className, label }: PartyInviteQrProps) {
  return (
    <div className={className}>
      <QRCodeSVG
        value={inviteUrl}
        size={size}
        aria-label="Party invite QR code"
        className="rounded-box bg-base-100 p-2"
      />
      {label !== undefined ? (
        <p className="mt-2 break-all text-center text-xs font-semibold text-base-content/60">
          {label}
        </p>
      ) : null}
    </div>
  );
}
