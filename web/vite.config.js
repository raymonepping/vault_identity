import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `npm run dev` proxies the API to the running vid-api container.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The API is reachable only behind the console's TLS: run the dev server
    // with NODE_EXTRA_CA_CERTS=../vault-tls/ca-chain.pem so the lab CA verifies.
    proxy: { "/api": { target: "https://localhost:14001", changeOrigin: true } },
  },
});
