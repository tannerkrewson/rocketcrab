import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScreenshotCarousel } from "./ScreenshotCarousel";

/** jsdom cannot measure layout; e2e/game-detail.spec.ts checks real carousel width stability. */
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

  it("gives the swiper container a definite width (w-full) so it cannot grow from its slides", () => {
    const { container } = render(<ScreenshotCarousel images={images} gameName="Drawphone" />);

    // A definite width prevents min-content sizing from feeding slide widths
    // back into Swiper's next container measurement.
    expect(container.querySelector(".swiper.nova-screenshots")).toHaveClass("w-full");
  });

  it("sits in ONE card with no per-slide phone-like frame (c08)", () => {
    const { container } = render(<ScreenshotCarousel images={images} gameName="Drawphone" />);

    const swiper = container.querySelector(".swiper.nova-screenshots");
    expect(swiper?.parentElement).toHaveClass("rounded-2xl", "bg-surface", "p-4");
    for (const img of container.querySelectorAll<HTMLImageElement>(".swiper-slide img")) {
      expect(img).not.toHaveClass("p-2", "rounded-2xl", "border", "shadow-sm");
    }
  });

  it("is not infinite: loop is off with many images too (c08)", () => {
    const many = Array.from({ length: 6 }, (_, i) => `/shots/many-${i}.png`);
    const { container } = render(<ScreenshotCarousel images={many} gameName="Drawphone" />);

    expect(container.querySelectorAll(".swiper-slide")).toHaveLength(many.length);
    const swiperEl = container.querySelector<
      HTMLElement & { swiper?: { params: { loop: boolean } } }
    >(".swiper.nova-screenshots");
    expect(swiperEl?.swiper?.params.loop).toBe(false);
  });

  it("keeps the same slide images across re-renders (no reload/flicker loop)", () => {
    const { container, rerender } = render(
      <ScreenshotCarousel images={images} gameName="Drawphone" />,
    );
    const firstPass = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));

    rerender(<ScreenshotCarousel images={images} gameName="Drawphone" />);
    expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(
      firstPass,
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
