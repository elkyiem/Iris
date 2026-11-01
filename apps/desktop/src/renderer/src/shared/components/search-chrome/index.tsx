import { Input as Base } from "@pond/ui";
import { clsx as cn } from "clsx";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
} from "react";
import styles from "./styles.module.css";

interface RootProps extends ComponentPropsWithoutRef<"div"> {
  filters?: ReactNode;
  actions?: ReactNode;
  below?: ReactNode;
  tone?: "plain" | "header";
}

function Root({
  children,
  filters,
  actions,
  below,
  className,
  tone,
  ...props
}: RootProps) {
  return (
    <div className={cn(styles.root, className)} data-tone={tone} {...props}>
      <div className={styles.bar}>
        <div className={styles.search}>{children}</div>
        {filters ? (
          <div className={styles.filters} data-scroll-fade="horizontal">
            {filters}
          </div>
        ) : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {below ? <div className={styles.below}>{below}</div> : null}
    </div>
  );
}

interface InputProps extends ComponentPropsWithoutRef<typeof Base.Field> {
  variant?: "primary" | "secondary" | "borderless";
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, variant = "borderless", ...props },
  ref,
) {
  return (
    <Base.Root
      className={cn(styles.input, className)}
      size="md"
      variant={variant}
    >
      <Base.Field
        ref={ref}
        className={styles.field}
        appearance={variant === "borderless" ? "bare" : undefined}
        {...props}
      />
    </Base.Root>
  );
});

export const SearchChrome = { Root, Input };
