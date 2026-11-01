import { IconCopy } from "@pond/icons";
import { Button } from "@pond/ui";
import { Section } from "@/shared/components/inspector-section";
import { notify } from "@/shared/lib/toast";
import styles from "./styles.module.css";

export function EnrichedText({ title, text }: { title: string; text: string }) {
  async function copy() {
    await window.pond.query("clipboard.writeText", { text });
    notify({ id: "copy-enriched-text", title: `Copied ${title}` });
  }

  return (
    <Section
      title={title}
      action={
        <Button
          type="button"
          icon
          size="xs"
          variant="ghost"
          aria-label={`Copy ${title}`}
          onClick={() => void copy()}
        >
          <IconCopy />
        </Button>
      }
    >
      <div className={styles.root}>
        <p className={styles.text} data-scroll-fade="vertical">
          {text}
        </p>
      </div>
    </Section>
  );
}
