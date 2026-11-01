import { Button, Switch } from "@pond/ui";
import type { FishSummary } from "@shared/fish-contracts";
import { describeWhen } from "@shared/fish-routine";
import { setRoutinePaused } from "../../../lib/menu";
import { fish as fishStore } from "../../../state/fish";
import styles from "./styles.module.css";

export function RoutineList({ fish }: { fish: FishSummary }) {
  if (!fish.routines.length)
    return <p className={styles.empty}>Ask in chat to set a routine.</p>;
  return (
    <ul className={styles.list}>
      {fish.routines.map((routine) => (
        <li key={routine.id} className={styles.row}>
          <Button
            variant="bare"
            className={styles.open}
            onClick={() => fishStore.openRoutine(fish.id, routine.id)}
          >
            <span className={styles.name}>{routine.name}</span>
            <span className={styles.schedule}>
              {routine.paused ? "Paused" : describeWhen(routine.when)}
            </span>
          </Button>
          <Switch.Root
            className={styles.switch}
            checked={!routine.paused}
            aria-label={`${routine.paused ? "Resume" : "Pause"} ${routine.name}`}
            onCheckedChange={(checked) =>
              setRoutinePaused(fish, routine, !checked)
            }
          />
        </li>
      ))}
    </ul>
  );
}
