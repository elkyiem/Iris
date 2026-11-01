import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScrollArea } from ".";

describe("ScrollArea", () => {
  it("fades vertical edges unless told otherwise", () => {
    const vertical = renderToStaticMarkup(<ScrollArea>Rows</ScrollArea>);
    const horizontal = renderToStaticMarkup(
      <ScrollArea orientation="horizontal">Chips</ScrollArea>,
    );

    expect(vertical).toContain('data-scroll-fade="vertical"');
    expect(horizontal).toContain('data-scroll-fade="horizontal"');
  });

  it("keeps caller attributes and classes on the scroller", () => {
    const markup = renderToStaticMarkup(
      <ScrollArea aria-label="Saves" className="list" tabIndex={0}>
        Rows
      </ScrollArea>,
    );

    expect(markup).toContain('aria-label="Saves"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toMatch(/class="[^"]*\blist\b/);
  });
});
