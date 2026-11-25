import { Copy, QrCode, Share2 } from "lucide-react";
import { useState } from "react";
import { writeToClipboard } from "../../lib/editor/clipboard";
import { toast } from "../../lib/toast";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { PartyInviteQr } from "./PartyInviteQr";

function canNativeShare(url: string | null): boolean {
  if (
    url === null ||
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function"
  ) {
    return false;
  }
  try {
    return navigator.canShare({ url });
  } catch {
    return false;
  }
}

/**
 * The invite actions, shared by the lobby card and the in-game menu. Only
 * safe text renders; the secret stays in the URL fragment and the QR canvas.
 */
export function PartyInvite({ inviteUrl }: { readonly inviteUrl: string | null }) {
  const [qrOpen, setQrOpen] = useState(false);

  const copyInvite = async () => {
    if (inviteUrl === null) return;
    if (await writeToClipboard(inviteUrl)) toast.success("Invite link copied.");
    else toast.danger("Couldn't copy the link — try again.");
  };

  const shareInvite = async () => {
    if (inviteUrl === null || typeof navigator.share !== "function") return;
    try {
      await navigator.share({ title: "Play rocketcrab with me!", url: inviteUrl });
    } catch {
      // The user dismissed the sheet or the platform refused; Copy URL remains.
    }
  };

  return (
    <>
      <div className="button-row">
        <Button variant="primary" size="md" onClick={() => void copyInvite()}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy URL
        </Button>
        <Button
          variant="default"
          soft
          size="md"
          onClick={() => setQrOpen(true)}
          disabled={inviteUrl === null}
        >
          <QrCode className="h-4 w-4" aria-hidden="true" />
          QR Code
        </Button>
        {canNativeShare(inviteUrl) ? (
          <Button
            variant="default"
            soft
            size="md"
            onClick={() => void shareInvite()}
            title="Share the invite link with a friend"
          >
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Share
          </Button>
        ) : null}
      </div>
      <Dialog
        open={qrOpen && inviteUrl !== null}
        onClose={() => setQrOpen(false)}
        title="Scan to join the party"
        className="max-w-md"
      >
        <div className="flex flex-col items-center gap-3 pb-2">
          {inviteUrl !== null ? <PartyInviteQr inviteUrl={inviteUrl} /> : null}
          <p className="text-center text-sm text-foreground/70">
            Point a phone&apos;s camera at the code, then tap the link that appears.
          </p>
        </div>
      </Dialog>
    </>
  );
}
