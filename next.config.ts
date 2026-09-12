import type { NextConfig } from "next";

/**
 * Two build flavors:
 *  - server (default):  `output: "standalone"` — the self-hostable
 *    Node bundle (web tarball, Electron app, `bun run dev`).
 *  - static (NEXT_OUTPUT=export): `output: "export"` — a pure static
 *    site for GitHub Pages (NEXT_BASE_PATH=/ChaysPhotoStudio) and the
 *    self-contained browser plugin (no base path). Built by
 *    scripts/export-webapp.mjs, which also prunes the server-only
 *    API route from the export source tree.
 */
const isExport = process.env.NEXT_OUTPUT === "export";
const basePath = process.env.NEXT_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: isExport ? "export" : "standalone",
  ...(basePath ? { basePath } : {}),
  images: isExport ? { unoptimized: true } : undefined,
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
