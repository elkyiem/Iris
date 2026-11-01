import type { Save } from "@pond/schema/db";
import { saves } from "@pond/schema/db";
import {
  isOriginalImageKind,
  primaryOriginalPath,
  TEXT_THUMBNAIL_WEBP_FILE,
  THUMBNAIL_DARK_KIND,
  THUMBNAIL_KIND,
  thumbnailFilename,
} from "@shared/save-file-names";
import { eq } from "drizzle-orm";
import log from "electron-log/main.js";
import sharp from "sharp";
import { getDb } from "../db";
import { saveFile } from "../paths";
import { persistSave } from "./persist-save";
import type { WriteFileArgs } from "./pipeline/workers/apply";
import { renderThumbnail, thumbnailToRender } from "./save-thumbnail-file";

export { renderThumbnail };

function thumbnailWriteArgs(
  files: ReadonlyArray<{ kind: string; path: string }>,
  bytes: Buffer,
  width?: number,
  height?: number,
  custom = false,
): WriteFileArgs {
  /** A refreshed web save lists its new image after the archive files. */
  const primary =
    files.find((file) => isOriginalImageKind(file.kind))?.path ??
    primaryOriginalPath(files);
  const write: WriteFileArgs = {
    kind: THUMBNAIL_KIND,
    filename: primary ? thumbnailFilename(primary) : TEXT_THUMBNAIL_WEBP_FILE,
    bytes,
    mimeType: "image/webp",
  };
  if (width) write.width = width;
  if (height) write.height = height;
  if (custom) write.custom = true;
  return write;
}

/** Cards prefer `thumbnail_dark` in dark mode, so any new thumbnail has to replace both. */
export const THUMBNAIL_REPLACE_KINDS = [THUMBNAIL_KIND, THUMBNAIL_DARK_KIND];

export async function persistSaveThumbnail(
  saveId: string,
  bytes: Buffer,
  actorReason: string,
): Promise<boolean> {
  const db = await getDb();
  const row = db.select().from(saves).where(eq(saves.id, saveId)).all()[0];
  if (!row) return false;
  const meta = await sharp(bytes)
    .metadata()
    .catch(() => null);
  const updated = await persistSave(
    saveId,
    {},
    {
      actorReason,
      replaceFilesWithKind: THUMBNAIL_REPLACE_KINDS,
      newFiles: [
        thumbnailWriteArgs(
          row.files ?? [],
          bytes,
          meta?.width ?? undefined,
          meta?.height ?? undefined,
          true,
        ),
      ],
    },
  );
  return Boolean(updated);
}

export async function ensureSaveThumbnail(
  saveId: string,
  save?: Pick<Save, "files"> | null,
  options: { force?: boolean } = {},
): Promise<void> {
  const files = save?.files;
  if (!files?.length) return;
  const primary = thumbnailToRender(files, options.force === true);
  if (!primary) return;
  const thumbnail = await renderThumbnail(saveFile(saveId, primary.path));
  if (!thumbnail) return;
  const meta = await sharp(thumbnail)
    .metadata()
    .catch(() => null);
  try {
    await persistSave(
      saveId,
      {},
      {
        actorReason: "pipeline:ensure-thumbnail",
        replaceFilesWithKind: THUMBNAIL_REPLACE_KINDS,
        newFiles: [
          thumbnailWriteArgs(
            files,
            thumbnail,
            meta?.width ?? undefined,
            meta?.height ?? undefined,
          ),
        ],
      },
    );
  } catch (err) {
    log.warn("[pond thumbnail] could not write sidecar", saveId, err);
  }
}
