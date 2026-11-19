import { useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { PartyShellHeader } from "./PartyShellHeader";

export const MAX_PLAYER_NAME_LENGTH = 24;

/** The name input and submit button, shared by the name page and the lobby's rename dialog. */
export function NameForm({
  initialName = "",
  submitLabel,
  onSubmit,
  children,
}: {
  initialName?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  /** Extra content above the input (a heading, a hint). */
  children?: ReactNode;
}) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  return (
    <form
      className="flex w-full flex-col items-center gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed.length === 0) return;
        onSubmit(trimmed);
      }}
    >
      {children}
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
        // The form exists to collect this one field.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <Button type="submit" variant="primary" size="lg" disabled={trimmed.length === 0}>
        {submitLabel}
      </Button>
    </form>
  );
}

/**
 * Full-page "What's your name?" step. Players must have a real name before
 * they start or join a party.
 */
export function NameEntry({
  description = "Your friends will see this in the party.",
  submitLabel = "Let's go",
  onSubmit,
  secondary,
}: {
  description?: string;
  submitLabel?: string;
  onSubmit: (name: string) => void;
  /** Optional extra content under the form (e.g. a resume banner, Back). */
  secondary?: ReactNode;
}) {
  return (
    <section className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 text-center">
      <PartyShellHeader />
      <div className="glass w-full rounded-2xl p-6">
        <NameForm submitLabel={submitLabel} onSubmit={onSubmit}>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-black">What&apos;s your name?</h1>
            <p className="text-sm text-foreground/70">{description}</p>
          </div>
        </NameForm>
      </div>
      {secondary}
    </section>
  );
}
