import fs from "node:fs";
import path from "node:path";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"]);
const proseExtensions = new Set([".txt", ".md", ".markdown", ".rtf"]);

export function inspectArtifactAvailability(record: { filePath?: string; fileName?: string; sourceUrl?: string | null; type?: string }, workspaceRoot = process.cwd()) {
  const filePath = String(record.filePath || "").replaceAll("\\", "/");
  const fileName = String(record.fileName || filePath.split("/").at(-1) || "");
  const extension = fileName.includes(".") ? `.${fileName.split(".").at(-1)}`.toLowerCase() : "";
  const mediaKind = imageExtensions.has(extension) || record.type === "image" ? "image" : extension === ".pdf" || record.type === "pdf" ? "pdf" : proseExtensions.has(extension) || record.type === "prose" ? "prose" : "other";
  const sourceAbsolute = filePath ? path.join(workspaceRoot, ...filePath.split("/")) : null;
  const sourceExists = Boolean(sourceAbsolute && fs.existsSync(sourceAbsolute));
  const publicCandidates = [
    filePath.startsWith("public/") ? filePath : null,
    fileName ? `public/artifacts/${fileName}` : null,
  ].filter(Boolean) as string[];
  const publicRelative = publicCandidates.find((candidate) => fs.existsSync(path.join(workspaceRoot, ...candidate.split("/")))) || null;
  const servedUrl = publicRelative ? `/${publicRelative.replace(/^public\//, "").split("/").map(encodeURIComponent).join("/")}` : null;
  const external = Boolean(record.sourceUrl);
  const notImported = filePath.startsWith("imports/raw/");
  let status: "available" | "external" | "not-imported" | "internal" | "missing" | "metadata";
  if (servedUrl) status = "available";
  else if (external && !sourceExists) status = "external";
  else if (notImported) status = "not-imported";
  else if (sourceExists) status = "internal";
  else if (filePath) status = "missing";
  else status = "metadata";
  const label = { available:"File available", external:"External source only", "not-imported":"Not yet imported", internal:"Internal only", missing:"Missing file", metadata:"Metadata only" }[status];
  return {
    status, label, mediaKind, sourceExists, publicExists:Boolean(servedUrl), servedUrl,
    expectedPath:filePath || "No filePath recorded", sourceUrl:record.sourceUrl || null,
    showImagePreview:status === "available" && mediaKind === "image",
    showFileLink:status === "available" && ["image", "pdf", "prose"].includes(mediaKind),
  };
}
