import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [
      // Re-application flow merged into the standard apply flow —
      // returning families share the same `/apply/year/:yearId/*`
      // URL space as new applicants, with the
      // `family_application_progress.type === "Re-Enrollment"`
      // discriminator driving any flow-specific behavior (NWEA
      // skip, prefilled student review, etc.). Old `/reapply/*`
      // URLs that leaked into emails / bookmarks redirect to the
      // unified path so returning families don't hit 404s.
      {
        source: "/reapply/year/:yearId",
        destination: "/apply/year/:yearId",
        permanent: true,
      },
      {
        source: "/reapply/year/:yearId/:rest*",
        destination: "/apply/year/:yearId/:rest*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
