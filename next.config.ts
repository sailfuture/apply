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
      // Old addresses of two signing steps. Each used to be a second,
      // unmaintained copy of its signing page that nothing linked to
      // but that still CREATED a PandaDoc document for anyone who
      // opened it. The pages are gone; a bookmark or an old email
      // lands on the step that replaced them. Redirected here rather
      // than from a page so it is a real redirect: a page under the
      // dashboard's loading boundary answers 200 and redirects late.
      {
        source: "/apply/year/:yearId/agreement",
        destination: "/apply/year/:yearId/enrollment-signing",
        permanent: false,
      },
      {
        // The waiver is signed inside the Registration Packet step now.
        source: "/apply/year/:yearId/waiver",
        destination: "/apply/year/:yearId/registration",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
