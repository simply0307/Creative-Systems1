---
title: "Creative Asset System Index"
entityType: "artifact"
summary: "The current inventory workbook: useful as a migration scaffold, insufficient as the final domain model."
canonStatus: "flexible-inspiration"
reviewFlags: ["data-quality-review"]
tags: ["artifact", "index", "spreadsheet", "migration"]
reuseCategories: ["project planning"]
relatedProjects: ["Archive app"]
relatedConcepts: ["foundation"]
openDecisions: []
remediationTasks: ["DAT-01", "DAT-02", "DAT-03", "DAT-04", "DAT-05", "DAT-06"]
sourceArtifacts: ["Index/creative_asset_system_index.xlsx", "Index/readme.txt"]
riskFlags: ["shifted-metadata", "filename-keys", "absolute-paths"]
version: "current"
provenance: "Existing organizational scaffold inspected during the Archive Diagnostic."
featured: false
---

## Keep

The master inventory, browsable views, controlled labels, subject/faction filtering, and direct links to source files.

## Change

Use stable IDs and checksums, workspace-relative paths, typed entity relationships, separate canon and review state, and provenance/rights fields. The `assets` sheet should remain a generated view rather than a second source of truth.
