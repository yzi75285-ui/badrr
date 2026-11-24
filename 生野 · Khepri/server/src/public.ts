import type { StoredMedia } from "./types.js";
import type { PublicMedia } from "./types.js";

export function toPublic(media: StoredMedia): PublicMedia {
  const { access_token: token, extension, preview_extension: previewExtension, ...rest } = media;
  void extension;
  return {
    ...rest,
    analysis: { status: "not_implemented", report_id: null },
    access: {
      original_url: `/api/media/${media.media_id}/original?access=${token}`,
      preview_url: rest.preview.available && previewExtension
        ? `/api/media/${media.media_id}/preview?access=${token}`
        : null,
    },
  };
}
