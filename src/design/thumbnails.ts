export type ThumbnailDesign = {
  thumbnail_url?: string | null;
  thumbnail_at?: string | null;
  updated_at: string;
};

/** True when the card has no preview, or the scene moved since the last export. */
export function designNeedsThumbnail(design: ThumbnailDesign): boolean {
  if (!design.thumbnail_url) return true;
  return !design.thumbnail_at || design.thumbnail_at !== design.updated_at;
}

export function thumbnailCacheSrc(url: string | null | undefined, version?: string | null): string {
  if (!url) return "";
  if (!version) return url;
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}v=${encodeURIComponent(version)}`;
}
