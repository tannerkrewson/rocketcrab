import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScreenshotCarousel } from "./ScreenshotCarousel";

/** jsdom cannot measure layout; e2e/game-detail.spec.ts checks the real row. */
describe("ScreenshotCarousel", () => {
  const images = ["/shots/one.png", "/shots/two.png", "/shots/three.png"];

  it("renders every screenshot with per-image alt text, in order", () => {
    render(<ScreenshotCarousel images={images} gameName="Drawphone" />);

    expect(screen.getByAltText("Drawphone screenshot 1")).toHaveAttribute("src", "/shots/one.png");
    expect(screen.getByAltText("Drawphone screenshot 2")).toHaveAttribute("src", "/shots/two.png");
    expect(screen.getByAltText("Drawphone screenshot 3")).toHaveAttribute(
      "src",
      "/shots/three.png",
    );
  });

  it("is a scroll-snapping row that never grows past its column", () => {
    render(<ScreenshotCarousel images={images} gameName="Drawphone" />);

    const row = screen.getByTestId("screenshot-row");
    expect(row).toHaveClass("overflow-x-auto", "snap-x", "max-w-full");
    expect(screen.getAllByRole("listitem")).toHaveLength(images.length);
  });

  it("keeps the same image nodes across re-renders (no reload/flicker loop)", () => {
    const { container, rerender } = render(
      <ScreenshotCarousel images={images} gameName="Drawphone" />,
    );
    const nodes = [...container.querySelectorAll("img")];
    rerender(<ScreenshotCarousel images={images} gameName="Drawphone" />);
    expect([...container.querySelectorAll("img")]).toEqual(nodes);
  });

  it("renders nothing when there are no screenshots", () => {
    const { container } = render(<ScreenshotCarousel images={[]} gameName="Drawphone" />);

    expect(container).toBeEmptyDOMElement();
  });
});
