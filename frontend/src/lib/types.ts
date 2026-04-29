export interface User {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export interface Project {
  id: string;
  userId: string;
  githubRepoId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  description: string | null;
  private: boolean;
  autoSync: boolean;
  webhookId: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  defaultBranch: string;
  private: boolean;
  pushedAt: string | null;
  stars: number;
  language: string | null;
}

export interface Commit {
  id: string;
  projectId: string;
  sha: string;
  message: string;
  authorName: string | null;
  authorEmail: string | null;
  authoredAt: string;
  url: string | null;
  additions: number;
  deletions: number;
  filesChanged: number;
  diffPreview: string | null;
  summary: string | null;
}

export type PostPlatform = 'TWITTER' | 'LINKEDIN' | 'GENERIC';
export type PostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED';

export type PostKind = 'COMMITS' | 'NEWS';

export interface Post {
  id: string;
  userId: string;
  projectId: string | null;
  kind?: PostKind;
  title: string | null;
  content: string;
  summary: string | null;
  platform: PostPlatform;
  status: PostStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
  commitShas: string[];
  newsItemIds?: string[];
  rangeFrom: string | null;
  rangeTo: string | null;
  metadata: any;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// AI News Gen
// ---------------------------------------------------------------------------

export type NewsSourceKind =
  | 'GOOGLE_NEWS'
  | 'TECHCRUNCH'
  | 'HACKER_NEWS'
  | 'REDDIT'
  | 'CUSTOM';

export type NewsItemStatus = 'NEW' | 'USED' | 'DISMISSED';

export interface NewsSource {
  id: string;
  userId: string;
  kind: NewsSourceKind;
  name: string;
  url: string;
  query: string | null;
  subreddit: string | null;
  enabled: boolean;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewsItem {
  id: string;
  userId: string;
  sourceId: string | null;
  externalId: string;
  kind: NewsSourceKind;
  sourceName: string;
  title: string;
  link: string;
  author: string | null;
  snippet: string | null;
  contentHtml: string | null;
  publishedAt: string | null;
  status: NewsItemStatus;
  raw: any;
  createdAt: string;
}

export interface NewsRefreshResult {
  fetched: number;
  inserted: number;
  errors: Array<{ source: string; message: string }>;
}

export interface ContributionDay {
  date: string;
  contributionCount: number;
  color: string;
}
export interface ContributionWeek { contributionDays: ContributionDay[]; }
export interface ContributionCalendar {
  totalContributions: number;
  weeks: ContributionWeek[];
}

export interface DailyAgg { date: string; count: number; }

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

export interface GalleryAsset {
  id: string;
  userId: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  filename: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  /** Synthetic field set on the demo store / mappers so UIs can render bytes
   *  without hitting an authenticated backend route. */
  url?: string;
}

export interface GalleryRenderSpec {
  ratio: string;
  width: number;
  height: number;
  marginTopPct: number;
  marginBottomPct: number;
  marginLeftPct: number;
  marginRightPct: number;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'start' | 'center' | 'end';
  bgFit: 'cover' | 'contain';
  bgFillColor: string;
  content: string;
  offsetX?: number;
  offsetY?: number;
}

export interface GalleryImage {
  id: string;
  userId: string;
  postId: string | null;
  assetId: string | null;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  spec: GalleryRenderSpec;
  status: 'READY' | 'FAILED';
  createdAt: string;
  updatedAt: string;
  /** Synthetic — set by demo store to avoid an authenticated file fetch. */
  dataUrl?: string;
}

export interface GallerySettings {
  id: string;
  userId: string;
  defaultRatio: string;
  marginTopPct: number;
  marginBottomPct: number;
  marginLeftPct: number;
  marginRightPct: number;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'start' | 'center' | 'end';
  bgFit: 'cover' | 'contain';
  bgFillColor: string;
  defaultAssetId: string | null;
  autoGenerate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryRatio {
  id: string;
  label: string;
  width: number;
  height: number;
  group: 'instagram' | 'linkedin' | 'twitter' | 'story' | 'general';
}

