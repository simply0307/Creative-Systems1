import test from "node:test";
import assert from "node:assert/strict";
import operations from "../netlify/functions/operations.mjs";
import { GitHubAdapter, assertAllowedWritePath, githubConfigStatus } from "../netlify/functions/lib/github-adapter.mjs";
import { buildGitWritePlan, createOperationDraft, validateOperationPayload } from "../netlify/functions/lib/operation-planner.mjs";
import { evaluateOperationPolicy } from "../src/data/operation-policies.mjs";
import { actionsForLifecycle, buildOperationPresentation, classifyOperation } from "../src/data/operation-lifecycle.mjs";
import { readFile } from "node:fs/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectArtifactAvailability } from "../src/lib/artifact-availability.ts";

const decisionPayload = {
  operationType: "decision_resolution",
  submittedBy: "Archive editor",
  rationale: "Resolve the working name while preserving raw sources.",
  targets: ["zynarth"],
  decisionId: "DEC-01",
  resolution: { selected: "recommended", custom: "Use Zynarth in structured records." },
  affectedArchiveRecords: ["zynarth"],
  affectedSourceFiles: ["Archive/Prose/what are xynarth.txt"],
  affectedExports: ["export.canon-bible"],
  followUpNeeded: true,
  followUpTasks: ["FND-03"],
  rewritePlan: { automatic: "Update structured aliases.", humanReview: "Review prose references.", preserveRawSources: true },
};

const identityContext = (role, name = `${role} user`) => ({ clientContext:{ user:{ id:`user-${role}`, email:`${role}@example.test`, user_metadata:{full_name:name}, app_metadata:{roles:[role]} } } });
const operationEnvNames = ["GITHUB_TOKEN","GITHUB_OWNER","GITHUB_REPO","GITHUB_DEFAULT_BRANCH","GITHUB_AUTHOR_NAME","GITHUB_AUTHOR_EMAIL","OPERATIONS_ADMIN_KEY","OPERATIONS_ADMIN_KEY_FALLBACK","ADMIN_AUTO_APPROVE"];
const runRoleOperation = async (role, payload, { autoApprove="true", merge=true } = {}) => {
  const previous=Object.fromEntries(operationEnvNames.map(name=>[name,process.env[name]])),priorFetch=globalThis.fetch,pulls=[];let blobCount=0,commitCount=0;
  Object.assign(process.env,{GITHUB_TOKEN:"token",GITHUB_OWNER:"simply0307",GITHUB_REPO:"creative-systems1",GITHUB_DEFAULT_BRANCH:"main",GITHUB_AUTHOR_NAME:"Creative OS",GITHUB_AUTHOR_EMAIL:"os@example.test",ADMIN_AUTO_APPROVE:autoApprove});
  globalThis.fetch=async(url,options={})=>{const method=options.method||"GET";let body;if(url.includes("/git/ref/heads/main"))body={object:{sha:"base"}};else if(url.includes("/git/commits/base"))body={tree:{sha:"tree-base"}};else if(url.includes("/contents/src/content/artifacts/sample.json"))body={sha:"artifact",content:Buffer.from(JSON.stringify({id:"artifact.sample",title:"Sample",tags:[],relatedProjects:[]})).toString("base64")};else if(url.endsWith("/git/blobs"))body={sha:`blob-${++blobCount}`};else if(url.endsWith("/git/trees"))body={sha:`tree-${blobCount}`};else if(url.endsWith("/git/commits")&&method==="POST")body={sha:`commit-${++commitCount}`};else if(url.endsWith("/pulls")){pulls.push(JSON.parse(options.body));body={html_url:"https://github.com/simply0307/creative-systems1/pull/9",number:9,draft:pulls.at(-1).draft};}else if(url.endsWith("/pulls/9/merge"))body={merged:merge,sha:merge?"merge-sha":null,message:merge?undefined:"Branch protection"};else body={};return new Response(JSON.stringify(body),{status:200});};
  try { const response=await operations({httpMethod:"POST",headers:{},body:JSON.stringify(payload)},identityContext(role)); return {response,body:JSON.parse(response.body),pulls}; }
  finally {globalThis.fetch=priorFetch;operationEnvNames.forEach(name=>previous[name]===undefined?delete process.env[name]:process.env[name]=previous[name]);}
};

