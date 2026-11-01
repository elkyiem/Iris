import { useSelector } from "@tanstack/react-store";
import type { RowData } from "@tanstack/react-table";
import { clsx as cn } from "clsx";
import type { ReactNode } from "react";
import { useDataTable } from "../context";
import styles from "./styles.module.css";

interface ActionBarSelection {
  count: number;
  ids: string[];
  clear: () => void;
}

export function DataTableActionBar<T extends RowData>({
  children,
  className,
}: {
  children: ReactNode | ((selection: ActionBarSelection) => ReactNode);
  className?: string;
}) {
  const { selectionStore, actions } = useDataTable<T>();
  const count = useSelector(selectionStore, (s) => s.selectedIds.size);
  if (count === 0) return null;
  const selection: ActionBarSelection = {
    count,
    ids: Array.from(selectionStore.state.selectedIds),
    clear: actions.clearSelection,
  };
  return (
    <div
      className={cn(styles.bar, className)}
      role="toolbar"
      aria-label="Bulk Actions"
    >
      {children instanceof Function ? children(selection) : children}
    </div>
  );
}

export function DataTableActionBarDivider() {
  return <span className={styles.divider} aria-hidden />;
}
