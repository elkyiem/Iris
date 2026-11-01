import { IconStarFill } from "@pond/icons";
import { Button } from "@pond/ui";
import styles from "./styles.module.css";

export function RatingStars({
  value,
  onChange,
}: {
  value: number | null;
  onChange(value: number): void;
}) {
  return (
    <fieldset
      className={styles.root}
      aria-label={
        value === null
          ? "Multiple ratings"
          : `Rating: ${value ? `${value} of 5 stars` : "Unrated"}. Select the current rating to remove it.`
      }
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = value !== null && star <= value;
        return (
          <Button
            key={star}
            icon
            variant="bare"
            aria-label={`${star} ${star === 1 ? "Star" : "Stars"}`}
            aria-pressed={star === value}
            data-active={filled || undefined}
            className={styles.star}
            onClick={() => onChange(value === star ? 0 : star)}
          >
            <IconStarFill size={14} />
          </Button>
        );
      })}
    </fieldset>
  );
}
