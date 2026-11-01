import { IconCheck, IconFile } from "@pond/icons";
import { useState } from "react";
import { Button } from "../button";
import { Input } from "../input";
import type { ReferenceItem } from "../reference-list";
import styles from "./styles.module.css";

export function ContextPicker({
  items,
  selectedIds,
  onSelectedIdsChange,
  query,
  onQueryChange,
}: {
  items: ReferenceItem[];
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: string[]) => void;
  query?: string;
  onQueryChange?: (query: string) => void;
}) {
  const [localQuery, setLocalQuery] = useState("");
  const value = query ?? localQuery;
  const visible = onQueryChange
    ? items
    : items.filter((item) =>
        `${item.title} ${item.meta ?? ""}`
          .toLowerCase()
          .includes(value.toLowerCase()),
      );
  return (
    <div className={styles["context-picker"]}>
      <Input.Root size="sm">
        <Input.Field
          aria-label="Search context"
          placeholder="Search your Saves…"
          value={value}
          onValueChange={(next) => {
            setLocalQuery(next);
            onQueryChange?.(next);
          }}
        />
      </Input.Root>
      <fieldset
        className={styles.list}
        aria-label="Context"
        data-scroll-fade="vertical"
      >
        {visible.length ? (
          visible.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className={styles.row}
              aria-label={item.title}
              aria-pressed={selectedIds.includes(item.id)}
              onClick={() =>
                onSelectedIdsChange(
                  selectedIds.includes(item.id)
                    ? selectedIds.filter((id) => id !== item.id)
                    : [...selectedIds, item.id],
                )
              }
            >
              <span className={styles.media}>{item.media ?? <IconFile />}</span>
              <span className={styles.content}>
                <span className={styles.title}>{item.title}</span>
                <span className={styles.meta}>{item.meta}</span>
              </span>
              <span className={styles["selection-mark"]}>
                {selectedIds.includes(item.id) && <IconCheck />}
              </span>
            </Button>
          ))
        ) : (
          <div className={styles.empty}>No matching Saves</div>
        )}
      </fieldset>
      <div className={styles.footer} aria-live="polite">
        {selectedIds.length} selected
        {selectedIds.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onSelectedIdsChange([])}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
