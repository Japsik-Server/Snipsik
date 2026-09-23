export interface SinkLink {
  id?: string;
  slug: string;
  url: string;
  comment?: string;
  expiration?: number | null;
  password?: string | null;
  tags?: string[];
  title?: string | null;
  description?: string | null;
  image?: string;
  apple?: string;
  google?: string;
  cloaking?: boolean;
  redirectWithQuery?: boolean;
  geo?: Record<string, string>;
  unsafe?: boolean;
  createdAt?: string | number;
  updatedAt?: string | number;
  clicks?: number;
}

export interface CreateLinkPayload {
  url: string;
  slug?: string;
  comment?: string;
  expiration?: number;
  password?: string;
  tags?: string[];
  title?: string;
  description?: string;
  image?: string;
  apple?: string;
  google?: string;
  cloaking?: boolean;
  redirectWithQuery?: boolean;
  geo?: Record<string, string>;
  unsafe?: boolean;
}

export interface UpdateLinkPayload {
  url?: string;
  comment?: string;
  expiration?: number;
  password?: string;
  tags?: string[];
  title?: string;
  description?: string;
  image?: string;
  apple?: string;
  google?: string;
  cloaking?: boolean;
  redirectWithQuery?: boolean;
  geo?: Record<string, string>;
  unsafe?: boolean;
}

export interface SinkStats {
  slug: string;
  url: string;
  clicks: number;
  createdAt?: string | number;
  lastClickedAt?: string | number | null;
  countries?: Record<string, number>;
  referrers?: Record<string, number>;
  devices?: Record<string, number>;
}

export interface SinkListResponse {
  list: SinkLink[];
  total: number;
  page?: number;
  pageSize?: number;
  cursor?: string | null;
  listComplete?: boolean;
}

export interface SinkQueryParams {
  slug?: string;
  url?: string;
}

export interface SinkSearchParams {
  q?: string;
  url?: string;
  tag?: string;
  status?: "active" | "expired" | "all";
  limit?: number;
}

export interface SinkSearchResult {
  success: boolean;
  list: SinkLink[];
  total: number;
  cursor?: string | null;
  listComplete?: boolean;
  error?: string;
  status: number;
}

export interface SinkCountParams {
  q?: string;
  url?: string;
  tag?: string;
  status?: "active" | "expired" | "all";
}

export interface SinkListParams {
  limit?: number;
  cursor?: string | null;
  sort?: "newest" | "oldest" | "az" | "za";
  tag?: string;
  status?: "active" | "expired" | "all";
}

export interface UrlCheckResult {
  url: string;
  status: number | null;
  statusText: string;
  responseTimeMs: number;
  isAlive: boolean;
  contentType?: string | null;
}
