/**
 * Canonical aspect ratio catalogue for the Gallery module. Mirrored on the
 * frontend in `frontend/src/lib/gallery-ratios.ts` — keep them in sync when
 * adding new sizes. Pixel dimensions are chosen to match the upload specs of
 * the listed platforms so generated images render natively without rescale.
 */

export interface RatioSpec {
  id: string;
  label: string;
  width: number;
  height: number;
  group: 'instagram' | 'linkedin' | 'twitter' | 'story' | 'general';
}

export const RATIOS: RatioSpec[] = [
  { id: 'INSTAGRAM_SQUARE',    label: 'Instagram Square (1:1)',     width: 1080, height: 1080, group: 'instagram' },
  { id: 'INSTAGRAM_PORTRAIT',  label: 'Instagram Portrait (4:5)',   width: 1080, height: 1350, group: 'instagram' },
  { id: 'INSTAGRAM_LANDSCAPE', label: 'Instagram Landscape (1.91:1)', width: 1080, height: 566, group: 'instagram' },
  { id: 'INSTAGRAM_STORY',     label: 'Story / Reel (9:16)',        width: 1080, height: 1920, group: 'story' },
  { id: 'LINKEDIN_LANDSCAPE',  label: 'LinkedIn Landscape (1.91:1)', width: 1200, height: 628,  group: 'linkedin' },
  { id: 'LINKEDIN_SQUARE',     label: 'LinkedIn Square (1:1)',      width: 1200, height: 1200, group: 'linkedin' },
  { id: 'LINKEDIN_PORTRAIT',   label: 'LinkedIn Portrait (4:5)',    width: 1080, height: 1350, group: 'linkedin' },
  { id: 'TWITTER_LANDSCAPE',   label: 'X / Twitter Landscape (16:9)', width: 1600, height: 900, group: 'twitter' },
  { id: 'TWITTER_SQUARE',      label: 'X / Twitter Square (1:1)',   width: 1200, height: 1200, group: 'twitter' },
  { id: 'GENERIC_LANDSCAPE',   label: 'Landscape (16:9)',           width: 1920, height: 1080, group: 'general' },
  { id: 'GENERIC_PORTRAIT',    label: 'Portrait (4:5)',             width: 1080, height: 1350, group: 'general' },
  { id: 'GENERIC_SQUARE',      label: 'Square (1:1)',               width: 1080, height: 1080, group: 'general' },
];

export function getRatio(id: string): RatioSpec {
  return RATIOS.find((r) => r.id === id) || RATIOS[0];
}

export function recommendedRatioFor(platform: 'TWITTER' | 'LINKEDIN' | 'GENERIC'): string {
  if (platform === 'TWITTER') return 'TWITTER_LANDSCAPE';
  if (platform === 'LINKEDIN') return 'LINKEDIN_LANDSCAPE';
  return 'INSTAGRAM_PORTRAIT';
}
