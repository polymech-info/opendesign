import fs from "node:fs";
import path from "node:path";

import { queryNodes, resolveDesignDocument, serializeDsl } from "./design/index.js";
import { pickDesign } from "./cli-export.js";

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "design"
  );
}

function loadPage(cwd: string, query: string | undefined, pageNumber: number, command: string) {
  const design = pickDesign(cwd, query, command);
  const pages = [...(design.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const pageCount = Math.max(1, pages.length);
  if (pageNumber < 1 || pageNumber > pageCount) {
    throw new Error(
      `Page ${pageNumber} missing (${pageCount} page${pageCount === 1 ? "" : "s"})`,
    );
  }
  const page = pages[pageNumber - 1];
  if (!page) throw new Error(`Design "${design.name}" has no saved page`);
  const doc = resolveDesignDocument([page.canvas_json, design.canvas_json]);
  if (!doc) {
    throw new Error(
      `Page ${pageNumber} has no Design DSL. Open it in the editor and save once first.`,
    );
  }
  return { design, page, pageCount, doc };
}

export function designDslMarkdown(name: string, page: number, dsl: string): string {
  return [
    `# ${name} — Page ${page}`,
    "",
    "````opendesign",
    dsl.trimEnd(),
    "````",
    "",
  ].join("\n");
}

export function exportDslMarkdown(opts: {
  cwd: string;
  query?: string;
  page: number;
  out?: string;
}): string {
  const { design, pageCount, doc } = loadPage(opts.cwd, opts.query, opts.page, "export");
  const filename =
    pageCount > 1 ? `${slug(design.name)}-p${opts.page}.md` : `${slug(design.name)}.md`;
  const out = path.resolve(opts.cwd, opts.out || filename);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, designDslMarkdown(design.name, opts.page, serializeDsl(doc)), "utf8");
  return out;
}

export function queryDesignDsl(opts: {
  cwd: string;
  designQuery?: string;
  page: number;
  query: string;
  fields?: string[];
  limit?: number;
}) {
  const { design, page, doc } = loadPage(opts.cwd, opts.designQuery, opts.page, "query");
  const items = queryNodes(doc, {
    query: opts.query,
    fields: opts.fields,
    limit: opts.limit,
  });
  return {
    design: { id: design.id, name: design.name },
    page: { id: page.id, number: opts.page, title: page.title },
    query: opts.query,
    count: items.length,
    items,
  };
}
