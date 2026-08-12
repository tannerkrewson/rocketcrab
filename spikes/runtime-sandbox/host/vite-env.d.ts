/// <reference types="vite/client" />

// Vite `?raw` imports used by host/main.ts to embed spike fixtures.
declare module "*.html?raw" {
  const content: string;
  export default content;
}
