/** In-app URLs for public pages, so every link to a charity or a need is built the same way. */

export function orgPath(slug: string): string {
  return `/o/${encodeURIComponent(slug)}`;
}

export function orgFlyerPath(slug: string): string {
  return `${orgPath(slug)}/flyer`;
}

/** Need page; `donate: true` opens it with the donate panel focused (design decision, `?donate=1`). */
export function needPath(slug: string, needId: string, opts: { donate?: boolean } = {}): string {
  return `${orgPath(slug)}/n/${encodeURIComponent(needId)}${opts.donate ? "?donate=1" : ""}`;
}
