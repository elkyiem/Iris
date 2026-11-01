import { IconExternalLink } from "@pond/icons";
import { Button, Tooltip } from "@pond/ui";
import { mutateSave } from "@/features/saves/lib/mutate";
import type { Save } from "@/features/saves/types";
import {
  type InspectorDrafts,
  InspectorTextField,
} from "@/shared/components/inspector-text-field";
import styles from "./styles.module.css";

export function SaveIdentity({
  save,
  drafts,
  cacheKey,
}: {
  save: Save | undefined;
  drafts: InspectorDrafts;
  cacheKey: string;
}) {
  const url = save && /^https?:\/\//.test(save.url ?? "") ? save.url : "";
  return (
    <div className={styles.root}>
      <div className={styles.field}>
        <span className={styles.label}>Name</span>
        <InspectorTextField
          drafts={drafts}
          cacheKey={`${cacheKey}:title`}
          label="Title"
          value={save ? (save.title ?? "") : null}
          multiline
          disabled={!save}
          variant="secondary"
          padding="compact"
          placeholder="Untitled"
          mixedPlaceholder="Multiple titles"
          commit={async (value) => {
            if (!save) return;
            await mutateSave(
              save.id,
              { title: value.trim() || null },
              { actorReason: "user:rename", throwOnError: true },
            );
          }}
        />
      </div>
      {save ? (
        <div className={styles.field}>
          <span className={styles.label}>URL</span>
          <InspectorTextField
            drafts={drafts}
            cacheKey={`${cacheKey}:url`}
            label="Source URL"
            value={url}
            placeholder="No source URL"
            maxLength={8192}
            variant="secondary"
            suffix={
              url ? (
                <Tooltip label="Open in Browser">
                  <Button
                    type="button"
                    icon
                    size="xs"
                    variant="ghost"
                    className={styles.open}
                    aria-label="Open Source URL"
                    onClick={() => void window.pond.openExternal(url)}
                  >
                    <IconExternalLink size={12} />
                  </Button>
                </Tooltip>
              ) : null
            }
            commit={async (value) => {
              await mutateSave(
                save.id,
                { url: value.trim() },
                { actorReason: "user:edit-source-url", throwOnError: true },
              );
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
