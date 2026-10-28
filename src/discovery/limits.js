/**
 * Automated collection stays off until the site offers permission or a feed
 * this project is allowed to call. The messages are shown on every discovery run.
 */
export function sourceLimitations() {
  return [
    {
      source: "gradcracker",
      automated: false,
      reason:
        "Gradcracker publishes robots.txt, but no documented API or RSS feed was found, and its legal page does not authorise copying the catalogue. Automated fetching is disabled. Open a listing yourself and submit that one record.",
    },
    {
      source: "trackr",
      automated: false,
      reason:
        "Trackr's terms prohibit scrapers and prohibit feeding another alert system from tracker data. Automated fetching is disabled. Open a listing yourself and submit that one record.",
    },
  ];
}
