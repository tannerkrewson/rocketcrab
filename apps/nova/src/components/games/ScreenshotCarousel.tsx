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
 * of the old 4:3 thumbnail grid.
 */
export function ScreenshotCarousel({ images, gameName }: ScreenshotCarouselProps) {
  if (images.length === 0) {
    return null;
  }
  return (
    <Swiper
      modules={[A11y, Pagination]}
      slidesPerView={1.15}
      centeredSlides
      spaceBetween={14}
      loop={images.length > 2}
      loopAdditionalSlides={0}
      grabCursor
      pagination={{ clickable: true }}
      className="nova-screenshots"
    >
      {images.map((src, index) => (
        <SwiperSlide key={src}>
          <img
            src={src}
            alt={`${gameName} screenshot ${index + 1}`}
            loading="lazy"
            className="h-[58vh] max-h-[540px] w-auto max-w-full rounded-2xl border border-base-300 bg-base-200 p-2 object-contain shadow-sm"
          />
        </SwiperSlide>
      ))}
    </Swiper>
  );
}
