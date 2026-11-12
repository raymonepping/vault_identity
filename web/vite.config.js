import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Build only: the console is served by nginx from its image (make app-build),
// so its API calls are same-origin. A dev server's own origin would be refused
// by the API's cross-site check, so there is none.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
