/**
 * @rocketcrab/core
 *
 * Transport-neutral Nova transport interfaces (ADR-0003) and the shared
 * game-repository contract (ADR-0005). These contracts are React-free and
 * never expose Trystero to generated games.
 */
export * from "./repository";
export * from "./transport";

export const packageName = "@rocketcrab/core";
