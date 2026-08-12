import { QRCodeSVG } from "qrcode.react";

export interface PartyInviteQrProps {
  /** Full invite URL (session secret lives in the fragment; ADR-0011). */
  readonly inviteUrl: string;
  readonly size?: number;
  readonly className?: string;
}

/**
 * QR invite for a party (P2; engineering rule 13 — qrcode.react, no custom
 * QR encoding). Encodes the invite URL; the private session secret stays in
 * the URL fragment, which is never sent to the static host (ADR-0011). The
 * plain URL is shown beneath the code so players can copy it when a channel
 * strips QR payloads.
 */
export function PartyInviteQr({ inviteUrl, size = 176, className }: PartyInviteQrProps) {
  return (
    <div className={className}>
      <QRCodeSVG
        value={inviteUrl}
        size={size}
        aria-label="Party invite QR code"
        className="rounded-box bg-base-100 p-2"
      />
      <p className="mt-2 break-all text-center text-xs text-base-content/60">{inviteUrl}</p>
    </div>
  );
}
