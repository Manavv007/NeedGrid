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

/** Thank-you page right after a payment. */
export function thanksPath(impactToken: string): string {
  return `/thanks/${encodeURIComponent(impactToken)}`;
}

/** Staff: one need's management page (edit, purchase plan, order, delivery). */
export function staffNeedPath(needId: string): string {
  return `/staff/needs/${encodeURIComponent(needId)}`;
}

/** The donor's impact page: their only way back, so it's also the link they save. */
export function impactPath(impactToken: string): string {
  return `/impact/${encodeURIComponent(impactToken)}`;
}

/**
 * Links to other sites (retailers) only ever open http(s) URLs. Returns null for anything else
 * (`javascript:`, `data:`, malformed), so callers render plain text instead of a link.
 */
export function externalHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
