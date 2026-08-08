import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const readJsonDir = (relative) => {
  const dir = path.join(root, relative);
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
};

const parseValue = (value) => {
  const text = value.trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  try { return JSON.parse(text); } catch { return text.replace(/^['"]|['"]$/g, ""); }
};

const readArchive = () => {
  const dir = path.join(root, "src/content/archive");
  return fs.readdirSync(dir).filter((name) => name.endsWith(".md")).sort().map((name) => {
    const raw = fs.readFileSync(path.join(dir, name), "utf8");
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) throw new Error(`Missing frontmatter in ${name}`);
    const data = {};
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      data[line.slice(0, separator).trim()] = parseValue(line.slice(separator + 1));
    }
    return { id: name.replace(/\.md$/, ""), ...data, body: match[2].trim() };
  });
};

const backlogField = (body, label) => body.match(new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
const readBacklog = () => {
  const source = fs.readFileSync(path.join(root, "REMEDIATION_BACKLOG.md"), "utf8");
  const categories = [...source.matchAll(/^## \d+\. (.+)$/gm)];
  const items = [];
  categories.forEach((category, categoryIndex) => {
    const section = source.slice(category.index, categories[categoryIndex + 1]?.index ?? source.length);
    const issues = [...section.matchAll(/^### ([A-Z]{3}-\d{2}) — (.+)$/gm)];
    issues.forEach((issue, issueIndex) => {
      const body = section.slice(issue.index, issues[issueIndex + 1]?.index ?? section.length);
      items.push({
        id: issue[1], title: issue[2].trim(), category: category[1].trim(),
        problem: backlogField(body, "Problem"), why: backlogField(body, "Why it matters"),
        affected: backlogField(body, "Affected concepts/files"), fix: backlogField(body, "Recommended fix"),
        priority: backlogField(body, "Priority"), output: backlogField(body, "Output needed"),
        workType: backlogField(body, "Work type"), needsDecision: backlogField(body, "Needs user decision before proceeding"),
      });
    });
  });
  return items;
};

const archive = readArchive();
const artifacts = readJsonDir("src/content/artifacts");
const importBatches = readJsonDir("src/content/import-batches");
const exportBundles = readJsonDir("src/content/export-bundles");
const pipelineTasks = readJsonDir("src/content/pipeline-tasks");
const remediation = readBacklog();
const generatedAt = new Date().toISOString();
// These repository-derived bundles are review artifacts, not public or canonical runtime exports.
// Canonical exports are private Supabase records/objects served through /api/creative-os/exports.
const outDir = path.join(root, ".generated/exports");
fs.mkdirSync(outDir, { recursive: true });

const writeJson = (name, data) => fs.writeFileSync(path.join(outDir, name), JSON.stringify({ generatedAt, ...data }, null, 2) + "\n");
writeJson("full-creative-os.json", { archive, artifacts, importBatches, exportBundles, pipelineTasks, remediation });
writeJson("archive-index.json", { archive: archive.map(({ body, ...entry }) => entry) });
writeJson("export-manifest.json", { bundles: exportBundles });

const blockingRisk = /legal|gambling|paid|rights|monetization|private|cashout/i;
const publicArchive = archive.filter((entry) => !["retired", "experimental"].includes(entry.canonStatus) && !entry.riskFlags.some((flag) => blockingRisk.test(flag)) && entry.entityType !== "artifact");
writeJson("public-archive.json", { publicationRule: "Excludes experimental/retired records, source artifacts, and legal/monetization/rights risks.", archive: publicArchive });

const paraArchive = archive.filter((entry) => entry.relatedProjects.some((project) => /para/i.test(project)) || entry.tags.some((tag) => /para/i.test(tag)));
const paraArtifacts = artifacts.filter((item) => item.relatedProjects.some((project) => /para/i.test(project)));
const paraTasks = remediation.filter((item) => /^(PPR|LGL)-/.test(item.id));
writeJson("para-pack.json", { publicationStatus: "internal-review-required", archive: paraArchive, artifacts: paraArtifacts, remediation: paraTasks });

const factionTypes = new Set(["alien-principle", "convergence", "morphling", "astral-vanguard", "mortal-civilization"]);
writeJson("faction-pack.json", { archive: archive.filter((entry) => factionTypes.has(entry.entityType)) });
writeJson("remediation-report.json", { remediation });
writeJson("decision-queue.json", { decisions: remediation.filter((item) => item.category === "Decision Log Items" || item.needsDecision.startsWith("Yes")) });

const csvFields = ["id","title","type","fileName","filePath","sourceType","sourceUrl","creator","rightsStatus","aiGenerated","aiModel","canonStatus","reviewStatus","riskFlags","tags","relatedArchiveRecords","relatedProjects","relatedTasks","importBatch","notes"];
const csvCell = (value) => `"${(Array.isArray(value) ? value.join(" | ") : value ?? "").toString().replaceAll('"', '""')}"`;
const csv = [csvFields.join(","), ...artifacts.map((item) => csvFields.map((key) => csvCell(item[key])).join(","))].join("\n") + "\n";
fs.writeFileSync(path.join(outDir, "artifact-index.csv"), csv);

const canon = archive.filter((entry) => ["foundation-canon", "strong-direction"].includes(entry.canonStatus));
const canonMd = [`# EGGS / Para Canon Bible`, ``, `Generated: ${generatedAt}`, ``, `> Strong direction remains visibly distinct from approved foundation canon.`, ``, ...canon.flatMap((entry) => [`## ${entry.title}`, ``, `**Status:** ${entry.canonStatus}`, ``, entry.summary, ``, entry.body, ``])].join("\n");
fs.writeFileSync(path.join(outDir, "canon-bible.md"), canonMd);

const starterMd = [`# EGGS Project Starter Pack`, ``, `Generated: ${generatedAt}`, ``, `## Reuse contract`, ``, `Choose at least one material derivation. Document its source, translation mode, player promise, and evidence. Intentional omission is valid.`, ``, `## Starting concepts`, ``, ...archive.filter((entry) => ["alien-principle","convergence","player-archetype","mechanic"].includes(entry.entityType)).map((entry) => `- **${entry.title}** — ${entry.summary}`), ``, `## Required checks`, ``, `- Confirm canon and project scope.`, `- Review linked remediation tasks.`, `- Check player-facing language.`, `- Check provenance and rights before publishing artifacts.`, `- Do not create paid competitive legitimacy or gambling-framed Para systems.`, ``].join("\n");
fs.writeFileSync(path.join(outDir, "project-starter-pack.md"), starterMd);

console.log(`Generated 9 review-only export bundles outside public/ from ${archive.length} archive records, ${artifacts.length} artifacts, and ${remediation.length} remediation items.`);
