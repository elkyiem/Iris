import type { Transaction } from "@pond/schema/tx";
import { executeBatch } from "./executor";
import { recordBatchForUndo } from "./undo";

/** Takes a Save out of Trash the way Restore does, as one Undo step. */
export async function restoreSave(
  id: string,
  actorReason: string,
): Promise<void> {
  const restore: Transaction[] = [
    {
      kind: "untrash",
      model: "save",
      id,
      meta: { actor: "user", actorReason },
    },
  ];
  await executeBatch(restore);
  recordBatchForUndo(restore);
}
