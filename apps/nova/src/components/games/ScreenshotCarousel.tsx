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
 * Portrait screenshot carousel. Keep w-full: without a definite container
 * width, min-content and Swiper slide sizing can form a growing feedback
 * loop on each image load, resize, or remeasurement.
 */
export function ScreenshotCarousel({ images, gameName }: ScreenshotCarouselProps) {
  if (images.length === 0) {
    return null;
  }
  return (
    <div className="glass rounded-2xl p-4">
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
