import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  type ScreenReaderInstructions,
  useDndContext,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { RowData } from "@tanstack/react-table";
import { useReducedMotionConfig } from "motion/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { SelectAllCell, stop } from "../cells";
import { useDataTable } from "../context";
import type { HeaderContext, TableColumn } from "../types";
import styles from "./styles.module.css";

const COLUMN_DROP_ANIMATION = {
  duration: 150,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
};

const COLUMN_SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: "To move a column, drag its name left or right.",
};

function headerContent<T extends RowData>(
  column: TableColumn<T>,
  sorted: false | "asc" | "desc",
): ReactNode {
  return column.header instanceof Function
    ? column.header({ sorted } satisfies HeaderContext)
    : (column.header ?? null);
}

function SortCaret({ sorted }: { sorted: "asc" | "desc" }) {
  return (
    <svg
      className={styles["sort-caret"]}
      data-desc={sorted === "desc" || undefined}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <path
        d="M2.5 4 L5 6.5 L7.5 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeaderCell<T extends RowData>({
  column,
  pinned,
}: {
  column: TableColumn<T>;
  pinned: boolean;
}) {
  const { actions, meta } = useDataTable<T>();
  const headRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const reduceMotion = useReducedMotionConfig();
  const { activatorEvent } = useDndContext();
  const keyboardDrag = activatorEvent?.type.startsWith("key") ?? false;
  const sortable = Boolean(column.accessor);
  const sorted = meta.getSorted(column.id);
  const content = headerContent(column, sorted);
  const {
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: column.id,
    disabled: { draggable: !column.reorderable },
  });

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = headRef.current?.getBoundingClientRect().width ?? 0;
    const move = (ev: PointerEvent) => {
      actions.resizeColumn(
        column.id,
        Math.max(column.minWidth ?? 48, startWidth + (ev.clientX - startX)),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const width = headRef.current?.getBoundingClientRect().width ?? 0;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    actions.resizeColumn(column.id, width + direction * 8);
  };

  const reorderWithKeyboard = (event: ReactKeyboardEvent) => {
    if (
      !column.reorderable ||
      !event.altKey ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    )
      return;
    const index = meta.columns.findIndex((item) => item.id === column.id);
    const offset = event.key === "ArrowLeft" ? -1 : 1;
    const target = meta.columns[index + offset];
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    actions.reorderColumns(column.id, target.id);
  };

  const resizeHandle = column.resizable ? (
    <button
      type="button"
      className={styles["resize-handle"]}
      aria-label={`Resize ${column.sortLabel ?? column.id} column`}
      onPointerDown={startResize}
      onKeyDown={resizeWithKeyboard}
      onClick={stop}
    />
  ) : null;

  return (
    <div
      ref={(node) => {
        headRef.current = node;
        setNodeRef(node);
        if (column.reorderable) setActivatorNodeRef(node);
      }}
      role="columnheader"
      onPointerDown={
        column.reorderable
          ? (event) => {
              dragOrigin.current = { x: event.clientX, y: event.clientY };
              listeners?.onPointerDown?.(event);
            }
          : undefined
      }
      className={styles.cell}
      data-align={column.align}
      data-pinned={pinned || undefined}
      data-dragging={isDragging || undefined}
      aria-hidden={column.headerHidden || undefined}
      aria-sort={
        sortable
          ? sorted === "asc"
            ? "ascending"
            : sorted === "desc"
              ? "descending"
              : "none"
          : undefined
      }
      style={{
        transform: CSS.Transform.toString(transform),
        transition: reduceMotion || keyboardDrag ? "none" : transition,
      }}
    >
      {column.headerHidden ? null : sortable ? (
        <button
          type="button"
          className={styles["sort-button"]}
          data-active={sorted ? true : undefined}
          aria-label={`Sort by ${column.sortLabel ?? column.id}`}
          aria-keyshortcuts={
            column.reorderable ? "Alt+ArrowLeft Alt+ArrowRight" : undefined
          }
          onKeyDown={reorderWithKeyboard}
          onClick={(event) => {
            const origin = dragOrigin.current;
            dragOrigin.current = null;
            if (
              origin &&
              Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 3
            )
              return;
            actions.toggleSort(column.id);
          }}
        >
          {content}
          {sorted ? <SortCaret sorted={sorted} /> : null}
        </button>
      ) : (
        <span className={styles.static}>{content}</span>
      )}
      {resizeHandle}
    </div>
  );
}

