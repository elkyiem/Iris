import { IconVolume } from "@pond/icons";
import { Logo } from "@pond/ui";
import appIcon from "@/assets/setup/app-icon.png";
import styles from "./styles.module.css";

export function SoundToast() {
  return (
    <span className={styles.toasts}>
      <span className={styles.toast} data-ghost />
      <span className={styles.toast}>
        Moved to Trash
        <IconVolume size={12} className={styles.accent} />
      </span>
    </span>
  );
}

export function LoginDock() {
  return (
    <span className={styles.dock}>
      <span className={styles.slot} />
      <span className={styles.running}>
        <img className={styles.app} src={appIcon} alt="" />
      </span>
      <span className={styles.slot} />
    </span>
  );
}

export function MenuBarStatus() {
  return (
    <span className={styles.status}>
      <span className={styles.menubar}>
        <span className={styles.tray}>
          <Logo size={12} aria-hidden />
        </span>
        <IconVolume size={12} />
        <span className={styles.clock}>Sun 9:41</span>
      </span>
      <span className={styles.menu}>
        <span>New</span>
        <span>Import</span>
        <span>Sources</span>
      </span>
    </span>
  );
}
