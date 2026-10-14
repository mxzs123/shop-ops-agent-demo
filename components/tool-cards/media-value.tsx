import { ImageIcon } from "lucide-react";
import type { ReactNode } from "react";

import { formatValue } from "@/lib/format";
import { splitMediaValue, toDisplayMediaUrl } from "@/lib/media";

const IMAGE_EDIT_FIELDS = new Set(["image", "images"]);

export function renderChangeValue(
  field: string,
  value: unknown,
  mediaBaseUrl: string,
): ReactNode {
  if (IMAGE_EDIT_FIELDS.has(field)) {
    return <MediaChangeValue mediaBaseUrl={mediaBaseUrl} value={value} />;
  }

  return formatValue(value);
}

function MediaChangeValue({
  mediaBaseUrl,
  value,
}: {
  mediaBaseUrl: string;
  value: unknown;
}) {
  const urls = splitMediaValue(value);

  if (urls.length === 0) {
    return <span>-</span>;
  }

  return (
    <div className="flex max-w-full flex-wrap gap-1.5">
      {urls.map((url, index) => {
        const src = toDisplayMediaUrl(url, mediaBaseUrl);
        return (
          <div
            className="relative size-12 overflow-hidden rounded-md border border-line-strong bg-inset"
            key={`${url}-${index}`}
            title={url}
          >
            <ImageIcon className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-ink-3" />
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="absolute inset-0 size-full object-cover"
                decoding="async"
                loading="lazy"
                src={src}
              />
            ) : null}
            {urls.length > 1 ? (
              <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] font-semibold leading-4 text-white">
                {index + 1}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
