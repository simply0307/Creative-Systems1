import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { deriveSupabaseProjectRef } from "../netlify/functions/lib/runtime-contract.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(directory, "../supabase/migrations/20260822031655_convert_creative_os_to_reath_digest.sql");
const migration = await readFile(migrationPath, "utf8");
const aiMigrationPath = path.resolve(directory, "../supabase/migrations/20260822034810_add_optional_story_ai.sql");
const aiMigration = await readFile(aiMigrationPath, "utf8");
const hardeningMigrationPath = path.resolve(directory, "../supabase/migrations/20260826064130_harden_ingestion_recovery_and_ai_preconditions.sql");
const hardeningMigration = await readFile(hardeningMigrationPath, "utf8");
const calibrationMigrationPath = path.resolve(directory, "../supabase/migrations/20260826072430_split_spotlight_daily_edition_date_conflict.sql");
const calibrationMigration = await readFile(calibrationMigrationPath, "utf8");
const productionCalibrationMigrationPath = path.resolve(directory, "../supabase/migrations/20260826080300_split_new_jersey_stage_recurring_event_conflicts.sql");
const productionCalibrationMigration = await readFile(productionCalibrationMigrationPath, "utf8");
const corroborationMigrationPath = path.resolve(directory, "../supabase/migrations/20260826090008_add_corroboration_signal_and_sources.sql");
const corroborationMigration = await readFile(corroborationMigrationPath, "utf8");
const evidenceOriginMigrationPath = path.resolve(directory, "../supabase/migrations/20260826102000_harden_evidence_origins_and_business_feed.sql");
const evidenceOriginMigration = await readFile(evidenceOriginMigrationPath, "utf8");
const blockedBusinessFeedMigrationPath = path.resolve(directory, "../supabase/migrations/20260826151000_disable_netlify_blocked_nj_business_feed.sql");
const blockedBusinessFeedMigration = await readFile(blockedBusinessFeedMigrationPath, "utf8");
const sourceExpansionMigrationPath = path.resolve(directory, "../supabase/migrations/20260826175800_expand_reviewed_nj_journalism_sources.sql");
const sourceExpansionMigration = await readFile(sourceExpansionMigrationPath, "utf8");
const reconciliationMigrationPath = path.resolve(directory, "../supabase/migrations/20260826190000_add_safe_story_reconciliation.sql");
const reconciliationMigration = await readFile(reconciliationMigrationPath, "utf8");
const localSourceExpansionMigrationPath = path.resolve(directory, "../supabase/migrations/20260827161604_expand_reviewed_local_sources_and_reduce_polling.sql");
const localSourceExpansionMigration = await readFile(localSourceExpansionMigrationPath, "utf8");
const verifiedSourceExpansionMigrationPath = path.resolve(directory, "../supabase/migrations/20260827171634_expand_verified_sources_and_event_matching.sql");
const verifiedSourceExpansionMigration = await readFile(verifiedSourceExpansionMigrationPath, "utf8");
const edgeScheduleMigrationPath = path.resolve(directory, "../supabase/migrations/20260827183217_schedule_reath_edge_ingestion.sql");
const edgeScheduleMigration = await readFile(edgeScheduleMigrationPath, "utf8");
const manualIngestionMigrationPath = path.resolve(directory, "../supabase/migrations/20260827193340_manual_only_ingestion_maintenance.sql");
const manualIngestionMigration = await readFile(manualIngestionMigrationPath, "utf8");
const manualAdmissionMigrationPath = path.resolve(directory, "../supabase/migrations/20260827195634_enforce_manual_ingestion_admission.sql");
const manualAdmissionMigration = await readFile(manualAdmissionMigrationPath, "utf8");
const manualRetentionMigrationPath = path.resolve(directory, "../supabase/migrations/20260827195857_enforce_manual_refresh_and_retention.sql");
const manualRetentionMigration = await readFile(manualRetentionMigrationPath, "utf8");
const requiredTables = ["counties","municipalities","sources","source_items","stories","story_sources","story_counties","story_municipalities","story_enrichments","story_scores","editorial_queue","editorial_decisions","ingestion_runs","source_run_results"];
const expandedSourceNames = [
  "Chalkbeat Newark",
  "Ridge View Echo",
  "The Jersey Vindicator",
  "New Jersey Hills Media Group",
  "Brick Shorebeat",
  "Toms River Shorebeat",
  "Lavallette-Seaside Shorebeat",
  "Town Topics",
  "Ocean City Sentinel",
  "Pine Barrens Tribune",
  "Essex News Daily",
  "Union News Daily",
  "The SandPaper",
  "The Observer",
  "The Press Group",
  "Star News Group",
  "Two River Times",
  "The Coaster",
  "42Freeway",
  "New Jersey 101.5 News",
  "PIX11 New Jersey",
  "CBS News Philadelphia - New Jersey",
  "CBS News New York - New Jersey",
  "NBC10 Philadelphia - New Jersey",
  "NBC 4 New York - New Jersey",
  "6abc - New Jersey",
  "ABC7 New York - New Jersey",
];
const expandedSourceValuesSql = expandedSourceNames
  .map((name) => `('${name.replaceAll("'", "''")}')`)
  .join(",\n        ");
const localExpandedSourceNames = [
  "Jersey Digs",
  "The Village Green",
  "MyVeronaNJ",
  "WRNJ Radio",
  "HudPost",
  "Black In Jersey",
  "Follow South Jersey",
  "Slice of Culture",
  "The Montclarion",
  "The Rider News",
  "The Whit",
  "WBGO News - Newark Today",
];
const verifiedExpandedSourceNames = [
  "FOX 29 Philadelphia - New Jersey",
  "FOX 5 New York - New Jersey",
  "70and73",
];

