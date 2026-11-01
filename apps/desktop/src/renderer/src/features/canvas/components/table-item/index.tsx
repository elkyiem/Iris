import { cssVars, Input } from "@pond/ui";
import { type NodeProps, NodeResizer } from "@xyflow/react";
import { clsx as cn } from "clsx";
import { useEffect, useRef } from "react";
import { FIGURE_EDGE, NOTE_FILL } from "../../lib/colors";
import type { TableNode } from "../../lib/document";
import { MIN_SIZE } from "../../lib/transform";
import { useBoard } from "../board/context";
import { Handles } from "../handles";
import styles from "./styles.module.css";

function withCell(
  rows: readonly string[][],
  row: number,
  column: number,
  text: string,
): string[][] {
  return rows.map((cells, r) =>
    r === row ? cells.map((cell, c) => (c === column ? text : cell)) : cells,
  );
}

export function TableItem({
  id,
  data,
  selected,
  draggable,
}: NodeProps<TableNode>) {
  const board = useBoard();
  const editing = board.editingId === id;
  const grid = useRef<HTMLTableElement>(null);
  const target = useRef("0-0");

  useEffect(() => {
    const table = grid.current;
    if (!table) return;
    const remember = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const cell = event.target.closest<HTMLElement>("[data-cell]");
      if (cell?.dataset.cell) target.current = cell.dataset.cell;
    };
    table.addEventListener("dblclick", remember, { capture: true });
    return () =>
      table.removeEventListener("dblclick", remember, { capture: true });
  }, []);

  useEffect(() => {
    if (!editing) return;
    grid.current
      ?.querySelector<HTMLTextAreaElement>(
        `textarea[data-cell="${target.current}"]`,
      )
      ?.focus();
  }, [editing]);

  return (
    <div className={styles.bounds}>
      <NodeResizer
        isVisible={selected && draggable && !editing && !data.rotation}
        minWidth={MIN_SIZE.table.width}
        minHeight={MIN_SIZE.table.height}
        onResizeStart={board.record}
      />
      <Handles />
      <div
        className={styles.frame}
        data-selected={selected || undefined}
        style={
          data.rotation
            ? { transform: `rotate(${data.rotation}deg)` }
            : undefined
        }
      >
        <table
          ref={grid}
          aria-label="Table"
          className={styles.table}
          data-size={data.textSize}
          data-font={data.font}
          data-align={data.align}
          style={cssVars({
            "--table-head": NOTE_FILL[data.color],
            "--table-edge": FIGURE_EDGE[data.color],
          })}
        >
          <tbody>
            {data.rows.map((cells, row) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position
              <tr key={row}>
                {cells.map((cell, column) => {
                  const key = `${row}-${column}`;
                  const Cell = row === 0 ? "th" : "td";
                  return (
                    <Cell key={key} className={styles.cell} data-cell={key}>
                      {editing ? (
                        <Input.Textarea
                          data-cell={key}
                          appearance="bare"
                          rows={2}
                          className={cn(
                            styles.field,
                            "nodrag",
                            "nowheel",
                            "nopan",
                          )}
                          aria-label={`Row ${row + 1}, Column ${column + 1}`}
                          value={cell}
                          onChange={(event) =>
                            board.setRows(
                              id,
                              withCell(
                                data.rows,
                                row,
                                column,
                                event.currentTarget.value,
                              ),
                            )
                          }
                          onBlur={(event) => {
                            const next = event.relatedTarget;
                            if (
                              next instanceof Node &&
                              grid.current?.contains(next)
                            )
                              return;
                            board.finishEditing(id);
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Escape")
                              event.currentTarget.blur();
                          }}
                        />
                      ) : (
                        cell
                      )}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
