import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(({ mode }) => {
  const configuredPort = Number(process.env.PORT || process.env.VITE_DEV_SERVER_PORT || 8080);

  return ({
  base: mode === "production" ? "./" : "/",
  server: {
    host: "::",
    port: configuredPort,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  });
});
