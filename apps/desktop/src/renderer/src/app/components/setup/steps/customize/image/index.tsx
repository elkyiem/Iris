import { IconScanImage, IconSparkle } from "@pond/icons";
import { Art } from "../../../demo";
import { Score, Thumb } from "../results";
import styles from "./styles.module.css";

export function ScannedText() {
  return (
    <span className={styles.scan}>
      <span className={styles.panel} data-tilt>
        <span className={styles.found}>Spring Menu</span>
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} data-short />
      </span>
      <span className={styles.pill}>
        <IconScanImage size={12} />
        Spring Menu
      </span>
    </span>
  );
}

export function CaptionedPhoto() {
  return (
    <span className={styles.captioned}>
      <span className={styles.frame}>
        <Art kind="sunset" size="slot" />
      </span>
      <span className={styles.pill}>
        <IconSparkle size={10} className={styles.accent} />
        Boats at sunset
      </span>
    </span>
  );
}

export function SimilarPhotos() {
  return (
    <span className={styles.similar}>
      <span className={styles.frame} data-source>
        <Art kind="sunset" size="slot" />
      </span>
      <span className={styles.links}>
        <span />
        <span />
      </span>
      <span className={styles.matches}>
        <span className={styles.match}>
          <Thumb kind="sunset" />
          <Score>96%</Score>
        </span>
        <span className={styles.match}>
          <Thumb kind="mountain" />
          <Score>91%</Score>
        </span>
      </span>
    </span>
  );
}
