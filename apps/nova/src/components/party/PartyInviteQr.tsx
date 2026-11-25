import { QRCodeCanvas } from "qrcode.react";

/**
 * The invite as a QR code that fills its container, so phones can scan it
 * from across a room. A canvas keeps the fragment secret out of the DOM,
 * which session replay records. The white margin is the quiet zone that
 * cameras need to find the code.
 */
export function PartyInviteQr({ inviteUrl }: { readonly inviteUrl: string }) {
  return (
    <QRCodeCanvas
      value={inviteUrl}
      size={640}
      marginSize={3}
      role="img"
      aria-label="Party invite QR code"
      className="block aspect-square h-auto w-full rounded-2xl"
      style={{ width: "100%", height: "auto" }}
    />
  );
}
