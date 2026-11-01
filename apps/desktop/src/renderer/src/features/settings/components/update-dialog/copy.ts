import type { UpdateNotice } from "@shared/update-notice";

export function updateDialogCopy(notice: UpdateNotice) {
  if (notice.phase === "downloaded") {
    return {
      title: "Update Ready",
      description: `Restart to install Pond ${notice.version} now. Otherwise, it installs when you quit.`,
      action: "Restart",
    };
  }
  if (notice.downloading) return null;
  return {
    title: "Update Available",
    description: `Pond ${notice.version} is ready to download.`,
    action: "Download",
  };
}
