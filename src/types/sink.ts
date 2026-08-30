export interface SinkLink {
  slug: string;
  url: string;
  expiration?: string | number | null;
  password?: string | null;
  tag?: string | null;
  title?: string | null;
  description?: string | null;
  unsafe?: boolean;
  createdAt?: string;
  updatedAt?: string;
  clicks?: number;
}

export interface CreateLinkPayload {
  url: string;
  slug?: string;
  expiration?: string | number | null;
  password?: string | null;
  tag?: string | null;
  title?: string | null;
  description?: string | null;
  unsafe?: boolean;
}

export interface UpdateLinkPayload {
  url?: string;
  expiration?: string | number | null;
  password?: string | null;
  tag?: string | null;
  title?: string | null;
  description?: string | null;
  unsafe?: boolean;
}

export interface SinkStats {
  slug: string;
  url: string;
  clicks: number;
  createdAt?: string;
  lastClickedAt?: string | null;
  countries?: Record<string, number>;
  referrers?: Record<string, number>;
  devices?: Record<string, number>;
}

export interface SinkListResponse {
  list: SinkLink[];
  total: number;
  page?: number;
  pageSize?: number;
}

export interface UrlCheckResult {
  url: string;
  status: number | null;
  statusText: string;
  responseTimeMs: number;
  isAlive: boolean;
  contentType?: string | null;
}
