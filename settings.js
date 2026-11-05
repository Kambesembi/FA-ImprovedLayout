// Shared defaults for the popup (content.js / features.js keep their own copies)
const FAW_DEFAULTS = {
  enabled: true,
  ultrawide: true,    // main switch: ultrawide layout
  design: true,       // main switch: bubbles design
  gutter: 24,         // px
  thumb: 1.25,        // thumbnail scale
  imageFit: true,     // fit submission image to available space
  quickView: true,    // click thumbnails to open a popup
  comic: true,        // comic series reader
  comicHorizontal: false, // comic reader scrolls left→right, comments move to the left
  infinite: true,     // infinite scroll in galleries
  archiveLink: false, // "Archived Gallery" (furarchiver.net) link in the profile header
  bbExtra: true,      // extra BBCode buttons in comment boxes
  topbar: true,       // clear-all-notifications button + SFW switch in the top bar
  pins: true,         // pinned artists sidebar
  pinned: [],         // [{ u: slug, n: name, a: avatar URL }]
  pinSubs: true,      // pinned submissions sidebar (list itself in storage.local "pinnedSubs")
  walls: false,       // reference walls (walls.html; data in storage.local "walls")
  lang: "auto"        // extension language: auto | en | de | ru
};
