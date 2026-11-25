import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

export interface ScreenshotCarouselProps {
  /** Portrait screenshot image URLs, in display order. */
  images: readonly string[];
  /** Game name, used for the screenshot alt text. */
  gameName: string;
}

/**
 * A row of portrait screenshots that scrolls sideways with native scroll
 * snapping: swipe on phones, arrow buttons on wider screens. The row is
 * `w-max max-w-full`, so a few screenshots sit centered and more scroll.
 */
export function ScreenshotCarousel({ images, gameName }: ScreenshotCarouselProps) {
  const rowRef = useRef<HTMLUListElement>(null);
  const [canScroll, setCanScroll] = useState({ back: false, forward: false });

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (row === null) return;
    const max = row.scrollWidth - row.clientWidth;
    setCanScroll({ back: row.scrollLeft > 4, forward: row.scrollLeft < max - 4 });
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (row === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  if (images.length === 0) {
    return null;
  }

  const scrollBy = (direction: 1 | -1) => {
    const row = rowRef.current;
    row?.scrollBy({ left: direction * row.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section aria-label="Screenshots" className="relative">
      <ul
        ref={rowRef}
        onScroll={measure}
        data-testid="screenshot-row"
        className="mx-auto flex w-max max-w-full snap-x snap-mandatory gap-3 overflow-x-auto rounded-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((src, index) => (
          <li key={src} className="h-80 shrink-0 snap-center sm:h-96">
            <img
              src={src}
              alt={`${gameName} screenshot ${index + 1}`}
              loading="lazy"
              onLoad={measure}
              className="h-full w-auto min-w-24 rounded-2xl bg-surface-secondary object-contain"
            />
          </li>
        ))}
      </ul>
      {canScroll.back ? (
        <Button
          variant="default"
          soft
          isIconOnly
          aria-label="Previous screenshots"
          className="absolute left-2 top-1/2 hidden -translate-y-1/2 shadow-overlay sm:flex"
          onClick={() => scrollBy(-1)}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
      ) : null}
      {canScroll.forward ? (
        <Button
          variant="default"
          soft
          isIconOnly
          aria-label="More screenshots"
          className="absolute right-2 top-1/2 hidden -translate-y-1/2 shadow-overlay sm:flex"
          onClick={() => scrollBy(1)}
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Button>
      ) : null}
    </section>
  );
}
