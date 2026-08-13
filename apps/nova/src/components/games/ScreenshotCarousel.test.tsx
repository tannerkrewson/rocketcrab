import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScreenshotCarousel } from "./ScreenshotCarousel";

/**
 * Screenshot carousel tests (rocketcrab-9fv.7.46): the game detail page's
 * tall portrait screenshots render as a swiper carousel — every image with
 * its alt text, plus a pagination dot per screenshot.
 */
describe("ScreenshotCarousel", () => {
  const images = ["/shots/one.png", "/shots/two.png", "/shots/three.png"];

  it("renders every screenshot tall with per-image alt text", () => {
    render(<ScreenshotCarousel images={images} gameName="Drawphone" />);

    expect(screen.getByAltText("Drawphone screenshot 1")).toHaveAttribute("src", "/shots/one.png");
    expect(screen.getByAltText("Drawphone screenshot 2")).toHaveAttribute("src", "/shots/two.png");
    expect(screen.getByAltText("Drawphone screenshot 3")).toHaveAttribute(
      "src",
      "/shots/three.png",
    );
  });

  it("renders one pagination dot per screenshot", () => {
    const { container } = render(<ScreenshotCarousel images={images} gameName="Drawphone" />);

    expect(container.querySelectorAll(".swiper-pagination-bullet")).toHaveLength(images.length);
  });

  it("uses the swiper carousel container with themed pagination", () => {
    const { container } = render(<ScreenshotCarousel images={images} gameName="Drawphone" />);

    expect(container.querySelector(".swiper.nova-screenshots")).not.toBeNull();
    expect(container.querySelector(".swiper-pagination")).not.toBeNull();
  });

  it("renders nothing when there are no screenshots", () => {
    const { container } = render(<ScreenshotCarousel images={[]} gameName="Drawphone" />);

    expect(container).toBeEmptyDOMElement();
  });
});
