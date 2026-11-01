import { IconArrowUp, IconChevronDown, IconPaperclip } from "@pond/icons";
import { AnimatePresence, motion } from "motion/react";
import { POP } from "../script";
import styles from "./styles.module.css";

export function Composer({
  typed,
  working,
}: {
  typed: string;
  working: boolean;
}) {
  return (
    <div className={styles.composer}>
      {typed ? (
        <span className={styles.draft}>
          {typed}
          <span className={styles.caret} />
        </span>
      ) : (
        <span className={styles.placeholder}>Ask about your Saves</span>
      )}
      <span className={styles.toolbar}>
        <span className={styles.model}>
          Gemma 4
          <IconChevronDown size={10} />
        </span>
        <span className={styles.tools}>
          <IconPaperclip size={12} />
          <span
            className={styles.send}
            data-ready={typed.length > 0 || working || undefined}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {working ? (
                <motion.span key="stop" className={styles.stop} {...POP} />
              ) : (
                <motion.span key="send" className={styles.arrow} {...POP}>
                  <IconArrowUp size={10} />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        </span>
      </span>
    </div>
  );
}
