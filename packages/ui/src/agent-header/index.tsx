import type { ComponentProps } from "react";
import { Pane } from "../pane-header";
import styles from "./styles.module.css";

export function AgentHeader({
  title,
  subtitle,
  children,
  ...props
}: Omit<ComponentProps<"header">, "title"> & {
  title: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <Pane.Header
      {...props}
      title={
        <>
          {title}
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </>
      }
    >
      {children}
    </Pane.Header>
  );
}
