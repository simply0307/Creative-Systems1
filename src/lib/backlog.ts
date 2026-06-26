import fs from "node:fs";
import path from "node:path";

export type BacklogItem = {
  id: string;
  title: string;
  category: string;
  problem: string;
  why: string;
  affected: string;
  fix: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  output: string;
  workType: string;
  needsDecision: string;
};

let cache: BacklogItem[] | undefined;

const field = (body: string, label: string) => {
  const match = body.match(new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.+)$`, "m"));
  return match?.[1]?.trim() ?? "";
};

export function getBacklog(): BacklogItem[] {
  if (cache) return cache;
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, "REMEDIATION_BACKLOG.md"), "utf8");
  const categories = [...source.matchAll(/^## \d+\. (.+)$/gm)];
  const items: BacklogItem[] = [];

  categories.forEach((categoryMatch, categoryIndex) => {
    const start = categoryMatch.index ?? 0;
    const end = categories[categoryIndex + 1]?.index ?? source.length;
    const section = source.slice(start, end);
    const issueMatches = [...section.matchAll(/^### ([A-Z]{3}-\d{2}) — (.+)$/gm)];

    issueMatches.forEach((issueMatch, issueIndex) => {
      const issueStart = issueMatch.index ?? 0;
      const issueEnd = issueMatches[issueIndex + 1]?.index ?? section.length;
      const body = section.slice(issueStart, issueEnd);
      items.push({
        id: issueMatch[1],
        title: issueMatch[2].trim(),
        category: categoryMatch[1].trim(),
        problem: field(body, "Problem"),
        why: field(body, "Why it matters"),
        affected: field(body, "Affected concepts/files"),
        fix: field(body, "Recommended fix"),
        priority: (field(body, "Priority") || "Medium") as BacklogItem["priority"],
        output: field(body, "Output needed"),
        workType: field(body, "Work type"),
        needsDecision: field(body, "Needs user decision before proceeding"),
      });
    });
  });

  cache = items;
  return items;
}

export const taskHref = (id: string) => `/workbench/${id.toLowerCase()}`;
export const isDecision = (item: BacklogItem) => item.category === "Decision Log Items";
export const isOpenDecision = (item: BacklogItem) => isDecision(item) || item.needsDecision.startsWith("Yes");
