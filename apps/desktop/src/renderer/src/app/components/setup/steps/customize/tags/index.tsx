import { IconPlus } from "@pond/icons";
import { Chip } from "@pond/ui";
import styles from "./styles.module.css";

export function SuggestedTags() {
  return (
    <span className={styles.tags}>
      <Chip.Root>
        <Chip.Item tone="tag">Travel</Chip.Item>
        <Chip.Action tone="suggested" tabIndex={-1}>
          <IconPlus size={10} />
          Beach
        </Chip.Action>
      </Chip.Root>
      <span className={styles.ghosts}>
        <span />
        <span />
      </span>
    </span>
  );
}
