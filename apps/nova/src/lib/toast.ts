/**
 * Single toast entry point. HeroUI owns the visuals and the queue
 * (`<Toast.Provider>` in main.tsx); this indirection gives tests one module
 * to mock instead of the whole component library.
 */
export { toast } from "@heroui/react";
