import { IconXmark } from "@pond/icons";
import { Button, type ButtonProps, Keyboard, Tooltip } from "@pond/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { gentleSpring } from "@/shared/lib/motion";
import styles from "./styles.module.css";

interface RootProps {
  label: string;
  count: number;
  onClear: () => void;
  children: ReactNode;
}

/** Floats over the bottom of the nearest positioned ancestor while rows are selected. */
function Root({ label, count, onClear, children }: RootProps) {
  const reduceMotion = useReducedMotion();
  return (
    <Tooltip.Group>
      <div className={styles.dock}>
        <AnimatePresence initial={false}>
          {count > 0 ? (
            <motion.div
              key="selection"
              role="toolbar"
              aria-label={label}
              className={styles.bar}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{
                opacity: 0,
                y: 8,
                pointerEvents: "none",
                transition: { duration: reduceMotion ? 0 : 0.12 },
              }}
              transition={reduceMotion ? { duration: 0 } : gentleSpring}
            >
              <span className={styles.count} aria-live="polite">
                <span className={styles.number}>{count}</span> selected
              </span>
              <div className={styles.actions} data-scroll-fade="horizontal">
                {children}
              </div>
              <Tooltip
                label="Clear Selection"
                shortcut={<Keyboard.Cluster keys={["Esc"]} />}
                side="top"
              >
                <Button
                  icon
                  size="sm"
                  variant="ghost"
                  aria-label="Clear Selection"
                  onClick={onClear}
                >
                  <IconXmark size={12} />
                </Button>
              </Tooltip>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Tooltip.Group>
  );
}

interface ActionProps
  extends Omit<ButtonProps, "icon" | "size" | "variant" | "aria-label"> {
  label: string;
}

/** Stays focusable while disabled so its tooltip still names the icon. */
function Action({ label, ...props }: ActionProps) {
  return (
    <Tooltip label={label} side="top">
      <Button
        icon
        size="sm"
        variant="ghost"
        aria-label={label}
        focusableWhenDisabled
        {...props}
      />
    </Tooltip>
  );
}

export const SelectionBar = { Root, Action };
