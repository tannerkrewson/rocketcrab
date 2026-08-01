import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadingState } from "./LoadingState";

describe("LoadingState", () => {
  it("renders a status region with a label", () => {
    render(<LoadingState label="Starting arena…" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Starting arena…")).toBeInTheDocument();
  });

  it("defaults the label", () => {
    render(<LoadingState />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
