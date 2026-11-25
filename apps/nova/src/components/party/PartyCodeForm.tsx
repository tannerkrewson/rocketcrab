import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { normalizePartyCode } from "../../lib/party/party-code";
import { Button } from "../ui/Button";

/** Type a friend's four-letter party code and open `rocketcrab.com/abcd`. */
export function PartyCodeForm({ backAction }: { backAction?: ReactNode }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const code = normalizePartyCode(value);
  return (
    <form
      className="flex w-full flex-col items-center gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (code !== null) void navigate({ to: "/$code", params: { code } });
      }}
    >
      <label htmlFor="party-code" className="sr-only">
        Party code
      </label>
      <input
        id="party-code"
        className="input w-44 text-center font-title text-3xl font-black placeholder:font-title"
        placeholder="abcd"
        value={value}
        // Letters only, shown lowercase like every code.
        onChange={(event) => setValue(event.target.value.replace(/[^a-z]/gi, "").toLowerCase())}
        maxLength={4}
        inputMode="text"
        enterKeyHint="go"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        // The page exists to collect this one field.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <div className="flex flex-wrap items-center justify-center gap-2">
        {backAction}
        <Button type="submit" variant="primary" size="lg" disabled={code === null}>
          Join party
        </Button>
      </div>
    </form>
  );
}