function HeaderOverlay<T extends RowData>({
  column,
}: {
  column: TableColumn<T>;
}) {
  const { meta } = useDataTable<T>();
  const sorted = meta.getSorted(column.id);
  return (
    <div
      className={styles.cell}
      data-align={column.align}
      data-overlay
      aria-hidden
    >
      <span className={styles.static}>{headerContent(column, sorted)}</span>
      {sorted ? <SortCaret sorted={sorted} /> : null}
    </div>
  );
}

export function DataTableHeader<T extends RowData>() {
  const { actions, meta, selectionStore } = useDataTable<T>();
  const rowIds = useMemo(() => meta.rows.map((row) => row.id), [meta.rows]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [keyboardDrag, setKeyboardDrag] = useState(false);
  const reduceMotion = useReducedMotionConfig();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const ids = meta.columns.map((column) => column.id);
  const activeColumn = activeId
    ? meta.columns.find((column) => column.id === activeId)
    : undefined;
  const labelFor = (id: string | number) => {
    const column = meta.columns.find((item) => item.id === String(id));
    return `${column?.sortLabel ?? column?.id ?? "Column"} column`;
  };

  return (
    <DndContext
      accessibility={{
        screenReaderInstructions: COLUMN_SCREEN_READER_INSTRUCTIONS,
        announcements: {
          onDragStart: ({ active }) => `Picked up ${labelFor(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${labelFor(active.id)} is over ${labelFor(over.id)}, position ${ids.indexOf(String(over.id)) + 1} of ${ids.length}.`
              : `${labelFor(active.id)} is no longer over a column.`,
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${labelFor(active.id)} at position ${ids.indexOf(String(over.id)) + 1} of ${ids.length}.`
              : `${labelFor(active.id)} was dropped without moving.`,
          onDragCancel: ({ active }) =>
            `Moving ${labelFor(active.id)} was canceled.`,
        },
      }}
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      sensors={sensors}
      onDragStart={({ active, activatorEvent }) => {
        setActiveId(String(active.id));
        setKeyboardDrag(activatorEvent.type.startsWith("key"));
      }}
      onDragCancel={() => {
        setActiveId(null);
        setKeyboardDrag(false);
      }}
      onDragEnd={({ active, over }: DragEndEvent) => {
        setActiveId(null);
        setKeyboardDrag(false);
        if (over && active.id !== over.id)
          actions.reorderColumns(String(active.id), String(over.id));
      }}
    >
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        <div ref={meta.headerRef} className={styles.scroll} role="rowgroup">
          <div
            role="row"
            aria-rowindex={1}
            className={styles.row}
            style={{ gridTemplateColumns: meta.gridTemplate }}
          >
            {meta.selectionEnabled && meta.selectionCheckboxes ? (
              <SelectAllCell
                store={selectionStore}
                rowIds={rowIds}
                onToggleAll={actions.toggleAll}
              />
            ) : null}
            {meta.expansionEnabled ? (
              <div role="columnheader" className={styles.cell} aria-hidden />
            ) : null}
            {meta.columns.map((column, index) => (
              <HeaderCell
                key={column.id}
                column={column}
                pinned={index === 0}
              />
            ))}
          </div>
        </div>
      </SortableContext>
      {!globalThis.document
        ? null
        : createPortal(
            <DragOverlay
              dropAnimation={
                reduceMotion || keyboardDrag ? null : COLUMN_DROP_ANIMATION
              }
              modifiers={[restrictToHorizontalAxis]}
            >
              {activeColumn ? <HeaderOverlay column={activeColumn} /> : null}
            </DragOverlay>,
            document.body,
          )}
    </DndContext>
  );
}
