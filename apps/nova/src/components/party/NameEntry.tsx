import { useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { PartyShellHeader } from "./PartyShellHeader";

export const MAX_PLAYER_NAME_LENGTH = 24;

/** The name input and submit button, shared by the name page and the lobby's rename dialog. */
export function NameForm({
  initialName = "",
  submitLabel,
  onSubmit,
  backAction,
  children,
}: {
  initialName?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  backAction?: ReactNode;
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
        Enter your name here
      </label>
      <input
        id="player-name"
        className="input w-full text-left text-lg font-bold"
        placeholder="Enter your name here"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={MAX_PLAYER_NAME_LENGTH}
        autoComplete="nickname"
        // The form exists to collect this one field.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <div className="flex flex-wrap items-center justify-center gap-2">
        {backAction}
        <Button type="submit" variant="primary" size="lg" disabled={trimmed.length === 0}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * The "What's your name?" screen: shown before starting or joining a party,
 * and again (prefilled, without the brand row the lobby already shows) when
 * a player renames themselves from the lobby.
 */
export function NameEntry({
  description = "Your friends will see this in the party.",
  submitLabel = "Let's go",
  initialName,
  showHeader = true,
  onSubmit,
  backAction,
  secondary,
}: {
  description?: string;
  submitLabel?: string;
  initialName?: string;
  /** False where the page already shows the brand row (the lobby). */
  showHeader?: boolean;
  onSubmit: (name: string) => void;
  backAction?: ReactNode;
  /** Optional extra content under the form (e.g. a resume banner). */
  secondary?: ReactNode;
}) {
  return (
    <section className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 text-center">
      {showHeader ? <PartyShellHeader /> : null}
      <div className="glass w-full rounded-2xl p-6">
        <NameForm
          initialName={initialName}
          submitLabel={submitLabel}
          onSubmit={onSubmit}
          backAction={backAction}
        >
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
