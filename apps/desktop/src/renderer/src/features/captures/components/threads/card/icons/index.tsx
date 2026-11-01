import type { SVGProps } from "react";

export function MetaVerifiedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 22 22" fill="currentColor" role="img" {...props}>
      <title>Verified</title>
      <circle cx="11" cy="11" r="11" />
      <path
        d="M6.4 11.2 9.2 14l6.4-6.4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
