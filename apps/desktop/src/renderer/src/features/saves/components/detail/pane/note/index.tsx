import {
  type InspectorDrafts,
  InspectorTextField,
} from "@/shared/components/inspector-text-field";
import styles from "./styles.module.css";

export function SaveNote({
  value,
  drafts,
  cacheKey,
  commit,
}: {
  value: string | null;
  drafts: InspectorDrafts;
  cacheKey: string;
  commit(value: string): Promise<void>;
}) {
  return (
    <div className={styles.root}>
      <span className={styles.label}>Note</span>
      <InspectorTextField
        drafts={drafts}
        cacheKey={cacheKey}
        label="Notes"
        value={value}
        multiline
        variant="secondary"
        padding="compact"
        placeholder="Add a note"
        commit={commit}
      />
    </div>
  );
}
