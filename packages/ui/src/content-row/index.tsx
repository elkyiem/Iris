import { clsx as cn } from "clsx";
import type { ComponentProps } from "react";
import { Button, type ButtonProps } from "../button";
import styles from "./styles.module.css";

function Root({ className, ...props }: ComponentProps<"article">) {
  return <article className={cn(styles.root, className)} {...props} />;
}
function Trigger({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(styles.trigger, className)}
      {...props}
    />
  );
}
function Media({
  className,
  size = "icon",
  ...props
}: ComponentProps<"span"> & { size?: "icon" | "thumbnail" }) {
  return (
    <span className={cn(styles.media, className)} data-size={size} {...props} />
  );
}
function Content({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn(styles.content, className)} {...props} />;
}
function Title({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn(styles.title, className)} {...props} />;
}
function Description({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn(styles.description, className)} {...props} />;
}
function Action({
  size = "xs",
  variant = "ghost",
  icon = true,
  ...props
}: ButtonProps) {
  return <Button size={size} variant={variant} icon={icon} {...props} />;
}
export const ContentRow = {
  Root,
  Trigger,
  Media,
  Content,
  Title,
  Description,
  Action,
};
