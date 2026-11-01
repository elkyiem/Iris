import type { Prefs } from "@pond/schema";
import type { Folder } from "@pond/schema/db";
import { folderColorCss } from "@/shared/lib/folder-icons";
import { FolderCover } from "../../cover";
import { Row } from "../../sidebar-row";
import styles from "./styles.module.css";

interface FolderDragPreviewProps {
  folder: Folder;
  presentation: Prefs["folderViews"][string] | undefined;
  status: string | undefined;
  active: boolean;
  badgeStyle: Prefs["sidebar"]["badgeStyle"];
  count: number | undefined;
  depth: number | undefined;
}

export function FolderDragPreview({
  folder,
  presentation,
  status,
  active,
  badgeStyle,
  count,
  depth,
}: FolderDragPreviewProps) {
  return (
    <div className={styles.overlay}>
      <Row
        label={folder.name}
        icon={
          <span
            style={
              folder.color
                ? {
                    color: folderColorCss(folder.color),
                  }
                : undefined
            }
          >
            <FolderCover
              icon={presentation?.icon}
              coverSaveId={presentation?.coverSaveId}
            />
          </span>
        }
        status={status}
        active={active}
        badgeStyle={badgeStyle}
        count={count}
        depth={depth}
        tabIndex={-1}
      />
    </div>
  );
}
