import {
  IconFolderOpen,
  IconFolderPen,
  IconMediaPause,
  IconMediaPlay,
  IconTrash,
} from "@pond/icons";
import { Dialog, type MenuItemSpec } from "@pond/ui";
import type { SourceActionSections } from "@/features/sources/lib/source-menu";
import { pickWatchedFolder } from "@/features/sources/lib/watched-folder";
import { formatPlural } from "@/shared/lib/format";
import {
  hostDeviceName,
  isBrowserRuntime,
  REVEAL_LABEL,
} from "@/shared/lib/platform";
import { notify } from "@/shared/lib/toast";

interface FolderMenuTarget {
  name: string;
  imported: number;
  watching: boolean;
}

function revealLabel() {
  return isBrowserRuntime() ? `Browse on ${hostDeviceName()}` : REVEAL_LABEL;
}

async function revealFolder(name: string): Promise<void> {
  const result = await window.pond.query("autoImport.reveal", {});
  if (result.ok) return;
  notify({
    id: "folder-reveal",
    title: `Couldn't find ${name}. Change the folder to keep importing.`,
  });
}

async function setWatching(
  enabled: boolean,
  onChanged: () => void,
): Promise<void> {
  await window.pond.query("autoImport.set", { enabled });
  onChanged();
}

function confirmStop(target: FolderMenuTarget, onChanged: () => void): void {
  const count = target.imported;
  const fileCount = formatPlural(count, { one: "file", other: "files" });
  Dialog.confirm({
    title: "Stop Watching",
    description: `Pond stops importing new files from ${target.name}. The ${fileCount} already imported stay in your library.`,
    confirmLabel: "Stop",
    onConfirm: async () => {
      await window.pond.query("autoImport.set", { enabled: false, path: "" });
      onChanged();
    },
  });
}

/** The folder menu as Settings rows, for the details dialog. */
export function buildFolderRows(
  target: FolderMenuTarget & { path: string },
  onChanged: () => void,
): SourceActionSections {
  return {
    kind: "Folder",
    profile: [
      {
        id: "location",
        title: "Location",
        value: target.path,
        actions: [
          {
            label: revealLabel(),
            onClick: () => void revealFolder(target.name),
          },
          {
            label: "Change",
            name: "Change Folder",
            onClick: () => void pickWatchedFolder(),
          },
        ],
      },
    ],
    fetch: [],
    connection: [
      {
        id: "watching",
        title: target.watching ? "Pause Watching" : "Resume Watching",
        description: target.watching
          ? "Pond stops importing new files until you resume."
          : "Pond imports new files from the folder again.",
        actions: [
          {
            label: target.watching ? "Pause" : "Resume",
            name: target.watching ? "Pause Watching" : "Resume Watching",
            onClick: () => void setWatching(!target.watching, onChanged),
          },
        ],
      },
      {
        id: "remove",
        title: "Stop Watching",
        description: "Files already in your library stay.",
        actions: [
          {
            label: "Stop",
            variant: "destructive",
            onClick: () => confirmStop(target, onChanged),
          },
        ],
      },
    ],
  };
}

export function buildFolderMenu(
  target: FolderMenuTarget,
  onChanged: () => void,
): MenuItemSpec[] {
  return [
    {
      type: "group",
      items: [
        {
          label: revealLabel(),
          icon: <IconFolderOpen />,
          onClick: () => void revealFolder(target.name),
        },
        {
          label: "Change Folder",
          icon: <IconFolderPen />,
          onClick: () => void pickWatchedFolder(),
        },
      ],
    },
    { type: "separator" },
    {
      type: "group",
      items: [
        {
          label: target.watching ? "Pause Watching" : "Resume Watching",
          icon: target.watching ? <IconMediaPause /> : <IconMediaPlay />,
          onClick: () => void setWatching(!target.watching, onChanged),
        },
        {
          label: "Stop Watching",
          icon: <IconTrash />,
          variant: "destructive",
          onClick: () => confirmStop(target, onChanged),
        },
      ],
    },
  ];
}
