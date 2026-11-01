import { Outlet } from "@tanstack/react-router";
import styles from "./styles.module.css";

export function SettingsPage() {
  return (
    <div className={styles.page} data-scroll-fade="vertical">
      <Outlet />
    </div>
  );
}
