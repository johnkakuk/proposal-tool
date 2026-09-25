import { supabase } from "./supabase";

/** Types the public `assets` bucket accepts (supabase/migrations/*_storage.sql). */
export const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

/**
 * Uploads an image to the public `assets` bucket under the owner's folder (required by the
 * storage RLS policy) and returns its public URL. Names are unique, so nothing is overwritten.
 */
export async function uploadAsset(file: File, kind: string, maxBytes = 5 * 1024 * 1024): Promise<string> {
  if (!IMAGE_TYPES.split(",").includes(file.type)) throw new Error("Use a PNG, JPEG, WebP, GIF, or SVG image.");
  if (file.size > maxBytes) throw new Error(`Images must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const { data } = await supabase.auth.getSession();
  const ownerId = data.session?.user.id;
  if (!ownerId) throw new Error("Sign in again to upload.");
  const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${ownerId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("assets").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return supabase.storage.from("assets").getPublicUrl(path).data.publicUrl;
}
