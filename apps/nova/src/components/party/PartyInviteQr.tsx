import { QRCodeCanvas } from "qrcode.react";

export interface PartyInviteQrProps {
  /** Full invite URL (session secret lives in the fragment). */
  readonly inviteUrl: string;
  readonly size?: number;
  readonly className?: string;
  /** Safe text label only; the full secret-bearing URL belongs in the QR. */
  readonly label?: string;
}

/**
 * Encode the fragment-secret invite without rendering its URL as text.
 * A canvas keeps the secret out of the DOM, which session replay records.
 */
export function PartyInviteQr({ inviteUrl, size = 176, className, label }: PartyInviteQrProps) {
  return (
    <div className={className}>
      <QRCodeCanvas
        value={inviteUrl}
        size={size}
        role="img"
        aria-label="Party invite QR code"
        className="rounded-2xl bg-surface p-2"
      />
      {label !== undefined ? (
        <p className="mt-2 break-all text-center text-xs font-semibold text-foreground/60">
          {label}
        </p>
      ) : null}
    </div>
  );
}
