import { defineConfig } from "astro/config";

export default defineConfig({
  site: "http://localhost:4321",
  output: "static",
  publicDir: "public-reath",
  devToolbar: { enabled: false },
});
