import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Accordion } from ".";

describe("Accordion", () => {
  it("marks bare triggers so headers can lay out their own title", () => {
    const markup = renderToStaticMarkup(
      <Accordion.Root>
        <Accordion.Item value="bare">
          <Accordion.Header>
            <Accordion.Trigger variant="bare">Details</Accordion.Trigger>
          </Accordion.Header>
        </Accordion.Item>
        <Accordion.Item value="default">
          <Accordion.Header>
            <Accordion.Trigger>Activity</Accordion.Trigger>
          </Accordion.Header>
        </Accordion.Item>
      </Accordion.Root>,
    );

    expect(markup.match(/data-variant="bare"/g)).toHaveLength(1);
  });
});
