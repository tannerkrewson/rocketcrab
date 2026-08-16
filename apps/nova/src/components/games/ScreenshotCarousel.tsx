import { A11y, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/pagination";
import "./ScreenshotCarousel.css";

export interface ScreenshotCarouselProps {
  /** Portrait screenshot image URLs, in display order. */
  images: string[];
  /** Game name, used for the screenshot alt text. */
  gameName: string;
}

/**
 * App-store style tall portrait screenshot carousel (rocketcrab-9fv.7.46).
 * The games' screenshots are already portrait, so each slide shows the full
 * image tall — swiped horizontally with clickable pagination dots — instead
 * of the old 4:3 thumbnail grid. c08: the carousel is NOT infinite (no
 * `loop` — explicit start and end), and the whole swiper lives in ONE card
 * instead of a phone-like frame around every screenshot.
 *
 * 2t1.3: `slidesPerView` is 2.5 so two and a half screenshots are visible
 * on first load (the centered slide plus the halves peeking in on either
 * side).
 *
 * `w-full` is load-bearing (rocketcrab-9fv.11.12): without a definite width
 * the container's used width follows the wrapper's min-content (the sum of
 * slide widths — swiper's `.swiper-slide` sets `flex-shrink: 0`, so slides
 * never shrink) while swiper sizes each slide as containerWidth /
 * slidesPerView. Any re-measure (image load/error, font swap, re-render,
 * resize) then reads the now-larger container and widens the slides again —
 * a runaway feedback loop that blew the carousel up to ~33.5M px and
 * rendered it off-screen. Do not remove `w-full`.
 */
export function ScreenshotCarousel({ images, gameName }: ScreenshotCarouselProps) {
  if (images.length === 0) {
    return null;
  }
  return (
    // c08: ONE card around the whole swiper; the per-slide frames are gone.
    <div className="rounded-box border-2 border-base-300 bg-base-100 p-4">
      <Swiper
        modules={[A11y, Pagination]}
        slidesPerView={2.5}
        centeredSlides
        spaceBetween={14}
        grabCursor
        pagination={{ clickable: true }}
        className="nova-screenshots w-full"
      >
        {images.map((src, index) => (
          <SwiperSlide key={src}>
            <img
              src={src}
              alt={`${gameName} screenshot ${index + 1}`}
              loading="lazy"
              className="h-[58vh] max-h-[540px] w-auto max-w-full object-contain"
            />
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}
