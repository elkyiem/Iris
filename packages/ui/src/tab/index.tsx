import { IconXmark } from "@pond/icons";
import { clsx as cn } from "clsx";
import { useLayoutEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "../button";
import styles from "./styles.module.css";

function List({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(styles.list, className)}
      data-scroll-fade="horizontal"
      {...props}
    />
  );
}

function Item({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn(styles.item, className)} {...props} />;
}

function Icon({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn(styles.icon, className)} {...props} />;
}

function Avatar({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn(styles.avatar, className)} {...props} />;
}

function Label({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: children is the trigger, not a read
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const next = el.scrollWidth - el.clientWidth > 1;
      setOverflow((current) => (current === next ? current : next));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  return (
    <span
      {...props}
      ref={ref}
      className={cn(styles.label, className)}
      data-overflow={overflow || undefined}
    >
      {children}
    </span>
  );
}

function Action({ className, ...props }: ButtonProps) {
  return (
    <Button
      icon
      size="xs"
      variant="ghost"
      className={cn(styles.action, className)}
      {...props}
    />
  );
}

function Close({ className, children, ...props }: ButtonProps) {
  return (
    <Action className={className} {...props}>
      {children ?? <IconXmark size={12} />}
    </Action>
  );
}

export const Tab = { List, Item, Icon, Avatar, Label, Action, Close };
