import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development the ASP.NET Core API runs on :5080; Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:5080" } },
});
