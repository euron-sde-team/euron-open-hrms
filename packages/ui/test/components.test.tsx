import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cn } from "../src/lib/cn";
import { Button } from "../src/components/button";
import { Card, CardHeader } from "../src/components/card";
import { Input } from "../src/components/input";
import { PageHeader } from "../src/components/page-header";

/** Class list of the first element in a static render. */
function classesOf(html: string): string[] {
  const m = /class="([^"]*)"/.exec(html);
  return m?.[1]?.split(/\s+/) ?? [];
}

describe("cn", () => {
  it("lets a caller's utility beat a component default", () => {
    expect(cn("px-4 py-2", "px-6")).toBe("py-2 px-6");
  });

  it("drops falsy conditionals", () => {
    const active = false;
    expect(cn("a", active && "b", undefined, "c")).toBe("a c");
  });
});

describe("Button", () => {
  it("renders the 44px default size and the primary variant", () => {
    const classes = classesOf(renderToStaticMarkup(<Button>Save</Button>));
    expect(classes).toContain("h-11");
    expect(classes).toContain("bg-primary");
  });

  it("merges a caller's width over the default", () => {
    const classes = classesOf(renderToStaticMarkup(<Button className="w-full">Go</Button>));
    expect(classes).toContain("w-full");
  });
});

describe("Card", () => {
  it("lets header tracks shrink (minmax) so actions never overflow the card", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader>Title</CardHeader>
      </Card>
    );
    expect(html).toContain("grid-cols-[minmax(0,1fr)]");
    expect(html).not.toMatch(/grid-cols-\[1fr_auto\]/);
  });
});

describe("Input", () => {
  it("exposes inputSize as data-size and keeps padding overridable", () => {
    const html = renderToStaticMarkup(<Input inputSize="lg" className="pl-11" />);
    expect(html).toContain('data-size="lg"');
    expect(classesOf(html)).toContain("pl-11");
  });
});

describe("PageHeader", () => {
  it("renders title, description and actions", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Employees" description="Everyone in the workspace." actions={<button>Add</button>} />
    );
    expect(html).toContain("<h1");
    expect(html).toContain("Employees");
    expect(html).toContain("Everyone in the workspace.");
    expect(html).toContain("<button>Add</button>");
  });

  it("omits the description paragraph when there is none", () => {
    expect(renderToStaticMarkup(<PageHeader title="Only a title" />)).not.toContain("<p");
  });
});
