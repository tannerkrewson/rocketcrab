import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScreenshotCarousel } from "./ScreenshotCarousel";

/**
 * Screenshot carousel tests (rocketcrab-9fv.7.46): the game detail page's
 * tall portrait screenshots render as a swiper carousel — every image with
 * its alt text, plus a pagination dot per screenshot. c08: the swiper is
 * NOT infinite (explicit start and end — `loop` is never enabled), and the
 * whole carousel sits in ONE card (no phone-like frame per screenshot).
 *
 * The width-stability tests (rocketcrab-9fv.11.12) guard the gallery fix:
 * the swiper container must carry `w-full` so its width never depends on
 * the wrapper's min-content (which made swiper grow slide widths on every
 * re-measure until the layout exploded to ~33.5M px — the flickering,
 * off-screen carousel). jsdom has no layout engine, so the full loop is
 * covered by the e2e spec (e2e/game-detail.spec.ts) which measures the
 * real container width.
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

  it("gives the swiper container a definite width (w-full) so it cannot grow from its slides", () => {
    const { container } = render(<ScreenshotCarousel images={images} gameName="Drawphone" />);

    // Regression for rocketcrab-9fv.11.12: without `w-full` the container
    // width follows the wrapper's min-content (sum of slide widths) and
    // swiper's containerWidth / slidesPerView slide sizing turns that into
    // a runaway feedback loop that blew the carousel up to ~33.5M px.
    expect(container.querySelector(".swiper.nova-screenshots")).toHaveClass("w-full");
  });

  it("sits in ONE card with no per-slide phone-like frame (c08)", () => {
    const { container } = render(<ScreenshotCarousel images={images} gameName="Drawphone" />);

    // The whole swiper (not each screenshot) is wrapped in the single card.
    const swiper = container.querySelector(".swiper.nova-screenshots");
    expect(swiper?.parentElement).toHaveClass("rounded-box", "bg-base-100", "p-4");
    // The old per-slide frame (padding / border / rounded card) is gone.
    for (const img of container.querySelectorAll<HTMLImageElement>(".swiper-slide img")) {
      expect(img).not.toHaveClass("p-2", "rounded-2xl", "border", "shadow-sm");
    }
  });

  it("is not infinite: loop is off with many images too (c08)", () => {
    const many = Array.from({ length: 6 }, (_, i) => `/shots/many-${i}.png`);
    const { container } = render(<ScreenshotCarousel images={many} gameName="Drawphone" />);

    // Without `loop` every screenshot renders exactly once — the first
    // slide is the explicit start, the last one the explicit end.
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

    // A parent re-render must not recreate or reorder the slides.
    rerender(<ScreenshotCarousel images={images} gameName="Drawphone" />);
    expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(
      firstPass,
    );

    // The DOM nodes themselves keep their identity (stable keys), so the
    // gallery cannot reset its position by remounting.
    const nodes = [...container.querySelectorAll("img")];
    rerender(<ScreenshotCarousel images={images} gameName="Drawphone" />);
    expect([...container.querySelectorAll("img")]).toEqual(nodes);
  });

  it("renders nothing when there are no screenshots", () => {
    const { container } = render(<ScreenshotCarousel images={[]} gameName="Drawphone" />);

    expect(container).toBeEmptyDOMElement();
  });
});
