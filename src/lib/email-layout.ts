/**
 * Shared branded layout for Eateryo emails (server-only).
 *
 * All bodies use table layout + inline styles (email-client safe), system fonts
 * only, max ~520px.
 *
 * The header mark is the app's own icon (`src/app/icon.svg`), linked and not
 * embedded: Gmail, every Outlook, Yahoo and AOL strip an inline `<svg>`, while a
 * linked `.svg` renders nearly everywhere — Gmail rasterises it server-side, and
 * only Word-engine Outlook shows nothing but the alt text. The URL carries a
 * digest of the colours the icon was generated with, because mail proxies cache
 * an image by URL and an unversioned one would keep serving the old tile after
 * a palette change.
 * Email clients do not resolve CSS variables, so every colour is resolved from
 * the theme instead of typed here: `themeColor` reads the values
 * `scripts/build-theme-tokens.mjs` generates from `src/app/theme.css`. A theme
 * change therefore reaches the mailbox, and this file holds no palette of its
 * own — `tests/theme-tokens.test.ts` fails if a hex literal creeps back in.
 */
import { themeColor } from "@/lib/theme/tokens";

/** Escape user-controlled text interpolated into email HTML. */
export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const OUTER_BG = themeColor("background");
const CARD_BG = themeColor("surface-base");
const CARD_BORDER = themeColor("line-200");
const INK = themeColor("ink-900");
const BODY_TEXT = themeColor("ink-700");
const MUTED = themeColor("ink-600");
const FAINT = themeColor("ink-500");
const BRAND = themeColor("accent-700");
const BRAND_BG = themeColor("accent-50");
const BRAND_BORDER = themeColor("accent-200");
const BRAND_DARK = themeColor("accent-900");
const ON_BRAND = themeColor("on-accent");
const SURFACE_SOFT = themeColor("surface-50");

/**
 * Short digest of the two colours baked into the generated icon (the tile and
 * the glyph). Not a security boundary — a cache key: same palette, same URL.
 */
function iconRevision(): string {
  const seed = `${themeColor("accent-700")}|${themeColor("on-accent")}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Absolute, versioned URL of the app icon. A link in an email must be absolute,
 * and the origin is taken from the message's own action URL — the same host the
 * recipient is about to visit, so a dev link stays on the dev server.
 */
export function emailIconUrl(url: string): string {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    // A relative action URL is already broken in email; keep the mark on the
    // same host as the rest of the message rather than pointing it at nothing.
    origin = url.replace(/\/+$/, "");
  }
  return `${origin}/icon.svg?v=${iconRevision()}`;
}

/**
 * The brand mark in every email header: the app icon, linked.
 *
 * `alt` carries the name where nothing is drawn — Word-engine Outlook never
 * renders a linked SVG and blocks images by default — so the name also stays a
 * line of live text directly beneath the mark.
 */
export function emailLogoMark(url: string): string {
  const src = escapeEmailHtml(emailIconUrl(url));
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td align="center" width="48" height="48" style="width:48px;height:48px">` +
    `<img src="${src}" width="48" height="48" alt="Eateryo" ` +
    `style="display:block;width:48px;height:48px;border:0;outline:none;text-decoration:none" />` +
    `</td></tr></table>`
  );
}

/** Hidden preheader shown as the inbox preview line. */
function emailPreheader(preheader: string): string {
  return (
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">` +
    `${escapeEmailHtml(preheader)}</div>`
  );
}

function emailFooter(tagline: string): string {
  return (
    `<p style="margin:14px 0 0;font-family:Arial,sans-serif;font-size:11px;color:${FAINT}">` +
    `&copy; Eateryo &middot; ${escapeEmailHtml(tagline)} &middot; ` +
    `<a href="#" style="color:${FAINT}">Privacy</a> &middot; <a href="#" style="color:${FAINT}">Terms</a></p>`
  );
}

/**
 * Wrap an email card body in the outer background + footer.
 * `cardInner` is the <tr>… rows of the white card.
 */
export function emailPage(options: {
  preheader: string;
  cardInner: string;
  tagline?: string;
}): string {
  const tagline = options.tagline ?? "Free while it lasts";
  return (
    emailPreheader(options.preheader) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="background:${OUTER_BG};margin:0;padding:0">` +
    `<tr><td align="center" style="padding:28px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="max-width:520px;background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:16px;overflow:hidden">` +
    options.cardInner +
    `</table>` +
    emailFooter(tagline) +
    `</td></tr></table>`
  );
}

/** Primary brand call-to-action button (with Outlook VML fallback). */
export function emailCtaButton(label: string, url: string): string {
  const safeUrl = escapeEmailHtml(url);
  const safeLabel = escapeEmailHtml(label);
  return (
    `<!--[if mso]><v:roundrect href="${safeUrl}" style="width:240px;height:48px" ` +
    `arcsize="25%" fillcolor="${BRAND}" stroke="f">` +
    `<center style="color:${ON_BRAND};font-family:Arial;font-size:16px;font-weight:bold">${safeLabel}</center>` +
    `</v:roundrect><![endif]--><!--[if !mso]><!-- -->` +
    `<a href="${safeUrl}" style="display:inline-block;background:${BRAND};color:${ON_BRAND};` +
    `text-decoration:none;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;` +
    `padding:14px 40px;border-radius:12px">${safeLabel}</a><!--<![endif]-->`
  );
}

/** Small paste-able fallback link under the button. */
export function emailFallbackLink(url: string): string {
  const safeUrl = escapeEmailHtml(url);
  return (
    `<p style="margin:12px 0 0;font-size:12px;word-break:break-all">` +
    `<a href="${safeUrl}" style="color:${BRAND};text-decoration:underline">${safeUrl}</a></p>`
  );
}

export const EMAIL_COLORS = {
  INK,
  BODY_TEXT,
  MUTED,
  FAINT,
  BRAND,
  BRAND_BG,
  BRAND_BORDER,
  BRAND_DARK,
  CARD_BORDER,
  SURFACE_SOFT,
};
