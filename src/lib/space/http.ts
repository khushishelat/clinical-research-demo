// Cache headers for the data routes. The CDN may serve a stale copy while it
// refreshes; browsers always revalidate, so a response from before a deploy
// (an older shape) never reaches the page.
export const CACHED = {
  'cache-control': 'public, max-age=0, must-revalidate',
  'cdn-cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
};
