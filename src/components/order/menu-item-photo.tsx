/**
 * A dish photo on the diner's menu row.
 *
 * A plain `<img>` on purpose. The stored copy was sized and encoded in the
 * browser before upload, so it is already what the row shows; pointing Next's
 * `<Image>` at it would send every photo through Vercel's image optimizer for
 * a transform that changes nothing. The CDN serves the file as-is.
 *
 * `alt=""` is deliberate: the dish name sits right beside the photo, so
 * repeating it would make a screen reader say the same dish twice.
 */

import { itemImageCopy } from "@/features/item-images/ref";
import type { MenuItem } from "@/features/menu/schema";

export function MenuItemPhoto({ item }: { item: MenuItem }) {
  const copy = itemImageCopy(item.image);
  if (!copy) return null;

  return (
    <img
      src={copy.url}
      alt=""
      width={copy.width}
      height={copy.height}
      loading="lazy"
      decoding="async"
      className="h-16 w-16 shrink-0 rounded-lg border border-line-200 object-cover"
    />
  );
}
