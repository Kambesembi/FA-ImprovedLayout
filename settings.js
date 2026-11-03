// Shared defaults for the popup (content.js / features.js keep their own copies)
const FAW_DEFAULTS = {
  enabled: true,
  max: 2800,          // px, 0 = no cap (full width)
  gutter: 24,         // px
  thumb: 1.25,        // thumbnail scale
  layout: "comments-right", // submission page: "comments-right" | "classic"
  imageFit: true,     // fit submission image to available space
  quickView: true,    // click thumbnails to open a popup
  comic: true,        // comic series reader
  comicHorizontal: false, // comic reader scrolls left→right, comments move to the left
  infinite: true,     // infinite scroll in galleries
  archiveLink: false  // "Archived Gallery" (furarchiver.net) link in the profile header
};
