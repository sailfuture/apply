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
    // One manifest serves everyone who installs the site, parents as
    // well as staff, so the name can't say "Admin": a parent who added
    // the portal to their phone got an icon labelled "SFA Admin".
    // Phones cut the label under an icon at about 12 characters, so
    // this reads "SailFuture A…" there; the full name shows in the
    // install prompt, the splash screen and the app switcher.
    name: "SailFuture Academy Portal",
    short_name: "SailFuture Academy Portal",
    description:
      "SailFuture Academy applications, registration, tuition and family messaging.",
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