test("payload validation rejects unknown operations and unsafe IDs", () => {
  assert.throws(() => validateOperationPayload({ operationType: "delete_everything", submittedBy: "A", targets: ["x"] }), /Unsupported/);
  assert.throws(() => validateOperationPayload({ operationType: "change_log_entry", submittedBy: "A", targets: ["../escape"] }), /unsafe/);
});

test("payload validation limits batch size", () => {
  assert.throws(() => validateOperationPayload({ operationType: "bulk_artifact_metadata_update", submittedBy: "A", targets: Array.from({ length: 26 }, (_, i) => `artifact.${i}`) }), /cannot exceed 25/);
});

test("write paths are constrained", () => {
  assert.equal(assertAllowedWritePath("src/content/artifacts/example.json"), "src/content/artifacts/example.json");
  assert.throws(() => assertAllowedWritePath("src/content/archive/foundation.md"), /outside the allowlist/);
  assert.throws(() => assertAllowedWritePath("src/content/artifacts/../../secrets.txt"), /Unsafe/);
  assert.equal(assertAllowedWritePath("src/content/revert-requests/revert-operation.test.json"), "src/content/revert-requests/revert-operation.test.json");
});

test("approval policy classifies low, medium, and high risk operations", () => {
  const low = createOperationDraft(validateOperationPayload({ action: "metadata.update", actor: "A", targets: ["artifact.sample"], changes: { addTags: ["motif"] } }));
  assert.equal(evaluateOperationPolicy(low).riskLevel, "low");
  const medium = createOperationDraft(validateOperationPayload({ action: "metadata.update", actor: "A", targets: ["artifact.sample"], changes: { rightsStatus: "owned-internal" }, explicitConfirmation: true }));
  const mediumPolicy = evaluateOperationPolicy(medium);
  assert.equal(mediumPolicy.riskLevel, "medium");
  assert.equal(mediumPolicy.autoApproveAllowed, true);
  const high = createOperationDraft(validateOperationPayload({ action: "rewrite.plan", actor: "A", reason: "Review prose", targets: ["DEC-01"], rewritePlan: { automatic: "source prose rewrite" } }));
  assert.equal(evaluateOperationPolicy(high).riskLevel, "high");
  assert.equal(evaluateOperationPolicy(high).autoApproveAllowed, false);
});

test("decision write plan includes resolution, rewrite request, and change log", async () => {
  const draft = createOperationDraft(validateOperationPayload(decisionPayload), new Date("2026-06-18T12:00:00.000Z"));
  const plan = await buildGitWritePlan(draft, { readJson: async () => null });
  assert.equal(plan.decisionResolution.sourceFilesChanged, false);
  assert.equal(plan.decisionResolution.submittedBy, "Archive editor");
  assert.deepEqual(plan.decisionResolution.affectedExports, ["export.canon-bible"]);
  assert.equal(plan.sourceRewriteRequest.status, "needs-human-review");
  assert.equal(plan.changeLogEntry.operationType, "decision_resolution");
  assert.equal(plan.files.length, 3);
  const finalized = plan.finalizeFiles("https://github.com/simply0307/creative-systems1/pull/42");
  assert.equal(finalized.length, 3);
  assert.ok(finalized.every((file) => file.content.includes("pull/42")));
});

test("artifact metadata plan merges rather than replacing the record", async () => {
  const payload = validateOperationPayload({ action: "metadata.update", actor: "Editor", reason: "Classify", targets: ["artifact.sample"], changes: { addTags: ["reviewed"], rightsStatus: "owned-internal" } });
  const draft = createOperationDraft(payload, new Date("2026-06-18T12:00:00.000Z"));
  const plan = await buildGitWritePlan(draft, { readJson: async () => ({ data: { id: "artifact.sample", title: "Sample", tags: ["original"], relatedProjects: [] } }) });
  const artifact = JSON.parse(plan.files.find((file) => file.path.includes("artifacts/")) .content);
  assert.deepEqual(artifact.tags, ["original", "reviewed"]);
  assert.equal(artifact.rightsStatus, "owned-internal");
});

