import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
    // TanStack Router requires strictNullChecks for full type safety.
    // We defer strict mode adoption to a follow-up task.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return createTanStackRouter({ routeTree } as any);
}

declare module "@tanstack/react-router" {
    interface Register {
        router: ReturnType<typeof getRouter>;
    }
}
