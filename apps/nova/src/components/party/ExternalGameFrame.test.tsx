import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExternalGameFrame } from "./ExternalGameFrame";

const ROOM = { url: "https://protobowl.com/rocketcrab-1" };

function frameSrc(): string {
  return (screen.getByTitle("Protobowl") as HTMLIFrameElement).getAttribute("src") ?? "";
}

describe("ExternalGameFrame", () => {
  it("joins with the player's name and the room creator's host flag", () => {
    render(
      <ExternalGameFrame
        gameId="protobowl"
        title="Protobowl"
        room={ROOM}
        displayName="Ada"
        isHost
      />,
    );
    expect(frameSrc()).toBe(
      "https://protobowl.com/rocketcrab-1?rocketcrab=true&name=Ada&ishost=true",
    );
  });

  it("keeps the frame URL when the player renames mid-game", () => {
    const { rerender } = render(
      <ExternalGameFrame
        gameId="protobowl"
        title="Protobowl"
        room={ROOM}
        displayName="Ada"
        isHost={false}
      />,
    );
    const before = frameSrc();
    rerender(
      <ExternalGameFrame
        gameId="protobowl"
        title="Protobowl"
        room={ROOM}
        displayName="Ada Lovelace"
        isHost={false}
      />,
    );
    expect(frameSrc()).toBe(before);
  });

  it("shows a message instead of a frame for a room off the game's site", () => {
    render(
      <ExternalGameFrame
        gameId="protobowl"
        title="Protobowl"
        room={{ url: "https://evil.example/" }}
        displayName="Ada"
        isHost={false}
      />,
    );
    expect(screen.queryByTitle("Protobowl")).not.toBeInTheDocument();
    expect(
      screen.getByText("Protobowl's room points outside the game's site."),
    ).toBeInTheDocument();
  });
});