test("revert operation creates a request and audit record without claiming an inverse", async () => {
  const payload = validateOperationPayload({ operationType:"revert_operation", submittedBy:"Admin", rationale:"Undo incorrect tags", targets:["operation.original"], revertOperationId:"operation.original" });
  const draft = createOperationDraft(payload, new Date("2026-06-18T12:00:00.000Z"));
  const policyResult = evaluateOperationPolicy(draft);
  const plan = await buildGitWritePlan({ ...draft, policyResult, adminKeyAccepted:true, approvalMode:"manual-review-required" }, { readJson:async()=>null });
  assert.equal(plan.revertRequest.inverseApplied, false);
  assert.equal(plan.revertRequest.sourceFilesChanged, false);
  assert.equal(plan.files.length, 2);
  assert.match(plan.auditRecordPath, /src\/content\/change-log/);
});

test("invalid GitHub response shape fails visibly", async () => {
  const adapter = new GitHubAdapter({ env:{ GITHUB_TOKEN:"bad", GITHUB_OWNER:"simply0307", GITHUB_REPO:"creative-systems1", GITHUB_DEFAULT_BRANCH:"main", GITHUB_AUTHOR_NAME:"OS", GITHUB_AUTHOR_EMAIL:"os@example.test" }, fetchImpl:async()=>new Response("{}", { status:200 }) });
  await assert.rejects(() => adapter.getDefaultBranchState(), /sha|object|undefined/i);
});

test("authenticated user sees clear missing GitHub configuration", async () => {
  const names = ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_DEFAULT_BRANCH", "GITHUB_AUTHOR_NAME", "GITHUB_AUTHOR_EMAIL", "OPERATIONS_ADMIN_KEY"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  try {
    assert.equal(githubConfigStatus().configured, false);
    assert.throws(() => new GitHubAdapter(), /not configured/);
    const response = await operations({ httpMethod: "POST", body: JSON.stringify(decisionPayload) }, identityContext("admin"));
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 202);
    assert.equal(body.persistence, "browser-local-draft");
    assert.match(body.fallbackReason, /GitHub adapter not configured/);
    assert.equal(body.decisionResolution.sourceFilesChanged, false);
    assert.equal(body.changeLogEntry.operationType, "decision_resolution");
  } finally {
    names.forEach((name) => previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name]);
  }
});

test("invalid admin key fails closed and does not force GitHub writes", async () => {
  const previous = process.env.OPERATIONS_ADMIN_KEY;
  process.env.OPERATIONS_ADMIN_KEY = "correct-key";
  process.env.OPERATIONS_ADMIN_KEY_FALLBACK = "true";
  let fetchCalled = false;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error("must not call GitHub"); };
  try {
    const response = await operations({ httpMethod: "POST", headers: { "x-creative-os-key": "wrong-key" }, body: JSON.stringify({ action: "metadata.update", actor: "Editor", targets: ["artifact.sample"], changes: { addTags: ["motif"] } }) });
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 401);
    assert.equal(body.authenticated, false);
    assert.equal(body.userRole, "viewer");
    assert.equal(body.authMethod, "none");
    assert.equal(body.adminKeyAccepted, false);
    assert.match(body.fallbackReason, /Sign in/i);
    assert.equal(body.diagnostics.githubWriteAttempted, false);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = priorFetch;
    previous === undefined ? delete process.env.OPERATIONS_ADMIN_KEY : process.env.OPERATIONS_ADMIN_KEY = previous;
    delete process.env.OPERATIONS_ADMIN_KEY_FALLBACK;
  }
});

