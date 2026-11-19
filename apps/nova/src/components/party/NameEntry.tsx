import { useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { PartyShellHeader } from "./PartyShellHeader";

export const MAX_PLAYER_NAME_LENGTH = 24;

/**
 * Full-page "What's your name?" step. Players must have a real name before
 * they start or join a party; the same screen edits it later.
 */
export function NameEntry({
  initialName = "",
  title = "What's your name?",
  description = "Your friends will see this in the party.",
  submitLabel = "Let's go",
  onSubmit,
  secondary,
}: {
  initialName?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  onSubmit: (name: string) => void;
  /** Optional extra action under the form (e.g. Back, or a resume banner). */
  secondary?: ReactNode;
}) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  return (
    <section className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 text-center">
      <PartyShellHeader />
      <form
        className="glass flex w-full flex-col items-center gap-4 rounded-2xl p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed.length === 0) return;
          onSubmit(trimmed);
        }}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-black">{title}</h1>
          <p className="text-sm text-foreground/70">{description}</p>
        </div>
        <label htmlFor="player-name" className="sr-only">
          Your player name
        </label>
        <input
          id="player-name"
          className="input w-full text-center text-lg font-bold"
          placeholder="Your name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_PLAYER_NAME_LENGTH}
          autoComplete="nickname"
          // The whole screen exists to collect this one field.
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <Button type="submit" variant="primary" size="lg" disabled={trimmed.length === 0}>
          {submitLabel}
        </Button>
      </form>
      {secondary}
    </section>
  );
}
