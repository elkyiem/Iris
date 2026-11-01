import { clsx as cn } from "clsx";
import type { ComponentProps } from "react";
import styles from "./styles.module.css";

function Root({
  className,
  containerClassName,
  ...props
}: ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div
      className={cn(styles.container, containerClassName)}
      data-scroll-fade="horizontal"
    >
      <table className={cn(styles.table, className)} {...props} />
    </div>
  );
}

function Header({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn(styles.header, className)} {...props} />;
}

function Body({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn(styles.body, className)} {...props} />;
}

function Footer({ className, ...props }: ComponentProps<"tfoot">) {
  return <tfoot className={cn(styles.footer, className)} {...props} />;
}

function Row({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn(styles.row, className)} {...props} />;
}

function Head({ className, ...props }: ComponentProps<"th">) {
  return <th className={cn(styles.header, className)} {...props} />;
}

function Cell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn(styles.cell, className)} {...props} />;
}

function Caption({ className, ...props }: ComponentProps<"caption">) {
  return <caption className={cn(styles.caption, className)} {...props} />;
}

export const Table = {
  Root,
  Header,
  Body,
  Footer,
  Row,
  Head,
  Cell,
  Caption,
};
