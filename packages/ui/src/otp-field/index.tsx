import { OTPField as Base } from "@base-ui/react/otp-field";
import { clsx as cn } from "clsx";
import { stopPageHotkeys } from "../stop-page-hotkeys";
import styles from "./styles.module.css";

function Root({ className, ...props }: Base.Root.Props) {
  return <Base.Root {...props} className={cn(styles.root, className)} />;
}

function Input({ className, onKeyDown, ...props }: Base.Input.Props) {
  return (
    <Base.Input
      {...props}
      className={cn(styles.input, className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        stopPageHotkeys(event);
      }}
    />
  );
}

function Separator({ className, ...props }: Base.Separator.Props) {
  return (
    <Base.Separator {...props} className={cn(styles.separator, className)} />
  );
}

export const OTPField = { Root, Input, Separator };
