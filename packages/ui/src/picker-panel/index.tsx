import { clsx as cn } from "clsx";
import {
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type Ref,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, type ButtonProps } from "../button";
import { Popover } from "../popover";
import { stopPageHotkeys } from "../stop-page-hotkeys";
import { Item, ItemIcon, ItemLabel, ItemMeta, SelectionMark } from "./item";
import styles from "./styles.module.css";

export type { PickerSelectionState } from "./item";

type ArrowKey = "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp";

export function nextPickerIndex(
  current: number,
  length: number,
  key: ArrowKey,
  columns = 1,
): number {
  if (length <= 0) return -1;
  const safeCurrent = current >= 0 && current < length ? current : 0;
  const step =
    key === "ArrowDown"
      ? Math.max(1, columns)
      : key === "ArrowUp"
        ? -Math.max(1, columns)
        : key === "ArrowRight"
          ? 1
          : -1;
  return (safeCurrent + step + length) % length;
}

function domId(prefix: string, value: string) {
  return `${prefix}-${value.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function isArrowKey(key: string): key is ArrowKey {
  return (
    key === "ArrowDown" ||
    key === "ArrowUp" ||
    key === "ArrowLeft" ||
    key === "ArrowRight"
  );
}

export interface PickerCursorOptions<T> {
  activeId?: string | null;
  collectionId?: string;
  columns?: number;
  getId(item: T): string;
  items: readonly T[];
  onActivate(item: T): void;
  onActiveIdChange?(id: string | null): void;
  onHorizontalKey?(key: "ArrowLeft" | "ArrowRight", item: T): boolean;
  onTab?(direction: 1 | -1): void;
}

export function usePickerCursor<T>({
  activeId: controlledActiveId,
  collectionId: requestedCollectionId,
  columns = 1,
  getId,
  items,
  onActivate,
  onActiveIdChange,
  onHorizontalKey,
  onTab,
}: PickerCursorOptions<T>) {
  const reactId = useId().replace(/:/g, "");
  const collectionId = requestedCollectionId ?? `picker-collection-${reactId}`;
  const itemDomPrefix = `${collectionId}-item`;
  const [internalActiveId, setInternalActiveId] = useState<string | null>(null);
  const composing = useRef(false);
  const ids = useMemo(() => items.map(getId), [getId, items]);
  const requestedActiveId = controlledActiveId ?? internalActiveId;
  const activeId =
    requestedActiveId && ids.includes(requestedActiveId)
      ? requestedActiveId
      : (ids[0] ?? null);
  const activeIndex = activeId ? ids.indexOf(activeId) : -1;

  function setActiveId(id: string | null) {
    if (controlledActiveId === undefined) setInternalActiveId(id);
    onActiveIdChange?.(id);
  }

  useEffect(() => {
    if (!activeId) return;
    const activeElement = document.getElementById(
      domId(itemDomPrefix, activeId),
    );
    activeElement?.scrollIntoView?.({ block: "nearest" });
  }, [activeId, itemDomPrefix]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const { key } = event;

    if (event.key === "Tab" && onTab) {
      event.preventDefault();
      onTab(event.shiftKey ? -1 : 1);
      return;
    }

    if (isArrowKey(key) && items.length > 0) {
      const activeItem = activeIndex >= 0 ? items[activeIndex] : items[0];
      if (
        activeItem &&
        (key === "ArrowLeft" || key === "ArrowRight") &&
        onHorizontalKey?.(key, activeItem)
      ) {
        event.preventDefault();
        return;
      }
      if (columns === 1 && (key === "ArrowLeft" || key === "ArrowRight"))
        return;
      event.preventDefault();
      const next = nextPickerIndex(activeIndex, items.length, key, columns);
      setActiveId(next >= 0 ? (ids[next] ?? null) : null);
      return;
    }

    if (event.key === "Enter" && !composing.current && activeIndex >= 0) {
      const item = items[activeIndex];
      if (!item) return;
      event.preventDefault();
      onActivate(item);
    }
  }

  function getItemProps(item: T) {
    const id = getId(item);
    return {
      id: domId(itemDomPrefix, id),
      active: id === activeId,
      onClick: () => onActivate(item),
      onMouseDown: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
      onPointerMove: (_event: PointerEvent<HTMLElement>) => setActiveId(id),
    };
  }

  return {
    activeId,
    activeIndex,
    collectionId,
    getItemProps,
    inputProps: {
      "aria-activedescendant": activeId
        ? domId(itemDomPrefix, activeId)
        : undefined,
      "aria-autocomplete": "list" as const,
      "aria-controls": collectionId,
      "aria-expanded": true,
      role: "combobox" as const,
      onCompositionEnd: () => {
        composing.current = false;
      },
      onCompositionStart: () => {
        composing.current = true;
      },
      onKeyDown,
    },
    setActiveId,
  };
}

function Positioner({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof Popover.Positioner>) {
  return (
    <Popover.Positioner
      {...props}
      sideOffset={sideOffset}
      className={cn(styles.positioner, className)}
    />
  );
}

type TriggerProps = Omit<
  React.ComponentProps<typeof Popover.Trigger>,
  "className"
> &
  Pick<
    ButtonProps,
    "className" | "icon" | "rounding" | "size" | "variant" | "width"
  >;

function Trigger({
  className,
  icon,
  rounding,
  size,
  variant,
  width,
  ...props
}: TriggerProps) {
  return (
    <Popover.Trigger
      render={
        props.render ? (
          props.render
        ) : (
          <Button
            className={className}
            icon={icon}
            rounding={rounding}
            size={size}
            variant={variant ?? "secondary"}
            width={width}
          />
        )
      }
      {...props}
    />
  );
}

function Popup({
  className,
  ...props
}: React.ComponentProps<typeof Popover.Popup>) {
  return <Popover.Popup {...props} className={cn(styles.popup, className)} />;
}

function Surface({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn(styles.surface, className)} />;
}

function Header({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn(styles.header, className)} />;
}

const Search = forwardRef(function Search(
  { className, onKeyDown, ...props }: React.ComponentProps<"input">,
  ref: Ref<HTMLInputElement>,
) {
  return (
    <input
      {...props}
      ref={ref}
      type="text"
      spellCheck={false}
      className={cn(styles.search, className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        stopPageHotkeys(event);
      }}
    />
  );
});

function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn(styles.toolbar, className)} />;
}

function ToolbarButton({
  active,
  className,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      {...props}
      type="button"
      data-active={active ? "" : undefined}
      className={cn(styles["toolbar-button"], className)}
    />
  );
}

function Body({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn(styles.body, className)} />;
}

function Sidebar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-scroll-fade="vertical"
      {...props}
      className={cn(styles.sidebar, className)}
    />
  );
}

function Collection({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-scroll-fade="vertical"
      {...props}
      className={cn(styles.collection, className)}
    />
  );
}

function Group({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn(styles.group, className)} />;
}

function GroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn(styles["group-label"], className)} />;
}

function SectionButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      {...props}
      type="button"
      className={cn(styles["section-button"], className)}
    />
  );
}

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn(styles.empty, className)} />;
}

function Footer({ className, ...props }: React.ComponentProps<"div">) {
  return <div {...props} className={cn(styles.footer, className)} />;
}

function Hint({ className, ...props }: React.ComponentProps<"span">) {
  return <span {...props} className={cn(styles.hint, className)} />;
}

export const PickerPanel = {
  Root: Popover.Root,
  Trigger,
  Portal: Popover.Portal,
  Positioner,
  Popup,
  Close: Popover.Close,
  Surface,
  Header,
  Search,
  Toolbar,
  ToolbarButton,
  Body,
  Sidebar,
  Collection,
  Group,
  GroupLabel,
  SectionButton,
  Item,
  SelectionMark,
  ItemIcon,
  ItemLabel,
  ItemMeta,
  Empty,
  Footer,
  Hint,
};
