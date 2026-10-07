/* ─────────────────────────────────────────────────────────────
   STAR PRODUCTION — SINGLE SOURCE OF TRUTH FOR PLANS & PRICES
   Used by BOTH:
     • index.html          (pricing cards + checkout display)
     • the server seed      (npm run db:seed → database → order amounts)
   `originalPrice` is shown struck through; `price` is what the customer pays.
   After editing, run `npm run db:seed` so the server charges the same prices.
   ───────────────────────────────────────────────────────────── */
(function (root, plans) {
  if (typeof module === 'object' && module.exports) module.exports = plans;
  else root.STAR_PLANS = plans;
})(typeof window !== 'undefined' ? window : globalThis, [
  {
    id: 'foundation',
    name: 'The Foundation',
    originalPrice: 549,
    price: 249,
    description: 'This bundle is recommended for beginners.',
    features: [
      'Full Music Production',
      'Melody Composition',
      '2 Limited Master Revisions',
      'Vocal Mixing & Mastering',
      'Final Master Mixing Mastering',
    ],
    finalOutput: 'Fully Mastered, Release Ready Track',
    isFeatured: false,
  },
  {
    id: 'creator',
    name: 'The Creator',
    originalPrice: 749,
    price: 549,
    description: 'This bundle is recommended for artists who also create content.',
    features: [
      'Full Master Music Production',
      'Melody & Song Composition',
      '4 Limited Master Revisions',
      'Vocal Editing, Processing and Mastering',
      '2 Reels/Shorts Content',
      'Cover Artwork Designing, Thumbnails, Posters',
    ],
    finalOutput: 'Fully Mastered, Release Ready Track, 2 Reels/Shorts, Cover Artwork',
    isFeatured: false,
  },
  {
    id: 'studio',
    name: 'The Studio',
    originalPrice: 999,
    price: 849,
    description:
      'This bundle is recommended for developing artists who need full studio ready release services.',
    features: [
      'Full Master Music Production',
      'Melody & Song Composition',
      '4 Limited Master Revisions',
      'Vocal Editing, Processing and Mastering',
      'Music Video & Visualizer Edition',
      'Cover Artwork Designing, Thumbnails, Posters',
    ],
    finalOutput: 'Fully Mastered, Release Ready Track, Music Video/Visualizer, Cover Artwork',
    isFeatured: false,
  },
  {
    id: 'signature',
    name: 'The Signature',
    originalPrice: 1999,
    price: 1499,
    description: 'This bundle is recommended for artists who need full industry ready release services.',
    features: [
      'Full Master Music Production',
      'Melody & Song Composition',
      'Unlimited Master Revisions',
      'Vocal Editing, Processing and Mastering',
      'Music Video, Visualizer, Posters, Snippets',
      'Cover Art, Thumbnails, Posters, Announcements',
      'Everything in Foundation, Creator and Studio',
    ],
    finalOutput:
      'Fully Mastered, Release Ready Track, Music Video/Visualizer, Cover Artwork, Posters, Much More.',
    isFeatured: true,
  },
]);
