import type { SectionConfig } from "@/features/settings/components/engine";
import { BrowserConnections } from "@/features/settings/components/sections/browser-connections";
import { LibrarySettings } from "@/features/settings/components/sections/library";
import { trashSection } from "@/features/settings/lib/config-trash";

export const librarySection: SectionConfig = {
  title: "Library",
  description: "Manage the open library.",
  keywords: [
    "library",
    "identity",
    "name",
    "logo",
    "icon",
    "browsers",
    "devices",
    "pairing",
  ],
  groups: [
    {
      title: "Library",
      fullWidth: true,
      render: () => (
        <>
          <LibrarySettings />
          <BrowserConnections />
        </>
      ),
    },
    ...(trashSection.groups ?? []).map((group) => ({
      ...group,
      prefsKey: "trash" as const,
    })),
  ],
};
