import type { MetadataRoute } from 'next';

// Public pages only. The signed-in app (notes, settings) and per-user share links are not listed.
const PATHS = ['/', '/login', '/signup', '/contact', '/privacy', '/terms', '/creators'];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({ url: `https://scribeai.online${path === '/' ? '' : path}` }));
}
