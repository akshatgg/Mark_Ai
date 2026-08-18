import type { NextConfig } from "next";

/**
 * Everything under /api/fit is proxied to the creative-fit service.
 *
 * This is deliberate rather than calling the service directly from the browser:
 * the API returns variant URLs as site-relative paths ("/api/fit/<id>/file/x.jpg"),
 * so proxying lets those URLs be used verbatim in <img src>. It also keeps the
 * whole app same-origin, so no CORS and no API host baked into the client bundle.
 */
const API = process.env.CREATIVE_FIT_API_URL ?? "http://localhost:8097";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/fit/:path*", destination: `${API}/api/fit/:path*` },
      // Same reasoning as /api/fit/*: variant URLs come back site-relative
      // and must work verbatim in <video src>, including 206 Range requests
      // for scrubbing -- Next's rewrite proxy passes those through.
      { source: "/api/video/:path*", destination: `${API}/api/video/:path*` },
    ];
  },
};

export default nextConfig;
