import { clsx as cn } from "clsx";
import styles from "./styles.module.css";

export type ScrollAreaOrientation = "vertical" | "horizontal";

interface ScrollAreaProps extends React.ComponentPropsWithRef<"div"> {
  orientation?: ScrollAreaOrientation;
}

/** The fade lives in `reset.css` so any existing scroller can opt in with `data-scroll-fade`. */
export function ScrollArea({
  orientation = "vertical",
  className,
  ...props
}: ScrollAreaProps) {
  return (
    <div
      className={cn(styles.area, className)}
      data-scroll-fade={orientation}
      {...props}
    />
  );
}
