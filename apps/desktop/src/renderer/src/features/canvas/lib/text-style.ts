import type {
  CanvasAlign,
  CanvasFont,
  CanvasTextSize,
  CanvasValign,
} from "@shared/canvas-contracts";

export const TEXT_SIZE_LABELS = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  "extra-large": "Extra Large",
  huge: "Huge",
} satisfies Record<CanvasTextSize, string>;

export const FONT_LABELS = {
  simple: "Plain",
  bookish: "Bookish",
  technical: "Technical",
} satisfies Record<CanvasFont, string>;

export const ALIGN_LABELS = {
  left: "Left",
  center: "Center",
  right: "Right",
} satisfies Record<CanvasAlign, string>;

export const VALIGN_LABELS = {
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
} satisfies Record<CanvasValign, string>;

export interface TextStyle {
  textSize?: CanvasTextSize;
  font?: CanvasFont;
  align?: CanvasAlign;
  valign?: CanvasValign;
  bold?: boolean;
  strike?: boolean;
}

export const CODE_LANGUAGES = [
  { id: "text", label: "Plain Text" },
  { id: "typescript", label: "TypeScript" },
  { id: "tsx", label: "TSX" },
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "swift", label: "Swift" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "ruby", label: "Ruby" },
  { id: "php", label: "PHP" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "json", label: "JSON" },
  { id: "yaml", label: "YAML" },
  { id: "markdown", label: "Markdown" },
  { id: "sql", label: "SQL" },
  { id: "bash", label: "Shell" },
] as const;

export function languageLabel(id: string): string {
  return CODE_LANGUAGES.find((language) => language.id === id)?.label ?? id;
}
