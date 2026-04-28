/**
 * Mirror of `backend/src/gallery/ratios.ts` so the frontend can label and
 * render previews without a network round-trip. Keep the two lists in sync.
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

export const RATIOS_BY_ID: Record<string, RatioSpec> = RATIOS.reduce(
  (acc, r) => {
    acc[r.id] = r;
    return acc;
  },
  {} as Record<string, RatioSpec>,
);

export function getRatio(id?: string | null): RatioSpec {
  if (!id) return RATIOS_BY_ID.INSTAGRAM_PORTRAIT;
  return RATIOS_BY_ID[id] || RATIOS_BY_ID.INSTAGRAM_PORTRAIT;
}

export const FONT_FAMILIES = ['Inter', 'System', 'Serif', 'Mono', 'Sans Bold'] as const;

export const FONT_CSS: Record<string, string> = {
  Inter: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
  System: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  Serif: 'Georgia, "Times New Roman", serif',
  Mono: '"JetBrains Mono", Menlo, Consolas, monospace',
  'Sans Bold': 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
};
