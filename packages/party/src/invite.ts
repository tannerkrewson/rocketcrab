import { sessionSecretSchema } from "@rocketcrab/protocol";

export interface InviteLinkData {
  readonly secret: string;
}
/** Request paths and queries never contain invite credentials. */
export function buildInviteUrl(options: {
  readonly baseUrl: string;
  readonly secret: string;
}): string {
  const secret = sessionSecretSchema.safeParse(options.secret);
  if (!secret.success) throw new Error("Invalid invite secret.");
  const base = new URL(options.baseUrl);
  base.search = "";
  base.hash = new URLSearchParams({ secret: secret.data }).toString();
  return base.toString();
}
export function parseInviteFragment(fragment: string): InviteLinkData | null {
  const params = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : fragment);
  const secret = sessionSecretSchema.safeParse(params.get("secret"));
  return secret.success ? { secret: secret.data } : null;
}
export function parseInviteUrl(url: string): InviteLinkData | null {
  const index = url.indexOf("#");
  return index < 0 ? null : parseInviteFragment(url.slice(index));
}
