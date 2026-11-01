import { IconCheck, IconLink2, IconPlus } from "@pond/icons";
import type { ReactNode } from "react";
import { Button } from "../button";
import styles from "./styles.module.css";

export interface ReferenceItem {
  id: string;
  title: string;
  description?: string;
  meta?: string;
  media?: ReactNode;
}

export function ReferenceList({
  items,
  onOpen,
  onAdd,
  addedIds = [],
  empty = "No references for this response",
}: {
  items: ReferenceItem[];
  onOpen: (item: ReferenceItem) => void;
  onAdd?: (item: ReferenceItem) => void;
  addedIds?: readonly string[];
  empty?: string;
}) {
  if (!items.length) return <div className={styles.empty}>{empty}</div>;
  return (
    <div className={styles.list}>
      {items.map((item) => (
        <article key={item.id} className={styles.row}>
          <Button
            variant="ghost"
            className={styles.open}
            aria-label={`Open ${item.title}`}
            onClick={() => onOpen(item)}
          >
            <span className={styles.media}>{item.media ?? <IconLink2 />}</span>
            <span className={styles.content}>
              <span className={styles.title}>{item.title}</span>
              {item.meta && <span className={styles.meta}>{item.meta}</span>}
              {item.description && (
                <span className={styles.description}>{item.description}</span>
              )}
            </span>
          </Button>
          {onAdd && (
            <Button
              size="xs"
              icon
              variant="ghost"
              aria-label={`${addedIds.includes(item.id) ? "Added" : "Add"} ${item.title}`}
              disabled={addedIds.includes(item.id)}
              onClick={() => onAdd(item)}
            >
              {addedIds.includes(item.id) ? <IconCheck /> : <IconPlus />}
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}