for (const table of requiredTables) assert.match(migration, new RegExp(`create table public\\.${table} \\(`), `Missing table ${table}`);
assert.equal((migration.match(/^  \(\d+, '.*', '.*', '(?:borough|city|town|township|village|other)', array\[/gm) || []).length, 564, "Expected current 564 NJ municipalities");
assert.equal((migration.match(/'2026-08-21T00:00:00Z'\)/g) || []).length, 18, "Expected 18 verified source registry rows");
assert.match(migration, /where name in \('511NJ Active Events', 'Route 40', 'BreakingAC'\)/, "Expected activation audit quarantine for the three blocked feeds");
assert.match(migration, /security invoker/g, "Database functions must be security invoker");
assert.doesNotMatch(migration, /security definer/i, "No Reath function should bypass RLS");
for (const table of ["story_ai_state","ai_call_attempts","story_analyses"]) {
  assert.match(aiMigration, new RegExp(`create table public\\.${table} \\(`), `Missing AI table ${table}`);
  assert.match(aiMigration, new RegExp(`alter table public\\.${table} enable row level security`), `Missing RLS for ${table}`);
}
assert.match(aiMigration, /story_enrichments_current_kind_unique/, "Deterministic and AI enrichment must have separate current rows");
assert.match(aiMigration, /alter table public\.stories[\s\S]*add column evidence_revision bigint not null/, "Stories need a database-maintained evidence revision");
for (const trigger of [
  "stories_evidence_revision_before_update",
  "story_sources_evidence_revision_after_change",
  "source_items_evidence_revision_after_update",
  "sources_evidence_revision_after_update",
  "story_counties_evidence_revision_after_change",
  "story_municipalities_evidence_revision_after_change",
  "story_enrichments_evidence_revision_after_insert",
]) assert.match(aiMigration, new RegExp(`create trigger ${trigger}`), `Missing evidence-revision trigger ${trigger}`);
assert.match(aiMigration, /current_evidence_revision bigint not null/, "AI state must retain its current evidence revision");
assert.match(aiMigration, /claimed_evidence_revision bigint/, "AI claims must pin an evidence revision");
assert.match(aiMigration, /num_nonnulls\(\s*lease_token, lease_owner, lease_expires_at,\s*claimed_generation, claimed_input_fingerprint, claimed_evidence_revision\s*\) in \(0, 6\)/, "Basic state lease and claim fields must be all null or all present");
assert.match(aiMigration, /request_sequence bigint generated always as identity unique/, "AI attempts need a total request order");
assert.match(aiMigration, /evidence_revision bigint not null/g, "AI attempts and analyses must retain evidence revision provenance");
assert.ok((aiMigration.match(/enrichment_version text not null/g) || []).length >= 3, "AI state, attempts, and analyses must retain enrichment-version provenance");
assert.match(aiMigration, /claim_story_ai_enrichments/, "AI work must use bounded lease claims");
assert.match(aiMigration, /claim_story_ai_enrichments\(\s*p_limit integer,\s*p_worker text,\s*p_enrichment_version text,\s*p_schema_version text,\s*p_prompt_version text,\s*p_provider text,\s*p_model text,/, "Scheduled claims must bind the complete configured AI identity");
assert.match(aiMigration, /state\.enrichment_version = p_enrichment_version[\s\S]*state\.provider = p_provider[\s\S]*state\.model = p_model/, "Scheduled claims must exclude work queued for another AI configuration");
assert.match(aiMigration, /expire_stale_story_ai_enrichments[\s\S]*limit least\(1000, greatest\(0, p_limit\)\)/, "Expired basic-enrichment cleanup must be globally bounded");
assert.match(aiMigration, /record_story_ai_enrichment_cache_hit/, "Basic enrichment cooldown cache hits must be recorded atomically");
assert.match(aiMigration, /create_story_ai_call_attempt/, "Basic enrichment attempts must be created through a lease-checked RPC");
assert.match(aiMigration, /state\.requested_generation is distinct from state\.claimed_generation[\s\S]*state\.current_input_fingerprint is distinct from state\.claimed_input_fingerprint/, "Basic attempt creation must reject claims whose execution identity advanced");
assert.match(aiMigration, /begin_story_ai_provider_call/, "Basic provider calls must begin through a lease-checked RPC");
const beginStoryAiProviderCall = aiMigration.match(/create or replace function public\.begin_story_ai_provider_call\([\s\S]*?\n\$\$;/)?.[0] || "";
assert.match(beginStoryAiProviderCall, /state\.requested_generation is distinct from state\.claimed_generation[\s\S]*state\.current_input_fingerprint is distinct from state\.claimed_input_fingerprint/, "Basic provider authorization must reject a claim superseded after attempt creation");
assert.match(aiMigration, /complete_story_ai_enrichment/, "AI result persistence must be transactional");
assert.match(aiMigration, /error_code = 'superseded',\s*error_message = 'Story evidence or enrichment identity changed during the provider call'/, "Superseded paid enrichment results must retain an explicit disposition");
assert.match(aiMigration, /request_story_ai_enrichment\(\s*p_story_id uuid,\s*p_evidence_revision bigint/, "Basic queue requests must bind the prepared evidence revision");
assert.match(aiMigration, /p_expected_state_updated_at timestamptz default null[\s\S]*existing\.updated_at is distinct from p_expected_state_updated_at/, "Scheduled basic reconciliation must use an optimistic state-version fence");
assert.match(aiMigration, /request_story_analysis_attempt\(\s*p_story_id uuid,\s*p_evidence_revision bigint/, "Deep queue requests must bind the prepared evidence revision");
assert.doesNotMatch(hardeningMigration, /using errcode = '40001'/, "Application preconditions must not impersonate PostgreSQL serialization failures");
let aiPreconditionBranches = 0;
for (const functionName of ["request_story_ai_enrichment", "record_story_ai_enrichment_cache_hit", "request_story_analysis_attempt"]) {
  const hardenedFunction = hardeningMigration.match(new RegExp(`create or replace function public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`))?.[0] || "";
  assert.match(hardenedFunction, /security invoker/, `${functionName} must remain security invoker`);
  assert.doesNotMatch(hardenedFunction, /security definer/i, `${functionName} must not bypass RLS`);
  aiPreconditionBranches += (hardenedFunction.match(/using errcode = 'PT412'/g) || []).length;
}
assert.equal(aiPreconditionBranches, 6, "All six AI request preconditions must use the HTTP 412 application SQLSTATE");
assert.match(hardeningMigration, /check \(processing_status in \('pending','processing','processed','error','ignored'\)\)/, "Source-item recovery must permit an explicit processing claim state");
assert.match(hardeningMigration, /create unique index ingestion_runs_single_running_unique[\s\S]*where status = 'running'/, "Only one ingestion run may remain active");
assert.match(hardeningMigration, /source_items_processing_lease_check/, "Source-item processing claims need a database-enforced lease tuple");
assert.match(hardeningMigration, /create or replace function public\.start_ingestion_run/, "Ingestion admission must be transactional");
assert.match(hardeningMigration, /create or replace function public\.finish_ingestion_run/, "Ingestion completion must be status fenced");
assert.match(hardeningMigration, /create or replace function public\.assign_source_item_to_story/, "Story creation and evidence attachment must be atomic");
assert.match(hardeningMigration, /overlapping\.position > 1/, "Migration must reconcile pre-existing overlapping workers before creating the unique index");
assert.match(hardeningMigration, /current\.provider is distinct from excluded\.provider[\s\S]*current\.model is distinct from excluded\.model/, "AI provider/model changes must queue a new configuration identity");
assert.match(calibrationMigration, /perform public\.detach_story_source/, "The observed date-edition conflict must retain an audited detach decision");
assert.match(calibrationMigration, /'editor_attach'/, "The separated daily edition must retain explicit evidence provenance");
assert.doesNotMatch(calibrationMigration, /'[0-9a-f]{8}-[0-9a-f-]{27}'::uuid/i, "Calibration data repair must not hardcode generated database IDs");
assert.equal((productionCalibrationMigration.match(/perform public\.detach_story_source/g) || []).length, 1, "Production calibration must use the audited detach path for every data-driven repair");
assert.match(productionCalibrationMigration, /conflicting_headline_dates/, "Production calibration must record the observed weekly date-range conflict");
assert.match(productionCalibrationMigration, /conflicting_live_venue_subjects/, "Production calibration must record the observed same-venue performer conflict");
assert.match(productionCalibrationMigration, /'editor_attach'/, "Production calibration splits must retain explicit evidence provenance");
assert.doesNotMatch(productionCalibrationMigration, /'[0-9a-f]{8}-[0-9a-f-]{27}'::uuid/i, "Production calibration data repair must not hardcode generated database IDs");
assert.match(corroborationMigration, /create table public\.source_assessments \(/, "Missing audited source-assessment table");
assert.match(corroborationMigration, /corroboration_group_key text not null/, "Source assessments need an ownership/editorial-control key");
assert.match(corroborationMigration, /alter table public\.source_assessments enable row level security/, "Source assessments need RLS");
assert.match(corroborationMigration, /with \(security_invoker = true\)/, "Corroboration view must use invoker security");
assert.match(corroborationMigration, /journalism_group_count >= 2[\s\S]*reputable_group_count >= 3[\s\S]*journalism_group_count >= 1/, "Corroboration view must enforce the two-journalism or three-reputable-with-journalism routes");
assert.match(corroborationMigration, /assessment\.evidence_role in \(\s*'independent_journalism',\s*'official_primary',\s*'institutional_primary'\s*\)/, "Context-only evidence must not qualify as a reputable account");
assert.equal((corroborationMigration.split("insert into public.source_assessments")[0].match(/'2026-08-26T09:00:08Z'/g) || []).length, 18, "Expected 18 newly verified registry entries");
assert.equal((corroborationMigration.match(/^    \('[^']+', '(?:reviewed|provisional)', '(?:independent_journalism|official_primary|institutional_primary|context_only|excluded)', [0-3], '[^']+',/gm) || []).length, 36, "Expected one assessment seed for all 36 Sources");
assert.match(corroborationMigration, /grant select, insert on table public\.source_assessments to service_role;\s*grant update \(superseded_at\)/, "Service role should only append or supersede source assessments");
assert.doesNotMatch(corroborationMigration, /grant (?:delete|truncate|all)[^;]*public\.source_assessments[^;]*service_role/i, "Source assessment history must not be destructively granted");
assert.doesNotMatch(corroborationMigration, /security definer/i, "Corroboration migration must not bypass RLS");
assert.match(evidenceOriginMigration, /create function public\.reath_evidence_origin_key/, "Evidence-origin migration must define one canonical provenance key");
for (const origin of ["new-jersey-statehouse-news-service", "associated-press", "reuters"]) {
  assert.match(evidenceOriginMigration, new RegExp(`origin:${origin}`), `Missing exact ${origin} syndication guard`);
}
assert.match(evidenceOriginMigration, /with recursive evidence_rows as/, "Corroboration view must collapse connected provider and syndication evidence groups");
assert.match(evidenceOriginMigration, /feed\/\?post_type=njb_news_now/, "New Jersey Business Magazine must use its official populated News Now feed");
assert.match(evidenceOriginMigration, /'Sponsored Content'[\s\S]*'Advertorial'[\s\S]*'Press Release'/, "Business feed must exclude labeled non-editorial material");
assert.doesNotMatch(evidenceOriginMigration, /security definer/i, "Evidence-origin migration must not bypass RLS");
assert.match(blockedBusinessFeedMigration, /active = false/, "A publisher-blocked production feed must fail closed");
assert.match(blockedBusinessFeedMigration, /publisher-approved production access/, "A blocked feed needs an explicit reactivation condition");
assert.doesNotMatch(blockedBusinessFeedMigration, /security definer/i, "Source deactivation must not bypass RLS");
const expandedSourceSeed = sourceExpansionMigration.match(/with seed\([\s\S]*?\)\s*insert into public\.sources/)?.[0] || "";
const expandedAssessmentSeed = sourceExpansionMigration.match(/insert into public\.source_assessments \([\s\S]*?from \(\s*values([\s\S]*?)\) as assessment/)?.[1] || "";
assert.equal((expandedSourceSeed.match(/^    \(\n      '[^']+',\n      'https:\/\/[^']+',\n      'https:\/\/[^']+',\n      '(?:state|county)',/gm) || []).length, 27, "Source expansion must seed exactly 27 journalism providers");
assert.equal((expandedAssessmentSeed.match(/^    \('[^']+', [23], '[^']+', '[^']+'\),?$/gm) || []).length, 27, "Every expanded provider must receive one reviewed tier-2-or-3 assessment");
for (const sourceName of expandedSourceNames) {
  assert.match(expandedSourceSeed, new RegExp(`'${sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`), `Missing expanded Source ${sourceName}`);
  assert.match(expandedAssessmentSeed, new RegExp(`'${sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`), `Missing assessment for expanded Source ${sourceName}`);
}
assert.equal((sourceExpansionMigration.match(/"include_categories"/g) || []).length, 4, "CBS and ABC regional feeds must be limited to explicit New Jersey categories");
assert.match(sourceExpansionMigration, /"exclude_url_patterns":\["\/print_only\/","\/sports\/","\/entertainment\/"\]/, "The statewide NJ Hills feed must exclude mirror and off-topic routes");
assert.equal((sourceExpansionMigration.match(/"exclude_url_patterns":\["\/video\/"\]/g) || []).length, 2, "Both CBS regional feeds must exclude video-only routes");
assert.match(sourceExpansionMigration, /"exclude_categories":\["weather","opinion","sponsored"\]/, "The NJ 101.5 category feed must exclude low-signal sections");
assert.match(sourceExpansionMigration, /create or replace function public\.reath_evidence_origin_key[\s\S]*security invoker/, "Compound syndication provenance must remain an invoker-security function");
for (const joiner of ["associated press($| (and|with) )", "reuters($| (and|with) )"]) {
  assert.ok(sourceExpansionMigration.includes(joiner), `Missing compound wire-credit boundary ${joiner}`);
}
assert.match(sourceExpansionMigration, /'fideri-news-network'/, "Sea Isle News and BreakingAC must share their documented ownership group");
assert.doesNotMatch(sourceExpansionMigration, /'[0-9a-f]{8}-[0-9a-f-]{27}'::uuid/i, "Source expansion must resolve existing rows by stable source identity, not generated database IDs");
assert.doesNotMatch(sourceExpansionMigration, /security definer/i, "Source expansion must not bypass RLS");
for (const sourceName of localExpandedSourceNames) {
  assert.match(localSourceExpansionMigration, new RegExp(`'${sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`), `Missing local expansion Source ${sourceName}`);
}
assert.equal((localSourceExpansionMigration.match(/'reath-source-verification-v3'/g) || []).length, 1, "The local expansion must use one current assessment methodology");
assert.match(localSourceExpansionMigration, /"include_author_patterns"/, "Mixed feeds must support reviewed byline allowlists");
assert.match(localSourceExpansionMigration, /"include_url_patterns"/, "Broad public-media feeds must support reviewed route allowlists");
assert.match(localSourceExpansionMigration, /set active = false[\s\S]*where name = 'Star News Group'/, "The repeatedly blocked production feed must be disabled");
assert.doesNotMatch(localSourceExpansionMigration, /security definer/i, "Local source expansion must not bypass RLS");
for (const sourceName of verifiedExpandedSourceNames) {
  assert.match(verifiedSourceExpansionMigration, new RegExp(`'${sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`), `Missing verified expansion Source ${sourceName}`);
}
assert.match(verifiedSourceExpansionMigration, /'fox-television-stations'/, "Fox sibling feeds must share one editorial-control group");
assert.match(verifiedSourceExpansionMigration, /"include_author_patterns":\["70and73\.com"\]/, "70and73 syndication must be excluded by a reviewed original-byline allowlist");
assert.match(verifiedSourceExpansionMigration, /720[\s\S]*720[\s\S]*1440/, "New providers must use low-frequency polling intervals");
assert.doesNotMatch(verifiedSourceExpansionMigration, /security definer/i, "Verified source expansion must not bypass RLS");
assert.match(edgeScheduleMigration, /create extension if not exists pg_net with schema extensions/, "Edge scheduling requires pg_net");
assert.match(edgeScheduleMigration, /create extension if not exists pg_cron/, "Edge scheduling requires pg_cron");
assert.match(edgeScheduleMigration, /perform cron\.unschedule\(existing_job\.jobid\)/, "Cron replacement must use the supported unschedule function");
assert.match(edgeScheduleMigration, /from vault\.decrypted_secrets[\s\S]*name = 'reath_edge_schedule_token_v1'/, "Cron must read its private worker token from Vault");
assert.match(edgeScheduleMigration, /https:\/\/okqkljexfzolzxysjaha\.supabase\.co\/functions\/v1\/reath-ingest/g, "Cron must target only canonical Reath");
assert.doesNotMatch(edgeScheduleMigration, /uzderzjbitmghfvrllvz/, "Edge scheduling must never reference Para\/EGGS");
assert.doesNotMatch(edgeScheduleMigration, /security definer/i, "Edge scheduling must not add privileged public functions");
assert.match(manualIngestionMigration, /perform cron\.unschedule\(reath_job_id\)/, "Manual-only migration must remove every Reath cron job");
assert.doesNotMatch(manualIngestionMigration, /cron\.schedule\s*\(/, "Manual-only migration must not create another schedule");
assert.match(manualIngestionMigration, /create function public\.run_manual_ingestion_maintenance/, "Manual ingestion must own its bounded maintenance preflight");
assert.match(manualIngestionMigration, /processing_status in \('pending', 'error'\)[\s\S]*not exists \([\s\S]*public\.story_sources/, "Aged backlog cleanup must preserve linked Story evidence");
assert.match(manualIngestionMigration, /grant execute on function public\.run_manual_ingestion_maintenance\(integer\)[\s\S]*to service_role/, "Only the server worker may invoke manual maintenance");
assert.doesNotMatch(manualIngestionMigration, /security definer/i, "Manual maintenance must not bypass RLS");
assert.match(manualAdmissionMigration, /if p_trigger_type = 'scheduled' then[\s\S]*'reason', 'manual_only'/, "Database admission must reject legacy scheduled invocations");
assert.match(manualAdmissionMigration, /grant execute on function public\.start_ingestion_run\(text,text,integer\)[\s\S]*to service_role/, "Only the server worker may request ingestion admission");
assert.doesNotMatch(manualAdmissionMigration, /security definer/i, "Manual admission must not bypass RLS");
assert.match(manualRetentionMigration, /processing_status in \('pending', 'error', 'ignored'\)/, "Manual maintenance must remove every kind of unlinked aged backlog");
assert.match(manualRetentionMigration, /create trigger source_items_manual_retention[\s\S]*before insert on public\.source_items/, "Database retention must protect the currently deployed worker");
assert.match(manualRetentionMigration, /update public\.sources as source[\s\S]*set last_checked_at = null[\s\S]*where source\.active/, "A manual click must make every active source due");
assert.doesNotMatch(manualRetentionMigration, /security definer/i, "Manual retention must not bypass RLS");
for (const table of ["story_reconciliation_runs", "story_reconciliation_attempts"]) {
  assert.match(reconciliationMigration, new RegExp(`create table public\\.${table} \\(`), `Missing reconciliation audit table ${table}`);
  assert.match(reconciliationMigration, new RegExp(`alter table public\\.${table} enable row level security`), `Missing RLS for ${table}`);
}
assert.match(reconciliationMigration, /mode text not null check \(mode in \('dry_run','apply'\)\)/, "Reconciliation must retain a non-mutating dry-run mode");
assert.match(reconciliationMigration, /merge_limit integer not null check \(merge_limit between 1 and 50\)/, "Reconciliation merges must be bounded");
assert.match(reconciliationMigration, /story_reconciliation_runs_terminal_only/, "Reconciliation run configuration and terminal history must be immutable");
assert.match(reconciliationMigration, /story_reconciliation_attempts_append_only/, "Reconciliation dispositions must be append-only");
assert.match(reconciliationMigration, /before insert or update or delete on public\.story_reconciliation_attempts/, "Reconciliation attempts must validate inserts and reject later mutation");
assert.match(reconciliationMigration, /Story reconciliation refresh pending: run/, "An applied evidence move must transactionally queue projection recovery");
assert.match(reconciliationMigration, /complete_story_reconciliation_refresh/, "A successful projection refresh needs a guarded recovery completion RPC");
assert.match(reconciliationMigration, /update public\.story_enrichments\s+set is_current = false[\s\S]*?analysis_kind = 'deterministic'/, "A merge must invalidate stale deterministic enrichment in its transaction");
assert.match(reconciliationMigration, /update public\.story_scores\s+set is_current = false[\s\S]*?analysis_kind = 'deterministic'/, "A merge must invalidate stale deterministic scores in its transaction");
assert.doesNotMatch(reconciliationMigration, /insert into public\.story_(?:counties|municipalities)/, "Reconciliation must not invert Story/geography lock order or union uncertain geography");
assert.match(reconciliationMigration, /reath_evidence_origin_key\(\s*item\.author, assessment\.corroboration_group_key\s*\)/, "Reconciliation must pass evidence-origin arguments in author/provider order");
assert.ok(
  reconciliationMigration.indexOf("from public.source_items\n  where id = any(expected_target_item_ids || expected_source_item_ids)")
    < reconciliationMigration.indexOf("from public.stories\n  where id = any(array[p_target_story_id, p_source_story_id])"),
  "Reconciliation must preserve the ingestion SourceItem -> Story lock order",
);
assert.doesNotMatch(reconciliationMigration, /security definer/i, "Reconciliation functions must not bypass RLS");
for (const functionName of ["claim_story_ai_enrichment", "claim_story_analysis_attempt", "complete_story_analysis"]) {
  assert.match(aiMigration, new RegExp(`function public\\.${functionName}\\([\\s\\S]*?\\) returns jsonb`), `${functionName} must return an unambiguous nullable JSON object`);
}
assert.match(aiMigration, /ai_call_attempts_one_queued_idx/, "AI analysis attempts need one durable queued successor");
assert.match(aiMigration, /ai_call_attempts_one_running_idx/, "AI analysis attempts need one running-call concurrency guard");
assert.match(aiMigration, /\(status = 'cache_hit'\) = cache_hit/, "Cache-hit status and accounting flag must agree");
assert.match(aiMigration, /not cache_hit and num_nonnulls\(cached_from_enrichment_id, cached_from_analysis_id\) = 0/, "Non-cache attempts cannot point at cached results");
assert.match(aiMigration, /operation_type = 'enrich_story' and cached_from_enrichment_id is not null and cached_from_analysis_id is null/, "Basic cache hits must reference only enrichment results");
assert.match(aiMigration, /operation_type <> 'enrich_story' and cached_from_enrichment_id is null and cached_from_analysis_id is not null/, "Deep-analysis cache hits must reference only analysis results");
for (const index of ["ai_call_attempts_activity_time_idx", "ai_call_attempts_analysis_lease_idx", "ai_call_attempts_compare_queue_idx", "ai_call_attempts_analysis_config_queue_idx"]) {
  assert.match(aiMigration, new RegExp(`create index ${index}`), `Missing AI operations index ${index}`);
}
assert.match(aiMigration, /release_story_ai_enrichment_claim/, "Pre-provider failures must release enrichment claims");
assert.match(aiMigration, /list_story_ai_revision_mismatches/, "Scheduled enrichment must recover evidence changes");
assert.match(aiMigration, /request_story_analysis_attempt/, "Deep-analysis queue, cache, and coalescing must be atomic");
const requestStoryAnalysis = aiMigration.match(/create or replace function public\.request_story_analysis_attempt\([\s\S]*?\n\$\$;/)?.[0] || "";
assert.match(requestStoryAnalysis, /attempts\.status = 'running'\s+and attempts\.provider_called[\s\S]*?return attempt;/, "Deep requests must re-coalesce with a surviving matching provider call after supersession");
assert.match(aiMigration, /complete_story_analysis/, "Selective analysis persistence must be transactional");
const completeStoryAnalysis = aiMigration.match(/create or replace function public\.complete_story_analysis\([\s\S]*?\n\$\$;/)?.[0] || "";
assert.doesNotMatch(completeStoryAnalysis, /states\.current_input_fingerprint/, "Deep completion must not depend on the separate basic-enrichment fingerprint");
assert.match(aiMigration, /claim_story_analysis_attempt/, "Selective analysis work must be lease claimed");
assert.match(aiMigration, /claim_story_analysis_attempt\(\s*p_call_attempt_id uuid,\s*p_worker text,\s*p_enrichment_version text,\s*p_provider text,\s*p_model text,\s*p_schema_version text,\s*p_prompt_version text,/, "Deep-analysis claims must bind the configured provider identity");
assert.match(aiMigration, /num_nonnulls\(lease_token, lease_owner, lease_expires_at\) in \(0, 3\)/, "Deep-analysis lease fields must be all null or all present");
assert.match(aiMigration, /constraint ai_call_attempts_basic_lease_check[\s\S]*operation_type <> 'enrich_story' or num_nonnulls\(lease_token, lease_owner, lease_expires_at\) = 0/, "Basic attempts must never carry the separate deep-analysis lease tuple");
const beginStoryAnalysisProviderCall = aiMigration.match(/create or replace function public\.begin_story_analysis_provider_call\([\s\S]*?\n\$\$;/)?.[0] || "";
assert.match(beginStoryAnalysisProviderCall, /if changed_count = 1 then return true; end if;[\s\S]*return exists/, "Deep provider authorization must reconcile an already-committed begin transition");
assert.match(aiMigration, /newer\.request_sequence > attempt\.request_sequence/, "A later deep-analysis request must supersede stale provider output");
assert.match(aiMigration, /select newer\.cache_key is distinct from attempt\.cache_key[\s\S]*order by newer\.request_sequence desc\s*limit 1/, "Only the newest later deep-analysis request may supersede provider output");
assert.match(aiMigration, /order by attempts\.request_sequence desc\s*limit 1\s*for update of attempts/, "Active deep-analysis coalescing must lock the selected attempt");
assert.match(aiMigration, /p_outcome = 'rejected' and attempts\.provider_called/, "Malformed post-provider analysis results must be recorded as rejected");
assert.ok((aiMigration.match(/p_provider_request_id text/g) || []).length >= 3, "Completion and failure paths must retain provider response identity");
assert.match(aiMigration, /revoke all on table public\.story_ai_state, public\.ai_call_attempts, public\.story_analyses from public, anon, authenticated, service_role;\s*grant select, insert, update on table/, "AI tables must remove broad grants before exact service-role privileges are restored");
assert.doesNotMatch(aiMigration, /grant (?:delete|truncate|all)[^;]*public\.(?:story_ai_state|ai_call_attempts|story_analyses)[^;]*service_role/i, "The service role must not receive destructive AI-table privileges");
assert.doesNotMatch(aiMigration, /security definer/i, "No AI function should bypass RLS");
assert.doesNotMatch(aiMigration, /vector|embedding/i, "V1 must not require vector infrastructure");
console.log("Static migration checks passed: 20 tables, 564 municipalities, 78 assessed Sources, three reviewed provider expansions, hard corroboration routes, revision-safe AI streams, durable reconciliation audit, and least-privilege RLS grants.");

const expectSqlState = async (database, sql, params, expectedCode) => {
  try {
    await database.query(sql, params);
  } catch (error) {
    assert.equal(error.code, expectedCode);
    return;
  }
  assert.fail(`Expected SQLSTATE ${expectedCode}`);
};

const runEmbeddedDatabaseChecks = async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  try {
    await database.waitReady;
    await database.exec(`
      create schema if not exists extensions;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
    `);
    await database.exec(migration);
    await database.exec(aiMigration);
    await database.exec(hardeningMigration);
    await database.exec(manualAdmissionMigration);
    await database.exec(manualRetentionMigration);
    await database.exec(`
      with source as (
        select id from public.sources where name = 'NJ Spotlight News'
      ), story as (
        insert into public.stories (canonical_title, first_seen_at, last_activity_at, scope, confidence)
        values ('NJ Spotlight News: August 24, 2026', now() - interval '2 days', now() - interval '1 day', 'state', 0.6)
        returning id
      ), items as (
        insert into public.source_items (
          source_id, url, canonical_url, headline, normalized_headline, publisher,
          published_at, content_hash, processing_status
        )
        select source.id, values.url, values.url, values.headline, values.normalized_headline,
               'NJ Spotlight News', values.published_at, values.content_hash, 'processed'
        from source
        cross join (values
          ('https://embedded.example/spotlight-august-24', 'NJ Spotlight News: August 24, 2026', 'spotlight news august 24 2026', now() - interval '2 days', repeat('4', 64)),
          ('https://embedded.example/spotlight-august-25', 'NJ Spotlight News: August 25, 2026', 'spotlight news august 25 2026', now() - interval '1 day', repeat('5', 64))
        ) as values(url, headline, normalized_headline, published_at, content_hash)
        returning id, headline
      )
      insert into public.story_sources (story_id, source_item_id, link_method, confidence, signals, attached_by)
      select story.id, items.id,
             case when items.headline like '%24, 2026' then 'created' else 'deterministic' end,
             case when items.headline like '%24, 2026' then 1 else 0.727 end,
             '{}'::jsonb, 'system'
      from story cross join items;
    `);
    await database.exec(calibrationMigration);

    const calibratedEdition = (await database.query(`
      select items.processing_status,
             count(*) filter (where links.detached_at is null)::integer as active_links,
             count(*) filter (where links.detached_at is not null)::integer as detached_links,
             count(distinct links.story_id)::integer as story_count
      from public.source_items as items
      join public.story_sources as links on links.source_item_id = items.id
      where items.headline = 'NJ Spotlight News: August 25, 2026'
      group by items.processing_status
    `)).rows[0];
    assert.deepEqual(calibratedEdition, { processing_status: "error", active_links: 1, detached_links: 1, story_count: 2 });

    await database.exec(`
      insert into public.stories (canonical_title, first_seen_at, last_activity_at, scope, confidence)
      select values.title, now() - interval '1 day', now() - interval '1 day', 'state', 0.6
      from (values
        ('Events This Week in New Jersey from August 25-31, 2026'),
        ('This Week in Music: Previews for Concerts from August 25-31, 2026'),
        ('Todd Rundgren LIVE! at Ocean City Music Pier')
      ) as values(title);

      with source as (
        select id from public.sources where name = 'New Jersey Stage'
      )
      insert into public.source_items (
        source_id, url, canonical_url, headline, normalized_headline, publisher,
        published_at, content_hash, processing_status
      )
      select source.id, values.url, values.url, values.headline, lower(values.headline),
             'New Jersey Stage', now() - interval '1 day', values.content_hash, 'processed'
      from source
      cross join (values
        ('https://embedded.example/stage-events-25', 'Events This Week in New Jersey from August 25-31, 2026', repeat('6', 64)),
        ('https://embedded.example/stage-events-18', 'Events This Week in New Jersey from August 18-24, 2026', repeat('7', 64)),
        ('https://embedded.example/stage-music-25', 'This Week in Music: Previews for Concerts from August 25-31, 2026', repeat('8', 64)),
        ('https://embedded.example/stage-music-18', 'This Week in Music: Previews for Concerts from August 18-24, 2026', repeat('9', 64)),
        ('https://embedded.example/stage-rundgren', 'Todd Rundgren LIVE! at Ocean City Music Pier', repeat('a', 64)),
        ('https://embedded.example/stage-outlaws', 'The Outlaws LIVE! at Ocean City Music Pier', repeat('b', 64))
      ) as values(url, headline, content_hash);

      with repair_links(story_title, item_headline, link_method, confidence) as (values
        ('Events This Week in New Jersey from August 25-31, 2026', 'Events This Week in New Jersey from August 25-31, 2026', 'created', 1.0),
        ('Events This Week in New Jersey from August 25-31, 2026', 'Events This Week in New Jersey from August 18-24, 2026', 'deterministic', 0.700),
        ('This Week in Music: Previews for Concerts from August 25-31, 2026', 'This Week in Music: Previews for Concerts from August 25-31, 2026', 'created', 1.0),
        ('This Week in Music: Previews for Concerts from August 25-31, 2026', 'This Week in Music: Previews for Concerts from August 18-24, 2026', 'deterministic', 0.700),
        ('Todd Rundgren LIVE! at Ocean City Music Pier', 'Todd Rundgren LIVE! at Ocean City Music Pier', 'created', 1.0),
        ('Todd Rundgren LIVE! at Ocean City Music Pier', 'The Outlaws LIVE! at Ocean City Music Pier', 'deterministic', 0.704)
      )
      insert into public.story_sources (story_id, source_item_id, link_method, confidence, signals, attached_by)
      select stories.id, items.id, repair_links.link_method, repair_links.confidence, '{}'::jsonb, 'system'
      from repair_links
      join public.stories as stories on stories.canonical_title = repair_links.story_title
      join public.source_items as items on items.headline = repair_links.item_headline;
    `);
    await database.exec(productionCalibrationMigration);

    const productionCalibrations = (await database.query(`
      select items.headline,
             items.processing_status,
             count(*) filter (where links.detached_at is null)::integer as active_links,
             count(*) filter (where links.detached_at is not null)::integer as detached_links,
             count(distinct links.story_id)::integer as story_count
      from public.source_items as items
      join public.story_sources as links on links.source_item_id = items.id
      where items.headline in (
        'Events This Week in New Jersey from August 18-24, 2026',
        'This Week in Music: Previews for Concerts from August 18-24, 2026',
        'The Outlaws LIVE! at Ocean City Music Pier'
      )
      group by items.headline, items.processing_status
      order by items.headline
    `)).rows;
    assert.equal(productionCalibrations.length, 3);
    for (const repaired of productionCalibrations) {
      assert.equal(repaired.processing_status, "error");
      assert.equal(repaired.active_links, 1);
      assert.equal(repaired.detached_links, 1);
      assert.equal(repaired.story_count, 2);
    }

    await database.exec(corroborationMigration);
    await database.exec(evidenceOriginMigration);
    await database.exec(blockedBusinessFeedMigration);
    await database.exec(sourceExpansionMigration);
    await database.exec(reconciliationMigration);
    await database.exec(localSourceExpansionMigration);
    await database.exec(verifiedSourceExpansionMigration);

    const catalog = (await database.query(`
      select count(*)::integer as tables,
             count(*) filter (where classes.relrowsecurity)::integer as rls_tables,
             (select count(*)::integer from pg_proc as procedures
                join pg_namespace as procedure_namespaces on procedure_namespaces.oid = procedures.pronamespace
                where procedure_namespaces.nspname = 'public') as functions
      from pg_class as classes
      join pg_namespace as namespaces on namespaces.oid = classes.relnamespace
      where namespaces.nspname = 'public' and classes.relkind = 'r'
    `)).rows[0];
    assert.deepEqual(catalog, { tables: 20, rls_tables: 20, functions: 41 });

    const referenceCounts = (await database.query(`
      select (select count(*)::integer from public.counties) as counties,
             (select count(*)::integer from public.municipalities) as municipalities,
             (select count(*)::integer from public.sources) as sources
    `)).rows[0];
    assert.deepEqual(referenceCounts, { counties: 21, municipalities: 564, sources: 78 });

    const sourceActivation = (await database.query(`
      select count(*) filter (where active)::integer as active,
             count(*) filter (where not active)::integer as disabled,
             array_agg(name order by name) filter (where not active) as disabled_names
      from public.sources
    `)).rows[0];
    assert.deepEqual(sourceActivation, {
      active: 72,
      disabled: 6,
      disabled_names: ["511NJ Active Events", "BreakingAC", "Hudson County View", "New Jersey Business Magazine", "Route 40", "Star News Group"],
    });

    const expansionAudit = (await database.query(`
      with expected(name) as (
        values
        ${expandedSourceValuesSql}
      )
      select count(distinct sources.id)::integer as sources,
             count(distinct sources.id) filter (where sources.active)::integer as active_sources,
             count(distinct sources.id) filter (
               where assessments.assessment_status = 'reviewed'
                 and assessments.evidence_role = 'independent_journalism'
                 and assessments.verification_tier >= 2
                 and assessments.superseded_at is null
             )::integer as qualifying_sources,
             count(distinct assessments.corroboration_group_key) filter (
               where assessments.superseded_at is null
             )::integer as independent_groups,
             count(distinct sources.id) filter (where sources.adapter_config ? 'include_categories')::integer as category_allowlisted_sources,
             count(distinct sources.id) filter (where sources.adapter_config ? 'exclude_url_patterns')::integer as url_filtered_sources
      from expected
      left join public.sources as sources on sources.name = expected.name
      left join public.source_assessments as assessments on assessments.source_id = sources.id
    `)).rows[0];
    assert.deepEqual(expansionAudit, {
      sources: 27,
      active_sources: 26,
      qualifying_sources: 27,
      independent_groups: 21,
      category_allowlisted_sources: 4,
      url_filtered_sources: 3,
    });

    const reviewedCoverage = (await database.query(`
      select count(distinct sources.id)::integer as qualifying_active_endpoints,
             count(distinct assessments.corroboration_group_key)::integer as independent_groups
      from public.sources as sources
      join public.source_assessments as assessments on assessments.source_id = sources.id
      where sources.active
        and assessments.superseded_at is null
        and assessments.assessment_status = 'reviewed'
        and assessments.evidence_role = 'independent_journalism'
        and assessments.verification_tier >= 2
    `)).rows[0];
    assert.deepEqual(reviewedCoverage, { qualifying_active_endpoints: 64, independent_groups: 57 });

    const assessmentAudit = (await database.query(`
      select count(*)::integer as assessments,
             count(*) filter (where superseded_at is null)::integer as current_assessments,
             count(distinct source_id) filter (where superseded_at is null)::integer as assessed_sources
      from public.source_assessments
    `)).rows[0];
    assert.deepEqual(assessmentAudit, { assessments: 81, current_assessments: 78, assessed_sources: 78 });
    const originKeys = (await database.query(`
      select public.reath_evidence_origin_key('New Jersey Statehouse News Service', 'first-provider') as statehouse,
             public.reath_evidence_origin_key('By New Jersey State House News', 'second-provider') as state_house,
             public.reath_evidence_origin_key('The Associated Press', 'third-provider') as associated_press,
             public.reath_evidence_origin_key('By Thomson Reuters', 'fourth-provider') as reuters,
             public.reath_evidence_origin_key('NBC New York Staff and Associated Press', 'fifth-provider') as compound_ap_suffix,
             public.reath_evidence_origin_key('Associated Press with NBC New York Staff', 'sixth-provider') as compound_ap_prefix,
             public.reath_evidence_origin_key('Local Desk with Reuters', 'seventh-provider') as compound_reuters_suffix,
             public.reath_evidence_origin_key('Reuters and Local Desk', 'eighth-provider') as compound_reuters_prefix,
             public.reath_evidence_origin_key('Associated Press Street Desk', 'ninth-provider') as ap_false_positive,
             public.reath_evidence_origin_key('Reuters Avenue Bureau', 'tenth-provider') as reuters_false_positive,
             public.reath_evidence_origin_key('Independent Reporter', 'local-newsroom') as local
    `)).rows[0];
    assert.deepEqual(originKeys, {
      statehouse: "origin:new-jersey-statehouse-news-service",
      state_house: "origin:new-jersey-statehouse-news-service",
      associated_press: "origin:associated-press",
      reuters: "origin:reuters",
      compound_ap_suffix: "origin:associated-press",
      compound_ap_prefix: "origin:associated-press",
      compound_reuters_suffix: "origin:reuters",
      compound_reuters_prefix: "origin:reuters",
      ap_false_positive: "provider:ninth-provider",
      reuters_false_positive: "provider:tenth-provider",
      local: "provider:local-newsroom",
    });
    await database.exec(`
      with story_rows as (
        insert into public.stories (canonical_title, first_seen_at, last_activity_at, scope, confidence)
        values
          ('Embedded syndicated evidence Story', now(), now(), 'state', 0.6),
          ('Embedded independent evidence Story', now(), now(), 'state', 0.6)
        returning id, canonical_title
      ), source_rows as (
        select id, name from public.sources
        where name in ('MercerMe', 'New Brunswick Today')
      ), item_rows as (
        insert into public.source_items (
          source_id, url, canonical_url, headline, normalized_headline, author,
          publisher, published_at, content_hash, processing_status
        )
        select source_rows.id,
               'https://embedded.example/' || replace(lower(story_rows.canonical_title), ' ', '-') || '-' || replace(lower(source_rows.name), ' ', '-'),
               'https://embedded.example/' || replace(lower(story_rows.canonical_title), ' ', '-') || '-' || replace(lower(source_rows.name), ' ', '-'),
               story_rows.canonical_title,
               replace(lower(story_rows.canonical_title), ' ', '-'),
               case
                 when story_rows.canonical_title like '%syndicated%' and source_rows.name = 'MercerMe'
                   then 'New Jersey Statehouse News Service'
                 when story_rows.canonical_title like '%syndicated%'
                   then 'New Jersey State House News'
                 else source_rows.name || ' Staff'
               end,
               source_rows.name,
               now(),
               md5(story_rows.canonical_title || source_rows.name)
                 || md5('second-half:' || story_rows.canonical_title || source_rows.name),
               'processed'
        from story_rows cross join source_rows
        returning id, headline
      )
      insert into public.story_sources (story_id, source_item_id, link_method, confidence, signals, attached_by)
      select story_rows.id, item_rows.id, 'deterministic', 0.9, '{}'::jsonb, 'embedded-check'
      from story_rows
      join item_rows on item_rows.headline = story_rows.canonical_title;
    `);
    const embeddedOriginSignals = (await database.query(`
      select stories.canonical_title,
             summary.journalism_group_count,
             summary.reputable_group_count,
             summary.is_corroborated
      from public.stories as stories
      join public.story_corroboration_summary as summary on summary.story_id = stories.id
      where stories.canonical_title in (
        'Embedded syndicated evidence Story',
        'Embedded independent evidence Story'
      )
      order by stories.canonical_title
    `)).rows;
    assert.deepEqual(embeddedOriginSignals, [
      { canonical_title: "Embedded independent evidence Story", journalism_group_count: 2, reputable_group_count: 2, is_corroborated: true },
      { canonical_title: "Embedded syndicated evidence Story", journalism_group_count: 1, reputable_group_count: 1, is_corroborated: false },
    ]);
    const corroborationAudit = (await database.query(`
      select count(*)::integer as summaries,
             count(distinct story_id)::integer as distinct_stories
      from public.story_corroboration_summary
    `)).rows[0];
    const activeStoryCount = (await database.query("select count(*)::integer as count from public.stories where status <> 'merged'")).rows[0].count;
    assert.deepEqual(corroborationAudit, { summaries: activeStoryCount, distinct_stories: activeStoryCount });

    const admittedRun = (await database.query(`
      select public.start_ingestion_run('acceptance_test', 'embedded-check', 960) as admission
    `)).rows[0].admission;
    assert.equal(admittedRun.admitted, true);
    const activeRunId = admittedRun.run.id;
    const scheduledRun = (await database.query(`
      select public.start_ingestion_run('scheduled', 'overlap-check', 960) as admission
    `)).rows[0].admission;
    assert.equal(scheduledRun.admitted, false);
    assert.equal(scheduledRun.run, null);
    assert.equal(scheduledRun.reason, "manual_only");
    const busyRun = (await database.query(`
      select public.start_ingestion_run('manual', 'overlap-check', 960) as admission
    `)).rows[0].admission;
    assert.equal(busyRun.admitted, false);
    assert.equal(busyRun.run.id, activeRunId);
    assert.equal(busyRun.reason, "already_running");
    await expectSqlState(database, `
      insert into public.ingestion_runs (trigger_type, triggered_by)
      values ('acceptance_test', 'overlap-check')
    `, [], "23505");
    const finishedRun = (await database.query(`
      select public.finish_ingestion_run(
        $1::uuid, 'succeeded', 0, 0, 0, 0, 0, null, 1
      ) as finished
    `, [activeRunId])).rows[0].finished;
    assert.equal(finishedRun.status, "succeeded");
    assert.equal((await database.query(`
      select public.finish_ingestion_run(
        $1::uuid, 'failed', 0, 0, 0, 0, 1, 'late worker', 2
      ) as finished
    `, [activeRunId])).rows[0].finished, null, "A late worker must not overwrite a terminal run");

    const agedItem = (await database.query(`
      insert into public.source_items (
        source_id, url, canonical_url, headline, normalized_headline,
        publisher, published_at, content_hash
      )
      select id, 'https://retention.example/aged', 'https://retention.example/aged',
             'Aged retention fixture', 'aged retention fixture', name,
             now() - interval '31 days', repeat('e', 64)
      from public.sources order by id limit 1
      returning id, processing_status
    `)).rows[0];
    assert.equal(agedItem.processing_status, "ignored");
    await database.query("update public.sources set last_checked_at = now() where active");
    const manualRun = (await database.query(`
      select public.start_ingestion_run('manual', 'embedded-manual-check', 960) as admission
    `)).rows[0].admission;
    assert.equal(manualRun.admitted, true);
    assert.equal(manualRun.maintenance.aged_backlog_deleted, 1);
    assert.equal((await database.query(
      "select count(*)::integer as count from public.source_items where id = $1::uuid",
      [agedItem.id],
    )).rows[0].count, 0);
    assert.equal((await database.query(
      "select count(*)::integer as count from public.sources where active and last_checked_at is not null",
    )).rows[0].count, 0);
    await database.query(`
      select public.finish_ingestion_run($1::uuid, 'succeeded', 0, 0, 0, 0, 0, null, 1)
    `, [manualRun.run.id]);

    const staleRunId = (await database.query(`
      insert into public.ingestion_runs (trigger_type, triggered_by, started_at)
      values ('acceptance_test', 'stale-check', now() - interval '17 minutes') returning id
    `)).rows[0].id;
    const replacement = (await database.query(`
      select public.start_ingestion_run('acceptance_test', 'replacement-check', 960) as admission
    `)).rows[0].admission;
    assert.equal(replacement.admitted, true);
    assert.equal((await database.query(
      "select status from public.ingestion_runs where id = $1::uuid",
      [staleRunId],
    )).rows[0].status, "failed");
    await database.query(`
      select public.finish_ingestion_run($1::uuid, 'succeeded', 0, 0, 0, 0, 0, null, 1)
    `, [replacement.run.id]);

    const privileges = (await database.query(`
      select has_table_privilege('anon', 'public.stories', 'select') as anon_stories,
             has_table_privilege('authenticated', 'public.story_analyses', 'select') as authenticated_analyses,
             has_table_privilege('service_role', 'public.story_analyses', 'select') as service_analyses,
             has_table_privilege('anon', 'public.source_assessments', 'select') as anon_assessments,
             has_table_privilege('service_role', 'public.source_assessments', 'select') as service_assessments,
             has_table_privilege('service_role', 'public.source_assessments', 'delete') as service_delete_assessments,
             has_function_privilege(
               'anon',
               'public.claim_story_analysis_attempt(uuid,text,text,text,text,text,text,integer)',
               'execute'
             ) as anon_claim,
              has_function_privilege(
                'service_role',
                'public.claim_story_analysis_attempt(uuid,text,text,text,text,text,text,integer)',
                'execute'
              ) as service_claim,
              has_function_privilege(
                'anon',
                'public.start_ingestion_run(text,text,integer)',
                'execute'
              ) as anon_ingestion_start,
              has_function_privilege(
                'service_role',
                'public.start_ingestion_run(text,text,integer)',
                'execute'
              ) as service_ingestion_start
    `)).rows[0];
    assert.deepEqual(privileges, {
      anon_stories: false,
      authenticated_analyses: false,
      service_analyses: true,
      anon_assessments: false,
      service_assessments: true,
      service_delete_assessments: false,
      anon_claim: false,
      service_claim: true,
      anon_ingestion_start: false,
      service_ingestion_start: true,
    });

    const sourceId = (await database.query(
      "select id from public.sources where active order by priority desc limit 1",
    )).rows[0].id;
    const processingToken = "20000000-0000-4000-8000-000000000001";
    const sourceItemId = (await database.query(`
      insert into public.source_items (
        source_id, url, canonical_url, headline, normalized_headline, publisher,
        content_hash, processing_status, processing_token, processing_started_at
      ) values (
        $1::uuid, 'https://embedded.example/item', 'https://embedded.example/item',
        'Atomic Story assignment', 'atomic story assignment', 'Embedded', repeat('e', 64),
        'processing', $2::uuid, now()
      ) returning id
    `, [sourceId, processingToken])).rows[0].id;
    const assignedStory = (await database.query(`
      select public.assign_source_item_to_story(
        $1::uuid, $2::uuid, null, 'Atomic Story assignment', now(), now(),
        'state', 'created', 1, '{"reason":"embedded"}'::jsonb
      ) as story
    `, [sourceItemId, processingToken])).rows[0].story;
    assert.ok(assignedStory.id);
    assert.equal((await database.query(`
      select count(*)::integer as count from public.story_sources
      where story_id = $1::uuid and source_item_id = $2::uuid
    `, [assignedStory.id, sourceItemId])).rows[0].count, 1);
    await database.query(`
      update public.source_items
      set processing_status = 'processed', processing_token = null, processing_started_at = null
      where id = $1::uuid
    `, [sourceItemId]);
    await expectSqlState(database, `
      select public.assign_source_item_to_story(
        $1::uuid, $2::uuid, null, 'Stale assignment', now(), now(),
        'state', 'created', 1, '{}'::jsonb
      )
    `, [sourceItemId, processingToken], "PT412");

    const storyId = (await database.query(`
      insert into public.stories (canonical_title, first_seen_at, last_activity_at)
      values ('Embedded migration check', now(), now()) returning id
    `)).rows[0].id;
    const fingerprintA = "a".repeat(64);
    const cacheA = "b".repeat(64);
    const fingerprintB = "c".repeat(64);
    const cacheB = "d".repeat(64);
    const requestBasic = `
      select * from public.request_story_ai_enrichment(
        $1::uuid, 1, $2, $3, '1', '1', 'enrich-story-v1',
        'openai', 'gpt-5-mini', 50, $4, 'embedded-check', false
      )
    `;
    await expectSqlState(database, requestBasic.replace("$1::uuid, 1", "$1::uuid, 0"), [storyId, fingerprintA, cacheA, "new_story"], "PT412");
    assert.equal((await database.query(
      "select count(*)::integer as count from public.story_ai_state where story_id = $1::uuid",
      [storyId],
    )).rows[0].count, 0);
    await database.query(requestBasic, [storyId, fingerprintA, cacheA, "new_story"]);
    await expectSqlState(database, `
      select public.record_story_ai_enrichment_cache_hit($1::uuid, 1, $2, $3, 'embedded-check')
    `, [storyId, fingerprintA, cacheA], "PT412");
    assert.equal((await database.query(`
      select count(*)::integer as count from public.ai_call_attempts
      where story_id = $1::uuid and status = 'cache_hit'
    `, [storyId])).rows[0].count, 0);
    const wrongClaim = (await database.query(`
      select public.claim_story_ai_enrichment(
        $1::uuid, 'embedded-check', '1', '1', 'enrich-story-v1',
        'openai', 'wrong-model', 60
      ) as claim
    `, [storyId])).rows[0].claim;
    assert.equal(wrongClaim, null);

    const basicClaim = (await database.query(`
      select public.claim_story_ai_enrichment(
        $1::uuid, 'embedded-check', '1', '1', 'enrich-story-v1',
        'openai', 'gpt-5-mini', 60
      ) as claim
    `, [storyId])).rows[0].claim;
    assert.ok(basicClaim?.lease_token);
    await database.query(requestBasic, [storyId, fingerprintB, cacheB, "material_change"]);
    await expectSqlState(database, `
      select * from public.create_story_ai_call_attempt(
        '10000000-0000-4000-8000-000000000001'::uuid, $1::uuid, $2::uuid, null
      )
    `, [storyId, basicClaim.lease_token], "55000");
    const released = (await database.query(`
      select public.release_story_ai_enrichment_claim(
        $1::uuid, $2::uuid, 'superseded_before_provider', 'Embedded identity-race check'
      ) as released
    `, [storyId, basicClaim.lease_token])).rows[0].released;
    assert.equal(released, true);
    const currentBasic = (await database.query(`
      select enrichment_status, requested_generation, current_input_fingerprint
      from public.story_ai_state where story_id = $1::uuid
    `, [storyId])).rows[0];
    assert.deepEqual(currentBasic, {
      enrichment_status: "pending",
      requested_generation: 2,
      current_input_fingerprint: fingerprintB,
    });
    const observedStateUpdatedAt = (await database.query(
      "select updated_at from public.story_ai_state where story_id = $1::uuid",
      [storyId],
    )).rows[0].updated_at;
    await database.query(`
      update public.story_ai_state
      set enrichment_version = '2', model = 'new-model', current_cache_key = $2,
          requested_generation = requested_generation + 1, updated_at = now() + interval '1 second'
      where story_id = $1::uuid
    `, [storyId, "9".repeat(64)]);
    await expectSqlState(database, `
      select * from public.request_story_ai_enrichment(
        $1::uuid, 1, $2, $3, '1', '1', 'enrich-story-v1',
        'openai', 'gpt-5-mini', 50, 'configuration_change', 'stale-batch', false, $4::timestamptz
      )
    `, [storyId, fingerprintA, cacheA, observedStateUpdatedAt], "PT412");
    assert.deepEqual((await database.query(`
      select enrichment_version, model from public.story_ai_state where story_id = $1::uuid
    `, [storyId])).rows[0], { enrichment_version: "2", model: "new-model" });

    const requestDeep = async (fingerprint, cacheKey) => (await database.query(`
      select * from public.request_story_analysis_attempt(
        $1::uuid, 1, 'compare_sources', $2, $3, '1', 'openai', 'gpt-5-mini',
        '1', 'compare-sources-v1', 'embedded-check', 'editor_request'
      )
    `, [storyId, fingerprint, cacheKey])).rows[0];
    await expectSqlState(database, `
      select * from public.request_story_analysis_attempt(
        $1::uuid, 0, 'compare_sources', $2, $3, '1', 'openai', 'gpt-5-mini',
        '1', 'compare-sources-v1', 'embedded-check', 'editor_request'
      )
    `, [storyId, fingerprintA, cacheA], "PT412");
    assert.equal((await database.query(`
      select count(*)::integer as count from public.ai_call_attempts
      where story_id = $1::uuid and operation_type = 'compare_sources'
    `, [storyId])).rows[0].count, 0);
    const deepA = await requestDeep(fingerprintA, cacheA);
    const deepClaim = (await database.query(`
      select public.claim_story_analysis_attempt(
        $1::uuid, 'embedded-check', '1', 'openai', 'gpt-5-mini',
        '1', 'compare-sources-v1', 60
      ) as claim
    `, [deepA.id])).rows[0].claim;
    assert.ok(deepClaim?.lease_token);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const began = (await database.query(`
        select public.begin_story_analysis_provider_call($1::uuid, $2::uuid) as began
      `, [deepA.id, deepClaim.lease_token])).rows[0].began;
      assert.equal(began, true);
    }
    const deepB = await requestDeep(fingerprintB, cacheB);
    const deepAAgain = await requestDeep(fingerprintA, cacheA);
    assert.equal(deepAAgain.id, deepA.id);
    const completedDeep = (await database.query(`
      select public.complete_story_analysis(
        $1::uuid, 'compare_sources', $2::uuid, $3::uuid, $4, '{}'::jsonb,
        'gpt-5-mini', 'embedded-request', 12, 8, 10, 5, 15, '{}'::jsonb
      ) as analysis
    `, [storyId, deepA.id, deepClaim.lease_token, fingerprintA])).rows[0].analysis;
    assert.ok(completedDeep?.id);
    const deepLifecycle = (await database.query(`
      select (select status from public.ai_call_attempts where id = $1::uuid) as a_status,
             (select status from public.ai_call_attempts where id = $2::uuid) as b_status,
             (select count(*)::integer from public.ai_call_attempts
                where story_id = $3::uuid and operation_type = 'compare_sources' and status = 'queued') as queued
    `, [deepA.id, deepB.id, storyId])).rows[0];
    assert.deepEqual(deepLifecycle, { a_status: "succeeded", b_status: "skipped", queued: 0 });

    const newModelDeep = (await database.query(`
      select * from public.request_story_analysis_attempt(
        $1::uuid, 1, 'compare_sources', $2, $3, '1', 'openai', 'new-model',
        '1', 'compare-sources-v1', 'embedded-check', 'editor_request'
      )
    `, [storyId, fingerprintB, "e".repeat(64)])).rows[0];
    const wrongDeepClaim = (await database.query(`
      select public.claim_story_analysis_attempt(
        $1::uuid, 'embedded-check', '1', 'openai', 'gpt-5-mini',
        '1', 'compare-sources-v1', 60
      ) as claim
    `, [newModelDeep.id])).rows[0].claim;
    assert.equal(wrongDeepClaim, null);
    assert.equal((await database.query(
      "select status from public.ai_call_attempts where id = $1::uuid",
      [newModelDeep.id],
    )).rows[0].status, "queued");
    const replacementDeep = await requestDeep("f".repeat(64), "0".repeat(64));
    assert.deepEqual((await database.query(`
      select (select status from public.ai_call_attempts where id = $1::uuid) as old_status,
             (select error_code from public.ai_call_attempts where id = $1::uuid) as old_error,
             (select status from public.ai_call_attempts where id = $2::uuid) as replacement_status
    `, [newModelDeep.id, replacementDeep.id])).rows[0], {
      old_status: "skipped",
      old_error: "superseded",
      replacement_status: "queued",
    });

    await expectSqlState(database, `
      update public.story_ai_state set lease_token = gen_random_uuid()
      where story_id = $1::uuid
    `, [storyId], "23514");
    await expectSqlState(database, `
      insert into public.ai_call_attempts (
        story_id, operation_type, status, evidence_revision, input_fingerprint,
        cache_key, enrichment_version, provider, model, schema_version, prompt_version, requested_by, lease_token
      ) values (
        $1::uuid, 'editorial_context', 'queued', 1, $2, $3, '1',
        'openai', 'gpt-5-mini', '1', 'editorial-context-v1', 'embedded-check', gen_random_uuid()
      )
    `, [storyId, fingerprintA, cacheA], "23514");
    await expectSqlState(database, `
      insert into public.ai_call_attempts (
        story_id, operation_type, status, request_generation, evidence_revision, input_fingerprint,
        cache_key, enrichment_version, provider, model, schema_version, prompt_version, requested_by,
        lease_token, lease_owner, lease_expires_at
      ) values (
        $1::uuid, 'enrich_story', 'queued', 99, 1, $2, $3, '1',
        'openai', 'gpt-5-mini', '1', 'enrich-story-v1', 'embedded-check',
        gen_random_uuid(), 'invalid-basic-lease', now() + interval '1 minute'
      )
    `, [storyId, fingerprintA, cacheA], "23514");

    console.log("Embedded Postgres checks passed: 20 tables and 41 functions execute with RLS/ACLs intact; 78 assessed Sources include 15 additional filtered local providers, 72 are active, and blocked feeds remain disabled; compound wire provenance, manual-only ingestion/retention, reconciliation audit/recovery, ingestion fencing, and PT412 revision/config/cache/deep-supersession semantics hold.");
  } finally {
    await database.close();
  }
};

await runEmbeddedDatabaseChecks();

const url = process.env.SUPABASE_URL;
const projectRef = process.env.SUPABASE_PROJECT_REF;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !projectRef || !key) {
  console.log("Live database check skipped: server-only Supabase environment is not present in this shell.");
  process.exit(0);
}
assert.equal(projectRef, "okqkljexfzolzxysjaha", "Refusing to inspect a non-Reath Supabase project");
assert.equal(deriveSupabaseProjectRef(url), projectRef, "SUPABASE_URL must be the exact authorized HTTPS Supabase project URL");
const supabase = createClient(url, key, { auth:{ persistSession:false, autoRefreshToken:false } });
const [counties, municipalities, sources, sourceActivation, sourceAssessments, corroborationSummaries, stories, aiState, aiCalls, analyses] = await Promise.all([
  supabase.from("counties").select("id", { count:"exact", head:true }),
  supabase.from("municipalities").select("id", { count:"exact", head:true }),
  supabase.from("sources").select("id", { count:"exact", head:true }),
  supabase.from("sources").select("name,active,last_error,editorial_notes").order("name"),
  supabase.from("source_assessments").select("id", { count:"exact", head:true }).is("superseded_at", null),
  supabase.from("story_corroboration_summary").select("story_id", { count:"exact", head:true }),
  supabase.from("stories").select("id", { count:"exact", head:true }).neq("status", "merged"),
  supabase.from("story_ai_state").select("story_id", { count:"exact", head:true }),
  supabase.from("ai_call_attempts").select("id", { count:"exact", head:true }),
  supabase.from("story_analyses").select("id", { count:"exact", head:true }),
]);
for (const result of [counties, municipalities, sources, sourceActivation, sourceAssessments, corroborationSummaries, stories, aiState, aiCalls, analyses]) if (result.error) throw result.error;
assert.equal(counties.count, 21);
assert.equal(municipalities.count, 564);
assert.equal(sources.count, 78);
assert.equal(sourceAssessments.count, 78);
assert.equal(corroborationSummaries.count, stories.count);
assert.equal(sourceActivation.data.filter(({ active }) => active).length, 72);
assert.deepEqual(sourceActivation.data.filter(({ active }) => !active).map(({ name }) => name), ["511NJ Active Events", "BreakingAC", "Hudson County View", "New Jersey Business Magazine", "Route 40", "Star News Group"]);
assert.ok(sourceActivation.data.filter(({ active }) => !active).every(({ last_error, editorial_notes }) => last_error || editorial_notes), "Disabled feeds must explain why they are disabled");
const anonKey = process.env.SUPABASE_ANON_KEY;
if (anonKey) {
  const anon = createClient(url, anonKey, { auth:{ persistSession:false, autoRefreshToken:false } });
  const [storyRead, analysisRead, assessmentRead, corroborationRead, revisionRpc] = await Promise.all([
    anon.from("stories").select("id").limit(1),
    anon.from("story_analyses").select("id").limit(1),
    anon.from("source_assessments").select("id").limit(1),
    anon.from("story_corroboration_summary").select("story_id").limit(1),
    anon.rpc("list_story_ai_revision_mismatches", { p_limit: 0 }),
  ]);
  for (const denied of [storyRead, analysisRead, assessmentRead, corroborationRead, revisionRpc]) {
    assert.ok(denied.error, "Anonymous Reath database access unexpectedly succeeded");
  }
}
console.log(`Live database checks passed: 21 counties, 564 municipalities, 78 assessed Sources (72 active, 6 disabled or conditional), corroboration summaries complete, AI control-plane tables reachable by the server client${anonKey ? ", and anonymous table/view/RPC access denied" : ""}.`);
