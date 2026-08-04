import type { MetadataRoute } from "next";

/**
 * Web app manifest — makes the admin portal installable to a phone's
 * home screen ("Add to Home Screen").
 *
 * Why this matters beyond polish: on iOS, the Notification API is NOT
 * available to a normal Safari tab. Web push works only for a site
 * installed to the home screen (iOS 16.4+), and that install needs a
 * manifest declaring `display: standalone`. Android/Chrome supports
 * notifications in a plain tab, but the installed app is steadier
 * (survives tab cleanup) and drops the browser chrome, which matters
 * on the message thread where vertical space is tight.
 *
 * Icons reuse the existing square logo rather than introducing new
 * asset sizes; both are square so neither gets letterboxed.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SailFuture Academy Admin",
    short_name: "SFA Admin",
    description:
      "SailFuture Academy admissions, registration, and family messaging.",
    // Land on the inbox: the phone use case is reading and replying to
    // parent texts, not browsing the dashboard.
    start_url: "/admin/messages",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f9fafb",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/logo.jpg",
        sizes: "900x900",
        type: "image/jpeg",
        purpose: "any",
      },
    ],
  };
}