test("modern Netlify Request shape reaches the API", async () => {
  const previous = process.env.OPERATIONS_ADMIN_KEY;
  delete process.env.OPERATIONS_ADMIN_KEY;
  try {
    const response = await operations(new Request("https://example.netlify.app/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "metadata.update", actor: "Editor", targets: ["artifact.sample"], changes: { addTags: ["motif"] } }) }), identityContext("admin"));
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.diagnostics.apiReached, true);
    assert.equal(body.authMethod, "netlify-identity");
  } finally {
    previous === undefined ? delete process.env.OPERATIONS_ADMIN_KEY : process.env.OPERATIONS_ADMIN_KEY = previous;
  }
});

test("operations health endpoint reports configuration without secrets", async () => {
  const previous = process.env.GITHUB_DEFAULT_BRANCH;
  process.env.GITHUB_DEFAULT_BRANCH = "main";
  try {
    const response = await operations(new Request("https://example.netlify.app/api/operations"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.defaultBranch, "main");
    assert.equal(body.diagnostics.apiReached, true);
    assert.equal(JSON.stringify(body).includes("GITHUB_TOKEN"), false);
  } finally {
    previous === undefined ? delete process.env.GITHUB_DEFAULT_BRANCH : process.env.GITHUB_DEFAULT_BRANCH = previous;
  }
});

test("GitHub adapter stages a branch, commits files, and opens a draft PR", async () => {
  let blobCount = 0;
  let commitCount = 0;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    const method = options.method || "GET";
    let body;
    if (url.includes("/git/ref/heads/main")) body = { object: { sha: "base-commit" } };
    else if (url.includes("/git/commits/base-commit")) body = { tree: { sha: "base-tree" } };
    else if (url.endsWith("/git/blobs")) body = { sha: `blob-${++blobCount}` };
    else if (url.endsWith("/git/trees")) body = { sha: `tree-${blobCount}` };
    else if (url.endsWith("/git/commits") && method === "POST") body = { sha: `commit-${++commitCount}` };
    else if (url.endsWith("/pulls")) body = { html_url: "https://github.com/simply0307/creative-systems1/pull/42", number: 42, draft: true };
    else body = {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const adapter = new GitHubAdapter({
    env: {
      GITHUB_TOKEN: "secret-token", GITHUB_OWNER: "simply0307", GITHUB_REPO: "creative-systems1",
      GITHUB_DEFAULT_BRANCH: "main", GITHUB_AUTHOR_NAME: "Creative OS", GITHUB_AUTHOR_EMAIL: "os@example.test",
    },
    fetchImpl,
  });
  const result = await adapter.stageOperation({
    operationId: "operation.test",
    title: "Test operation",
    body: "Review this operation.",
    files: [{ path: "src/content/change-log/test.json", content: "{}\n" }],
    finalizeFiles: (url) => [{ path: "src/content/change-log/test.json", content: `${JSON.stringify({ pullRequestUrl: url })}\n` }],
  });
  assert.equal(result.pullRequestUrl, "https://github.com/simply0307/creative-systems1/pull/42");
  assert.equal(result.pullRequestStatus, "draft");
  assert.equal(commitCount, 2);
  assert.ok(calls.some((call) => call.url.endsWith("/git/refs") && call.method === "POST"));
  assert.ok(calls.some((call) => call.url.endsWith("/pulls") && call.method === "POST"));
  assert.ok(calls.every((call) => !call.url.includes("secret-token")));
});

test("explicit local owner mode accepts local drafts only when both local settings are present", async()=>{const names=["CREATIVE_OS_RUNTIME_CONTEXT","CREATIVE_OS_LOCAL_OWNER_MODE"],previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));Object.assign(process.env,{CREATIVE_OS_RUNTIME_CONTEXT:"local",CREATIVE_OS_LOCAL_OWNER_MODE:"true"});try{const response=await operations({httpMethod:"POST",headers:{},body:JSON.stringify({action:"metadata.update",actor:"Unknown",targets:["artifact.sample"],changes:{addTags:["motif"]}})});const body=JSON.parse(response.body);assert.equal(response.statusCode,202);assert.equal(body.authenticated,true);assert.equal(body.userRole,"owner");assert.equal(body.authMethod,"explicit-local-owner");assert.equal(body.githubWriteAttempted,false);}finally{names.forEach(name=>previous[name]===undefined?delete process.env[name]:process.env[name]=previous[name]);}});

test("contributor creates a draft review PR", async()=>{const {body,pulls}=await runRoleOperation("contributor",{action:"metadata.update",actor:"Ignored",reason:"Suggest motif tag",targets:["artifact.sample"],changes:{addTags:["motif"]}});assert.equal(body.userRole,"contributor");assert.equal(body.approvalMode,"pending-admin-review");assert.equal(body.prMerged,false);assert.equal(pulls[0].draft,true);assert.match(body.message,/editor\/admin review/i);});

test("editor approves low-risk metadata into a ready PR", async()=>{const {body,pulls}=await runRoleOperation("editor",{action:"metadata.update",actor:"Ignored",reason:"Approve motif tag",targets:["artifact.sample"],changes:{addTags:["motif"]}});assert.equal(body.approvalMode,"editor-approved");assert.equal(body.prMerged,false);assert.equal(pulls[0].draft,false);});

test("admin auto-approves low-risk metadata when enabled", async()=>{const {body,pulls}=await runRoleOperation("admin",{action:"metadata.update",actor:"Ignored",reason:"Add classification tag",targets:["artifact.sample"],changes:{addTags:["motif"]}});assert.equal(pulls[0].draft,false);assert.equal(body.mode,"admin-auto-approved");assert.equal(body.prMerged,true);assert.equal(body.mergeCommitSha,"merge-sha");assert.equal(body.changeLogEntry.userId,"user-admin");assert.equal(body.changeLogEntry.userRole,"admin");assert.equal(body.adminKeyAccepted,false);});

test("owner medium-risk confirmation is approved and awaits merge", async()=>{const {body,pulls}=await runRoleOperation("owner",{action:"metadata.update",actor:"Ignored",reason:"Confirm rights status",targets:["artifact.sample"],changes:{rightsStatus:"owned-internal"},explicitConfirmation:true});assert.equal(body.approvalMode,"owner-approved-pr");assert.equal(body.prMerged,false);assert.equal(pulls[0].draft,false);assert.equal(classifyOperation({audit:body.changeLogEntry,state:"open"}).bucket,"needs-merge");});

test("high-risk operation never silently auto-approves", async()=>{const {body,pulls}=await runRoleOperation("owner",{...decisionPayload,explicitConfirmation:true});assert.equal(body.policyResult.riskLevel,"high");assert.equal(body.prMerged,false);assert.equal(pulls[0].draft,true);assert.match(body.message,/Manual review/i);});

test("configured emergency admin key remains explicit rather than relying on owner fallback", async()=>{const names=[...operationEnvNames],previous=Object.fromEntries(operationEnvNames.map(name=>[name,process.env[name]])),priorFetch=globalThis.fetch;Object.assign(process.env,{GITHUB_TOKEN:"token",GITHUB_OWNER:"simply0307",GITHUB_REPO:"creative-systems1",GITHUB_DEFAULT_BRANCH:"main",GITHUB_AUTHOR_NAME:"OS",GITHUB_AUTHOR_EMAIL:"os@example.test",OPERATIONS_ADMIN_KEY:"break-glass",OPERATIONS_ADMIN_KEY_FALLBACK:"true",ADMIN_AUTO_APPROVE:"false"});let blobs=0;globalThis.fetch=async(url,_options={})=>{let body;if(url.includes('/git/ref/heads/main'))body={object:{sha:'base'}};else if(url.includes('/git/commits/base'))body={tree:{sha:'tree'}};else if(url.includes('/contents/src/content/artifacts/sample.json'))body={content:Buffer.from(JSON.stringify({id:'artifact.sample',title:'Sample',tags:[]})).toString('base64'),sha:'file'};else if(url.endsWith('/git/blobs'))body={sha:`blob-${++blobs}`};else if(url.endsWith('/git/trees'))body={sha:`tree-${blobs}`};else if(url.endsWith('/git/commits'))body={sha:`commit-${blobs}`};else if(url.endsWith('/pulls'))body={html_url:'https://github.com/x/y/pull/1',number:1,draft:false};else body={};return new Response(JSON.stringify(body),{status:200});};try{const response=await operations({httpMethod:'POST',headers:{'x-creative-os-key':'break-glass'},body:JSON.stringify({action:'metadata.update',actor:'Emergency',reason:'Break glass',targets:['artifact.sample'],changes:{addTags:['motif']}})});const body=JSON.parse(response.body);assert.equal(body.authMethod,'emergency-admin-key');assert.equal(body.adminKeyAccepted,true);assert.equal(body.userRole,'admin');}finally{globalThis.fetch=priorFetch;names.forEach(name=>previous[name]===undefined?delete process.env[name]:process.env[name]=previous[name]);}});

test("legacy review API rejects editor access",async()=>{const response=await operations({httpMethod:"GET",headers:{},queryStringParameters:{view:"reviews"}},identityContext("editor"));const body=JSON.parse(response.body);assert.equal(response.statusCode,403);assert.match(body.error,/admin or owner/i);});

test("legacy review API returns Creative OS review queue for admin",async()=>{const previous=Object.fromEntries(operationEnvNames.map(name=>[name,process.env[name]])),priorFetch=globalThis.fetch;Object.assign(process.env,{GITHUB_TOKEN:"token",GITHUB_OWNER:"simply0307",GITHUB_REPO:"creative-systems1",GITHUB_DEFAULT_BRANCH:"main",GITHUB_AUTHOR_NAME:"OS",GITHUB_AUTHOR_EMAIL:"os@example.test"});globalThis.fetch=async()=>new Response("[]",{status:200});try{const response=await operations({httpMethod:"GET",headers:{},queryStringParameters:{view:"reviews"}},identityContext("admin"));const body=JSON.parse(response.body);assert.equal(response.statusCode,200);assert.equal(body.userRole,"admin");assert.deepEqual(body.items,[]);}finally{globalThis.fetch=priorFetch;operationEnvNames.forEach(name=>previous[name]===undefined?delete process.env[name]:process.env[name]=previous[name]);}});

test("admin merge action appends audit before merging operation PR",async()=>{const previous=Object.fromEntries(operationEnvNames.map(name=>[name,process.env[name]])),priorFetch=globalThis.fetch;Object.assign(process.env,{GITHUB_TOKEN:"token",GITHUB_OWNER:"simply0307",GITHUB_REPO:"creative-systems1",GITHUB_DEFAULT_BRANCH:"main",GITHUB_AUTHOR_NAME:"OS",GITHUB_AUTHOR_EMAIL:"os@example.test"});globalThis.fetch=async(url,_options={})=>{let body;if(url.endsWith('/pulls/5'))body={number:5,html_url:'https://github.com/x/y/pull/5',head:{ref:'creative-os/operation.original'}};else if(url.includes('/git/ref/heads/creative-os/operation.original'))body={object:{sha:'head'}};else if(url.includes('/git/commits/head'))body={tree:{sha:'tree'}};else if(url.endsWith('/git/blobs'))body={sha:'blob'};else if(url.endsWith('/git/trees'))body={sha:'tree-next'};else if(url.endsWith('/git/commits'))body={sha:'audit-commit'};else if(url.endsWith('/pulls/5/merge'))body={merged:true,sha:'merge-review'};else body={};return new Response(JSON.stringify(body),{status:200});};try{const response=await operations({httpMethod:'POST',headers:{},body:JSON.stringify({operationType:'review_action',actor:'Admin',rationale:'Reviewed safe metadata',reason:'Reviewed safe metadata',targets:['operation.original'],reviewAction:'merge',pullRequestNumber:5})},identityContext('admin'));const body=JSON.parse(response.body);assert.equal(response.statusCode,200);assert.equal(body.prMerged,true);assert.match(body.auditRecordPath,/review-/);assert.equal(body.userRole,'admin');}finally{globalThis.fetch=priorFetch;operationEnvNames.forEach(name=>previous[name]===undefined?delete process.env[name]:process.env[name]=previous[name]);}});

test("owner and admin low-risk tags route to Needs merge, not Pending approvals",async()=>{for(const role of ["owner","admin"]){const {body}=await runRoleOperation(role,{action:"metadata.update",actor:"Ignored",reason:"Add doof",targets:["artifact.sample"],changes:{addTags:["doof"]}},{autoApprove:"false"});const lifecycle=classifyOperation({audit:body.changeLogEntry,state:"open"});assert.equal(body.approvalMode,`${role}-approved-pr`);assert.equal(lifecycle.bucket,"needs-merge");assert.equal(lifecycle.activeApproval,false);}});

test("contributor low-risk tag enters Pending approvals",async()=>{const {body}=await runRoleOperation("contributor",{action:"metadata.update",actor:"Ignored",reason:"Suggest doof",targets:["artifact.sample"],changes:{addTags:["doof"]}});assert.equal(classifyOperation({audit:body.changeLogEntry,state:"open",draft:true}).bucket,"pending");});

test("queue lifecycle removes responded items from Pending approvals",()=>{const cases=[[{reviewAudit:{status:"approved"},state:"open"},"needs-merge"],[{reviewAudit:{status:"rejected"},state:"closed"},"rejected"],[{reviewAudit:{status:"merged"},merged:true},"completed"],[{reviewAudit:{status:"changes-requested"},state:"open"},"changes-requested"],[{audit:{status:"failed"},mode:"failed"},"failed"]];for(const [item,bucket] of cases){const result=classifyOperation(item);assert.equal(result.bucket,bucket);assert.equal(result.bucket==="pending",false);}});

test("action buttons match lifecycle state",()=>{assert.deepEqual(actionsForLifecycle("pending").slice(0,3),["approve","reject","request-changes"]);assert.deepEqual(actionsForLifecycle("needs-merge"),["merge","open-pr","revert","add-note"]);assert.deepEqual(actionsForLifecycle("review-required","approved-draft-not-ready"),["open-pr","add-note"]);assert.deepEqual(actionsForLifecycle("completed"),["open-pr","revert","add-note"]);assert.deepEqual(actionsForLifecycle("rejected"),["reopen","add-note","open-pr"]);assert.deepEqual(actionsForLifecycle("failed"),["retry","open-diagnostics","manual-task","dismiss"]);});

test("Archive Index is the only visible browser workflow for database actions",async()=>{const source=await readFile(new URL("../src/pages/pipeline/artifacts.astro",import.meta.url),"utf8");assert.match(source,/Your folder, searchable/);assert.match(source,/New folder/);assert.match(source,/Standard tag/);assert.match(source,/Freeform tag/);});

test("added doof tag generates intent title and before-after tag diff",async()=>{const draft=createOperationDraft(validateOperationPayload({action:"metadata.update",actor:"Owner",reason:"test001",targets:["artifact.sample"],changes:{addTags:["doof"]}}),new Date("2026-06-18T12:00:00.000Z"));const plan=await buildGitWritePlan(draft,{readJson:async()=>({data:{id:"artifact.sample",title:"Alien Principle",tags:["alien"],relatedProjects:[]}})});assert.match(plan.changeLogEntry.title,/Add tag doof to Alien Principle/);assert.match(plan.changeLogEntry.intentSummary,/add doof tag/i);assert.equal(plan.changeLogEntry.reason,"test001");const diff=plan.changeLogEntry.fieldDiffs.find(entry=>entry.field==="tags");assert.deepEqual(diff.before,["alien"]);assert.deepEqual(diff.after,["alien","doof"]);assert.deepEqual(diff.added,["doof"]);});

test("presentation reason is separate from generated change summary",()=>{const view=buildOperationPresentation({operationType:"artifact_metadata_update",targets:["artifact.sample"],beforeSnapshot:{"artifact.sample":{title:"Alien Principle",tags:[]}},afterSnapshot:{"artifact.sample":{title:"Alien Principle",tags:["doof"]}}});assert.match(view.title,/doof/);assert.equal(view.title.includes("test001"),false);});

test("Workbench route files are removed from the visible redux app",async()=>{await assert.rejects(readFile(new URL("../src/pages/workbench/[id].astro",import.meta.url),"utf8"),/ENOENT/);});

test("remediation resolution creates decision-resolution and Change Log records",async()=>{const draft=createOperationDraft(validateOperationPayload({operationType:"decision_resolution",submittedBy:"Owner",rationale:"Adopt precise entity types",targets:["FND-02"],decisionId:"FND-02",resolution:{selected:"recommended",custom:"Use precise entity types."},followUpTasks:["Update taxonomy"]}),new Date("2026-06-18T12:00:00.000Z"));const policy=evaluateOperationPolicy(draft);const plan=await buildGitWritePlan({...draft,policyResult:policy,approvalMode:"owner-approved-pr",userRole:"owner",authenticated:true},{readJson:async()=>null});assert.ok(plan.files.some(file=>file.path.includes("decision-resolutions/fnd-02")));assert.ok(plan.files.some(file=>file.path.includes("change-log/")));assert.equal(plan.decisionResolution.sourceFilesChanged,false);});

test("critical remediation and canon resolutions are review-required",()=>{const payload=validateOperationPayload({operationType:"decision_resolution",submittedBy:"Owner",rationale:"Foundation decision",targets:["FND-02"],decisionId:"FND-02",resolution:{selected:"recommended",custom:"Use precise entity types."},criticalDecision:true,workType:"foundation canon"});const policy=evaluateOperationPolicy(createOperationDraft(payload));assert.equal(policy.riskLevel,"high");assert.match(policy.reasons.join(" "),/review/i);});

test("legacy review API never attempts to merge a draft PR and reports accurate diagnostics",async()=>{const previous=Object.fromEntries(operationEnvNames.map(name=>[name,process.env[name]])),priorFetch=globalThis.fetch,calls=[];Object.assign(process.env,{GITHUB_TOKEN:"token",GITHUB_OWNER:"simply0307",GITHUB_REPO:"creative-systems1",GITHUB_DEFAULT_BRANCH:"main",GITHUB_AUTHOR_NAME:"OS",GITHUB_AUTHOR_EMAIL:"os@example.test"});globalThis.fetch=async(url,options={})=>{calls.push({url,method:options.method||"GET"});return new Response(JSON.stringify({number:5,html_url:"https://github.com/x/y/pull/5",draft:true,head:{ref:"creative-os/operation.original"}}),{status:200});};try{const response=await operations({httpMethod:"POST",headers:{},body:JSON.stringify({operationType:"review_action",actor:"Admin",rationale:"Merge reviewed decision",targets:["operation.original"],reviewAction:"merge",pullRequestNumber:5})},identityContext("admin"));const body=JSON.parse(response.body);assert.equal(response.statusCode,409);assert.equal(body.accepted,false);assert.equal(body.mode,"failed");assert.equal(body.prDraft,true);assert.equal(body.prCreated,false);assert.equal(body.diagnostics.githubWriteAttempted,false);assert.match(body.error,/draft.*marked ready/i);assert.equal(calls.some(call=>call.url.endsWith("/pulls/5/merge")),false);}finally{globalThis.fetch=priorFetch;operationEnvNames.forEach(name=>previous[name]===undefined?delete process.env[name]:process.env[name]=previous[name]);}});

test("failed operation classifies as Failed rather than approved",()=>{const lifecycle=classifyOperation({mode:"failed",accepted:false,approvalMode:"admin-approved-pr"});assert.equal(lifecycle.bucket,"failed");assert.equal(lifecycle.status,"failed");});

test("archive index UI saves folders and tags through Supabase, not operations PRs",async()=>{const client=await readFile(new URL("../src/scripts/creative-os-client.js",import.meta.url),"utf8"),page=`${await readFile(new URL("../src/pages/pipeline/artifacts.astro",import.meta.url),"utf8")}\n${await readFile(new URL("../src/scripts/archive-index-client.js",import.meta.url),"utf8")}`;assert.match(client,/api\/creative-os/);assert.doesNotMatch(client,/fetch\("\/api\/operations"/);assert.match(page,/Save index fields/);assert.match(page,/CreativeDatabase\.moveArtifact/);assert.match(page,/CreativeDatabase\.organizeArtifact/);assert.match(page,/CreativeDatabase\.updateArtifact/);assert.match(page,/item\.signedUrl/);});

test("decision presentation states source prose and canonical archive remain unchanged",()=>{const view=buildOperationPresentation({operationType:"decision_resolution",targets:["DEC-02"],decisionId:"DEC-02",resolution:{selected:"custom",custom:"Use Zendra"},afterSnapshot:{sourceFilesChanged:false}});assert.match(view.sourceEffect,/Source prose unchanged/);assert.match(view.canonicalEffect,/canonical archive data.*remain unchanged/i);});

test("Archive Index controls are non-overlapping and folder rail is responsive",async()=>{const page=await readFile(new URL("../src/pages/pipeline/artifacts.astro",import.meta.url),"utf8");assert.match(page,/archive-toolbar/);assert.match(page,/folder-index-shell/);assert.match(page,/folder-rail/);assert.match(page,/position:sticky/);assert.match(page,/@media\(max-width:850px\)/);});

test("artifact availability flags missing files and previews only served images",async()=>{const root=await mkdtemp(path.join(tmpdir(),"creative-os-artifacts-"));try{await mkdir(path.join(root,"public","artifacts"),{recursive:true});await writeFile(path.join(root,"public","artifacts","available.png"),"png");const available=inspectArtifactAvailability({filePath:"Archive/Art/available.png",fileName:"available.png",type:"image"},root);assert.equal(available.status,"available");assert.equal(available.showImagePreview,true);assert.equal(available.servedUrl,"/artifacts/available.png");const missing=inspectArtifactAvailability({filePath:"Archive/Art/missing.png",fileName:"missing.png",type:"image"},root);assert.equal(missing.status,"missing");assert.equal(missing.showImagePreview,false);}finally{await rm(root,{recursive:true,force:true});}});
