import { describe, expect, it } from "vitest";
import { updateDialogCopy } from "./copy";

describe("updateDialogCopy", () => {
  it("stays quiet while an automatic download runs", () => {
    expect(
      updateDialogCopy({
        phase: "available",
        version: "1.0.2",
        downloading: true,
      }),
    ).toBeNull();
  });

  it("offers Download when the build is not downloading yet", () => {
    expect(
      updateDialogCopy({
        phase: "available",
        version: "1.0.2",
        downloading: false,
      }),
    ).toEqual({
      title: "Update Available",
      description: "Pond 1.0.2 is ready to download.",
      action: "Download",
    });
  });

  it("offers Restart after the download finishes", () => {
    expect(updateDialogCopy({ phase: "downloaded", version: "1.0.2" })).toEqual(
      {
        title: "Update Ready",
        description:
          "Restart to install Pond 1.0.2 now. Otherwise, it installs when you quit.",
        action: "Restart",
      },
    );
  });
});
