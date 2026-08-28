// Adapted from campaign-record's scripts/apps/import-upload.mjs +
// scripts/apps/hub/media-upload.mjs. dataUriToFile is ported verbatim (pure
// data conversion). The upload path is simplified from campaign-record's
// uploadHubMediaAsUser: this wizard is opened from a GM-only hub button
// (see CampaignHubPage.mjs / templates/hub.hbs), so the caller always holds
// FILES_UPLOAD - there is no non-GM-relay-through-active-GM case to handle
// here, unlike campaign-record's Hub (which lets any connected player drop
// media). The FilePicker incantation itself (browse to check, createDirectory
// on failure, then upload with notify:false) is kept as-is.
import { parseImageDataUri, imageExtension } from "../logic/import-images.mjs";
import { IMPORT_MEDIA_DIR } from "../constants.mjs";

/**
 * Build an upload File from an image data-URI. Renderable types upload as-is;
 * unknown-but-decodable types transcode to PNG; undecodable types (EMF/WMF)
 * return { skipped: subtype }.
 *
 * Total by contract - it reports a skip, it never throws. parseImageDataUri
 * accepts any `(.*)` as the payload, so a docx carrying a corrupt inline
 * image reaches atob() with a body it cannot decode. That throw used to
 * escape uploadInlineImages' per-image try (which wraps only the upload
 * call itself) and propagate out of the import wizard's #onCreate past its
 * `finally` - so the wizard never closed, never showed its result dialog,
 * and told the GM nothing at all, with some documents already created.
 */
export async function dataUriToFile(uri, basename) {
  const parsed = parseImageDataUri(uri);
  if (!parsed) return { skipped: "unknown" };
  let bytes;
  try {
    bytes = Uint8Array.from(atob(parsed.base64), (c) => c.charCodeAt(0));
  } catch (error) {
    // `corrupt` distinguishes "this image is broken" from "this image type
    // isn't supported", so the caller can report which actually happened.
    return { skipped: parsed.subtype, corrupt: true };
  }
  const ext = imageExtension(parsed.subtype);
  if (ext) return { file: new File([bytes], `${basename}.${ext}`, { type: parsed.mime }) };
  // Not directly renderable — best-effort transcode to PNG (EMF/WMF will throw).
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: parsed.mime }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: "image/png" });
    return { file: new File([await png.arrayBuffer()], `${basename}.png`, { type: "image/png" }) };
  } catch {
    return { skipped: parsed.subtype };
  }
}

/**
 * Upload a file into an arbitrary directory under worlds/<world-id>/ in the
 * "data" source. Mirrors campaign-record's uploadHubMedia incantation:
 * browse first (cheap existence check), create every missing ancestor
 * directory below the world root on failure (createDirectory is not
 * recursive - the world's own "worlds/<world-id>/" directory always exists,
 * so only segments below it are attempted), then upload with notify:false.
 * Returns the stored path; throws on failure.
 *
 * Exported (beyond this file's own import-image use) for
 * hooks/media-relay.mjs's GM-side upload assembler and SessionSheet's
 * direct-upload path (a player who already holds FILES_UPLOAD) - both land
 * in RELAY_UPLOAD_DIR() (constants.mjs), a sibling of IMPORT_MEDIA_DIR().
 */
export async function uploadCompanionFile(file, dir) {
  const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
  await FilePickerImpl.browse("data", dir).catch(async () => {
    const worldRoot = `worlds/${game.world.id}`;
    const rest = dir.startsWith(`${worldRoot}/`) ? dir.slice(worldRoot.length + 1).split("/") : dir.split("/");
    let path = worldRoot;
    for (const segment of rest) {
      path += `/${segment}`;
      await FilePickerImpl.createDirectory("data", path)
        .catch((err) => console.warn(`mej-campaign-companion | createDirectory ${path}`, err));
    }
  });
  const result = await FilePickerImpl.upload("data", dir, file, {}, { notify: false });
  if (!result?.path) throw new Error(`mej-campaign-companion | upload failed for ${file.name}`);
  return result.path;
}

/** Import wizard's own inline-image destination: worlds/<world-id>/mej-campaign-companion/. */
async function uploadImportFile(file) {
  return uploadCompanionFile(file, IMPORT_MEDIA_DIR());
}

/**
 * Upload each inline data-URI image once (mammoth inlines docx images), rewrite
 * srcs to the stored path, and return the collected {src, caption} refs.
 * Identical data-URIs upload once. Per-image failures drop that image with a
 * warning; other images are unaffected. `uploadedByUri` (data-URI -> stored
 * path or null) is supplied by the caller and shared across the whole
 * document, so identical images on different pages are also deduped.
 */
export async function uploadInlineImages(html, warnings, uploadedByUri) {
  if (!html?.includes("data:image")) return { html, images: [] };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = [...doc.body.querySelectorAll('img[src^="data:"]')];
  if (!imgs.length) return { html, images: [] };

  const images = [];
  let uploadFailed = false;
  let n = 0;
  for (const img of imgs) {
    const uri = img.getAttribute("src");
    if (!uploadedByUri.has(uri)) {
      const result = await dataUriToFile(uri, `import-${Date.now()}-${++n}`);
      let path = null;
      if (result.skipped) {
        warnings.push(result.corrupt
          ? game.i18n.format("MEJCampaignCompanion.import.imageCorrupt", { type: result.skipped })
          : game.i18n.format("MEJCampaignCompanion.import.imageTypeUnsupported", { type: result.skipped }));
      } else {
        try {
          path = await uploadImportFile(result.file);
        } catch (error) {
          console.warn("mej-campaign-companion | inline image upload failed", error);
          uploadFailed = true;
        }
      }
      uploadedByUri.set(uri, path);
    }
    const path = uploadedByUri.get(uri);
    if (path) {
      img.setAttribute("src", path);
      const caption = (img.getAttribute("alt") ?? "").trim();
      images.push({ src: path, caption });
    } else {
      img.remove();
    }
  }

  if (uploadFailed) warnings.push(game.i18n.localize("MEJCampaignCompanion.import.imagesDropped"));

  // Dedupe refs by src so the same image inline twice yields one ref.
  const seen = new Set();
  const uniqueImages = images.filter((i) => (seen.has(i.src) ? false : seen.add(i.src)));
  return { html: doc.body.innerHTML, images: uniqueImages };
}
