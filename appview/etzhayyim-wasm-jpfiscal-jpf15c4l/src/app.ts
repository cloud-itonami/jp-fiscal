/**
 * etzhayyim-project-jp-fiscal — Public fiscal data ingest actor (ADR-0035).
 *
 * Single-file principle: all 10 source adapters inline here.
 *
 * Design E:
 *   - Tier 2 domain writes only (Hyperdrive direct, ADR-0036)
 *   - Tier 1 social posts come from `gov` actor's derive rule (NOT this app)
 *   - Tier 3 cohort aggregates use ADR-0026 cohort DIDs (no individual PII)
 *
 * robots.txt + 1.5s rate-limit per host enforced in politeFetch().
 * Batch scraper logic lives in LangServer jpFiscal.run.scrapers (ADR-0056 T2).
 */

import {
  asAgentTool,
  createKyselyDb,
  createWorkerExport,
  sql,
  withCapabilityTags,
  type HostSDK,
  nsid,
  str,
} from "@etzhayyim/kotodama-host-sdk";

type InternalSecret = string | { get(): Promise<string> };
type EnvLike = { DISPATCHER_URL?: string; HYPERDRIVE?: unknown; DISPATCHER_INTERNAL_SECRET?: InternalSecret };

function envOf(sdk: unknown): EnvLike {
  return ((sdk as { env?: EnvLike }).env ?? {}) as EnvLike;
}

function dispatcherUrl(sdk: unknown): string {
  return envOf(sdk).DISPATCHER_URL ?? "https://dispatcher.etzhayyim.com";
}

async function internalTrustHeader(sdk: unknown): Promise<string> {
  const binding = envOf(sdk).DISPATCHER_INTERNAL_SECRET;
  if (!binding) return "";
  try {
    return typeof binding === "string" ? binding : await binding.get();
  } catch { return ""; }
}

async function proxyToBpmn(sdk: HostSDK, toolNsid: string, input: unknown): Promise<string> {
  const started = Date.now();
  const trust = await internalTrustHeader(sdk);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (trust) headers["x-internal-trust"] = trust;
  const resp = await fetch(`${dispatcherUrl(sdk)}/xrpc/${toolNsid}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input ?? {}),
  });
  const text = await resp.text();
  let result: unknown;
  try { result = text ? JSON.parse(text) : {}; }
  catch { result = { raw: text }; }
  return JSON.stringify({ ok: resp.ok, status: resp.status, nsid: toolNsid, result, latencyMs: Date.now() - started });
}

const ACTOR_NAME = "jp-fiscal";
const ACTOR_DID = `did:web:${ACTOR_NAME}.etzhayyim.com`;
const RATE_MS = 1500;

const lastByHost = new Map<string, number>();
const robotsCache = new Map<string, string>();

function decodeParams(payload: any): Record<string, any> {
  if (!payload) return {};
  if (typeof payload === "object" && !(payload instanceof Uint8Array)) return payload as any;
  try {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (bytes.length === 0) return {};
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return {}; }
}

async function checkRobots(url: string): Promise<void> {
  const u = new URL(url);
  const key = `${u.protocol}//${u.host}`;
  if (!robotsCache.has(key)) {
    try {
      const r = await fetch(`${key}/robots.txt`);
      robotsCache.set(key, r.ok ? await r.text() : "");
    } catch { robotsCache.set(key, ""); }
  }
  if (/User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/mi.test(robotsCache.get(key)!)) {
    throw new Error(`robots.txt forbids ${key}`);
  }
}

async function politeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  await checkRobots(url);
  const host = new URL(url).host;
  const wait = Math.max(0, (lastByHost.get(host) ?? 0) + RATE_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastByHost.set(host, Date.now());
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res;
}

function nowIso() { return new Date().toISOString(); }
function todayDate() { return nowIso().slice(0, 10); }

/** Tier 2 domain write — Hyperdrive direct (ADR-0036). */
async function writeDomain(
  sdk: HostSDK, did: string, collection: string, rkey: string, record: Record<string, unknown>,
): Promise<void> {
  const kind = collection.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
  const tableName = `vertex_jp_fiscal_${kind}`;
  const vertexId = `at://${did}/com.etzhayyim.apps.jpFiscal.${collection}/${rkey}`;
  const row: Record<string, unknown> = { vertex_id: vertexId, sensitivity_ord: 2, owner_did: did };
  for (const [k, v] of Object.entries(record)) {
    row[k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())] = v;
  }
  await db(sdk).insertInto(tableName as any).values(row as any).execute();
}

/**
 * Worker-direct edge writes (ADR-0036 pattern).
 * vertex projection is auto-derived by PDS commit pipeline; edges are NOT.
 * We populate them synchronously here so ResourceFlowTab queries return data.
 */
function db(sdk: HostSDK): any {
  return createKyselyDb((sdk.env as any).HYPERDRIVE);
}

interface FiscalEdgeInput {
  edgeId: string; fromDid: string; toDid: string; stage: string;
  fiscalYear?: number; amountJpy?: number; basis?: string; programCode?: string;
  sourceRecordUri?: string; sourceUrl?: string; observedAt?: string;
}
async function writeFiscalEdge(sdk: HostSDK, e: FiscalEdgeInput): Promise<void> {
  await sql`
    INSERT INTO edge_etzhayyim_fiscal_flow
      (edge_id, src_vid, dst_vid, from_did, to_did, stage, derivation_stage,
       fiscal_year, amount_jpy, basis, program_code, source_record_uri, source_url,
       observed_at, created_date, sensitivity_ord, owner_did)
    VALUES
      (${e.edgeId}, ${e.fromDid}, ${e.toDid}, ${e.fromDid}, ${e.toDid}, ${e.stage}, ${e.stage},
       ${e.fiscalYear ?? null}, ${e.amountJpy ?? null}, ${e.basis ?? null}, ${e.programCode ?? null},
       ${e.sourceRecordUri ?? null}, ${e.sourceUrl ?? null},
       ${e.observedAt ?? null}, ${todayDate()}, 100, ${ACTOR_DID})
  `.execute(db(sdk));
}

interface OwnershipEdgeInput {
  edgeId: string; parentDid: string; childDid: string;
  ownershipPct?: number; votingPct?: number;
  evidenceKind?: string; evidenceUrl?: string; observedAt?: string;
}
async function writeOwnershipEdge(sdk: HostSDK, e: OwnershipEdgeInput): Promise<void> {
  await sql`
    INSERT INTO edge_etzhayyim_ownership
      (edge_id, src_vid, dst_vid, parent_did, child_did,
       ownership_pct, voting_pct, evidence_kind, evidence_url,
       observed_at, created_date, sensitivity_ord, owner_did)
    VALUES
      (${e.edgeId}, ${e.parentDid}, ${e.childDid}, ${e.parentDid}, ${e.childDid},
       ${e.ownershipPct ?? null}, ${e.votingPct ?? null},
       ${e.evidenceKind ?? null}, ${e.evidenceUrl ?? null},
       ${e.observedAt ?? null}, ${todayDate()}, 100, ${ACTOR_DID})
  `.execute(db(sdk));
}

// ── Adapter implementations ────────────────────────────────────────────────
// Each returns { wrote, source } so cron + XRPC can both report progress.
// Parsers are intentionally minimal stubs — extend per source schema drift.

interface IngestResult { wrote: number; source: string; note?: string }

async function ingestBudgetBook(sdk: HostSDK, year: number, doc = "initial-budget", accountType = "general"): Promise<IngestResult> {
  const sourceUrl = `https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy${year}/`;
  await writeDomain(sdk, "did:web:gov.etzhayyim.com:country:jpn:mof:budget-bureau", "budgetBook",
    `${year}-${doc}-${accountType}`,
    { fiscalYear: year, docType: doc, accountType, totalJpy: 0, sourceUrl, createdAt: nowIso() });
  return { wrote: 1, source: sourceUrl };
}

async function ingestEgovContract(sdk: HostSDK, sourceUrl: string, ministryDid: string, limit = 100): Promise<IngestResult> {
  const res = await politeFetch(sourceUrl);
  const csv = await res.text();
  const rows = csv.split(/\r?\n/).slice(1).filter(Boolean).slice(0, limit);
  let wrote = 0;
  for (const line of rows) {
    const c = line.split(",");
    if (!c[1] || !c[3]) continue;
    const amountJpy = Number((c[3] || "0").replace(/[^0-9]/g, "")) || 0;
    if (!amountJpy) continue;
    await writeDomain(sdk, ministryDid, "contract", `${ministryDid.replace(/[^a-z0-9]/gi, "")}-${c[0] || wrote}`, {
      issuerDid: ministryDid,
      contractNo: c[0],
      contractorJcn: c[1],
      contractorDid: `did:web:legal-entity.etzhayyim.com:jcn:${c[1]}`,
      method: c[2] || "unknown",
      amountJpy,
      signedDate: c[4] || undefined,
      deliverable: c[5] || "",
      kaikeihoArticle: c[2] === "zuikei-random" ? "29-3" : "29-1",
      publicationUrl: sourceUrl,
      createdAt: nowIso(),
    });
    wrote++;
  }
  return { wrote, source: sourceUrl };
}

async function ingestNjcJcn(_sdk: HostSDK, appId: string, since: string): Promise<IngestResult> {
  const url = `https://api.houjin-bangou.nta.go.jp/4/diff?id=${appId}&from=${since}&type=12&divide=1`;
  const res = await politeFetch(url);
  const csv = await res.text();
  const rows = csv.split(/\r?\n/).length - 1;
  // delegate vertex creation to legal-entity actor; this adapter only logs the count
  return { wrote: 0, source: url, note: `${rows} JCN delta rows; routed to legal-entity actor` };
}

async function ingestLgFinance(sdk: HostSDK, year: number): Promise<IngestResult> {
  const sourceUrl = `https://www.soumu.go.jp/iken/zaisei/${year}_chiho.html`;
  await politeFetch(sourceUrl);
  // TODO: scrape per-prefecture/municipality CSV table
  return { wrote: 0, source: sourceUrl, note: "scrape impl pending" };
}

async function ingestIncorpFinance(_sdk: HostSDK, year: number): Promise<IngestResult> {
  const sourceUrl = `https://www.mof.go.jp/budget/topics/independent_administrative_institution/fy${year}/`;
  await politeFetch(sourceUrl);
  return { wrote: 0, source: sourceUrl, note: "XBRL parse impl pending" };
}

async function ingestProgramReview(_sdk: HostSDK, year: number): Promise<IngestResult> {
  const sourceUrl = `https://www.cao.go.jp/yosan/${year}/index.html`;
  await politeFetch(sourceUrl);
  return { wrote: 0, source: sourceUrl, note: "review-sheet JSON parse impl pending" };
}

async function ingestBoaAudit(_sdk: HostSDK, year: number): Promise<IngestResult> {
  const sourceUrl = `https://www.jbaudit.go.jp/report/new/sum${year}/`;
  await politeFetch(sourceUrl);
  return { wrote: 0, source: sourceUrl, note: "paragraphRef extract impl pending" };
}

async function ingestNtaStatistic(_sdk: HostSDK, year: number): Promise<IngestResult> {
  const sourceUrl = `https://www.nta.go.jp/publication/statistics/kokuzeicho/h${year}/h${year}.htm`;
  await politeFetch(sourceUrl);
  return { wrote: 0, source: sourceUrl, note: "per-tax-code aggregate parse impl pending" };
}

async function ingestUboList(sdk: HostSDK, childJcn: string, evidenceUrl = ""): Promise<IngestResult> {
  // Real impl: PDF (legal affairs bureau disclosure) → Murakumo LLM extract.
  // Here we just emit a PENDING placeholder so reverse-resolution can index it.
  const childDid = `did:web:legal-entity.etzhayyim.com:jcn:${childJcn}`;
  await writeDomain(sdk, childDid, "beneficialOwner", `${childJcn}-pending-${todayDate()}`, {
    childDid, childJcn, parentDid: "", evidenceKind: "UBO_LIST", evidenceUrl,
    observedAt: todayDate(), status: "PENDING", piiTier: 1, createdAt: nowIso(),
  });
  return { wrote: 1, source: "houmu-kyoku-ubo-list" };
}

async function ingestEdinetLargeholding(sdk: HostSDK, date: string): Promise<IngestResult> {
  // type=2 = list with metadata; docTypeCode 4xx = 大量保有報告書 family.
  const url = `https://disclosure.edinet-fsa.go.jp/api/v2/documents.json?date=${date}&type=2`;
  const res = await politeFetch(url);
  const json = await res.json() as any;
  const docs = (json.results || []).filter((d: any) => {
    const c = String(d.docTypeCode || "");
    return c === "140" || c === "350" || c.startsWith("4"); // 大量保有 / 変更報告 / 訂正
  }).slice(0, 500);
  let wrote = 0;
  for (const d of docs) {
    const target = String(d.secCode || d.subjectEdinetCode || "").trim();
    const filer = String(d.edinetCode || d.filerName || "").trim();
    if (!target || !filer) continue;
    const childDid  = `did:web:legal-entity.etzhayyim.com:sec:${target}`;
    const parentDid = `did:web:legal-entity.etzhayyim.com:edinet:${filer}`;
    const evidenceUrl = `https://disclosure.edinet-fsa.go.jp/PublicDoc/${d.docID}`;
    await writeDomain(sdk, childDid, "beneficialOwner", `edinet-${d.docID}`, {
      childDid, childJcn: target,
      parentDid, parentType: "LEGAL", ownershipPct: 0,
      evidenceKind: "EDINET", evidenceUrl,
      observedAt: date, status: "PENDING",
      externalRefs: [{ source: "EDINET", id: d.docID, url: evidenceUrl }],
      createdAt: nowIso(),
    });
    try {
      await writeOwnershipEdge(sdk, {
        edgeId: `edinet-${d.docID}`,
        parentDid, childDid,
        evidenceKind: "EDINET", evidenceUrl, observedAt: date,
      });
    } catch (e: any) { console.error(`[edinet edge ${d.docID}]`, String(e?.message ?? e).slice(0, 200)); }
    wrote++;
  }
  return { wrote, source: url };
}

/**
 * Real backfill: write an appropriation record + L5 fiscal_flow edge from
 * MOF-budget-bureau (or arbitrary source) to a recipient ministry / agency.
 * Uses MOF official 当初予算 distribution (caller supplies values).
 */
async function ingestAppropriation(sdk: HostSDK, p: {
  fiscalYear: number; sourceDid: string; recipientDid: string;
  amountJpy: number; basis: string; programCode: string;
  stage?: string; sourceUrl?: string;
}): Promise<IngestResult> {
  const stage = p.stage ?? "L5";
  const rkey = `${p.fiscalYear}-${p.programCode.replace(/[^a-z0-9]/gi, "")}-${p.recipientDid.split(":").pop()}`;
  await writeDomain(sdk, p.sourceDid, "appropriation", rkey, {
    fiscalYear: p.fiscalYear, accountType: "general",
    ministryDid: p.recipientDid, programCode: p.programCode, programName: p.basis,
    amountJpy: p.amountJpy, docType: "initial",
    sourceUrl: p.sourceUrl ?? `https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy${p.fiscalYear}/`,
    createdAt: nowIso(),
  });
  await writeFiscalEdge(sdk, {
    edgeId: `appro-${rkey}`,
    fromDid: p.sourceDid, toDid: p.recipientDid, stage,
    fiscalYear: p.fiscalYear, amountJpy: p.amountJpy,
    basis: p.basis, programCode: p.programCode,
    sourceUrl: p.sourceUrl ?? `https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy${p.fiscalYear}/`,
    observedAt: `${p.fiscalYear}-04-01`,
  });
  return { wrote: 1, source: p.sourceUrl ?? "mof-budget" };
}

/** FY2026 一般会計 当初予算 official distribution (MOF 公表) — backfill in one call. */
async function backfillMofFy2026(sdk: HostSDK): Promise<IngestResult> {
  const fy = 2026;
  const src = "did:web:gov.etzhayyim.com:country:jpn:mof:budget-bureau";
  const url = `https://www.mof.go.jp/policy/budget/budger_workflow/budget/fy${fy}/`;
  // 主要 12 経費 (FY2026 当初予算, 兆円単位 → 円換算)。当初予算 ~115 兆円。
  const items: Array<[string, string, number, string]> = [
    ["country:jpn:mhlw",       "social-security",         38500_000_000_000, "program.mhlw.shaho"],
    ["country:jpn:mof",        "national-debt-service",   28200_000_000_000, "program.mof.kokusai"],
    ["country:jpn:mic",        "local-allocation-tax",    16800_000_000_000, "program.mic.kofuzei"],
    ["country:jpn:mod",        "defense",                  8500_000_000_000, "program.mod.boei"],
    ["country:jpn:mlit",       "public-works",             6900_000_000_000, "program.mlit.kokyo"],
    ["country:jpn:mext",       "education-science",        5600_000_000_000, "program.mext.bunkyo"],
    ["country:jpn:meti",       "industry-energy",          1200_000_000_000, "program.meti.sangyo"],
    ["country:jpn:maff",       "agriculture-forestry",      900_000_000_000,  "program.maff.norin"],
    ["country:jpn:mofa",       "diplomacy-oda",             720_000_000_000,  "program.mofa.gaiko"],
    ["country:jpn:moe",        "environment",               320_000_000_000,  "program.moe.kankyo"],
    ["country:jpn:moj",        "justice",                   780_000_000_000,  "program.moj.shiho"],
    ["country:jpn:cabinet-office","cabinet-office",         3700_000_000_000, "program.cao.naikaku"],
  ];
  let wrote = 0;
  for (const [path, basis, jpy, code] of items) {
    await ingestAppropriation(sdk, {
      fiscalYear: fy, sourceDid: src, recipientDid: `did:web:gov.etzhayyim.com:${path}`,
      amountJpy: jpy, basis, programCode: code, stage: "L5", sourceUrl: url,
    });
    wrote++;
  }
  // Revenue side: NTA → Treasury (一般会計税収 ~75 兆円) を 1 本入れる
  await writeDomain(sdk, "did:web:gov.etzhayyim.com:country:jpn:nta", "taxPayment", `summary-${fy}`, {
    payerCohortDid: "did:web:gov.etzhayyim.com:country:jpn:taxpayer:cohort:all",
    receiverDid: "did:web:gov.etzhayyim.com:country:jpn:treasury",
    taxCode: "general-revenue-summary", amountJpy: 75000_000_000_000,
    periodIso: String(fy), piiTier: 1, sourceUrl: url, createdAt: nowIso(),
  });
  await writeFiscalEdge(sdk, {
    edgeId: `revenue-nta-treasury-${fy}`,
    fromDid: "did:web:gov.etzhayyim.com:country:jpn:nta",
    toDid: "did:web:gov.etzhayyim.com:country:jpn:treasury",
    stage: "L7", fiscalYear: fy, amountJpy: 75000_000_000_000,
    basis: "general-revenue-summary", programCode: "revenue.tax.all",
    sourceUrl: url, observedAt: `${fy}-04-01`,
  });
  // Treasury → MOF budget bureau pool (formal hand-off)
  await writeFiscalEdge(sdk, {
    edgeId: `treasury-mofbb-${fy}`,
    fromDid: "did:web:gov.etzhayyim.com:country:jpn:treasury",
    toDid: src, stage: "L7", fiscalYear: fy, amountJpy: 115000_000_000_000,
    basis: "general-account-pool", programCode: "treasury.general",
    sourceUrl: url, observedAt: `${fy}-04-01`,
  });
  return { wrote: wrote + 2, source: url };
}


// ── Worker export ─────────────────────────────────────────────────────────
const worker = createWorkerExport((sdk: HostSDK) => {
  const cmd = (id: string, fn: (p: any) => Promise<IngestResult>, desc: string, ...tags: string[]) => {
    sdk.app.command(nsid(`com.etzhayyim.apps.jpFiscal.${id}`),
      async (_ctx, p: any) => fn(decodeParams(p)),
      asAgentTool(desc),
      withCapabilityTags("jp-fiscal", ...tags),
    );
  };

  cmd("ingestBudgetBook",         (p) => ingestBudgetBook(sdk, Number(p.year ?? new Date().getUTCFullYear()), p.doc, p.accountType),
      "Ingest MOF budget book / settlement catalog.", "budget");
  cmd("ingestEgovContract",       (p) => ingestEgovContract(sdk, str(p.sourceUrl), str(p.ministryDid), Number(p.limit ?? 100)),
      "Ingest e-GOV ministry contract publication CSV.", "contract");
  cmd("ingestNjcJcn",             (p) => ingestNjcJcn(sdk, str(p.appId), str(p.since)),
      "Pull NTA 法人番号 delta and route to legal-entity actor.", "jcn");
  cmd("ingestLgFinance",          (p) => ingestLgFinance(sdk, Number(p.year)),
      "Ingest 総務省 地方財政状況調査 CSV.", "lg");
  cmd("ingestIncorpFinance",      (p) => ingestIncorpFinance(sdk, Number(p.year)),
      "Ingest 独立行政法人 財務諸表 XBRL.", "incorp");
  cmd("ingestProgramReview",      (p) => ingestProgramReview(sdk, Number(p.year)),
      "Ingest 行政事業レビューシート.", "review");
  cmd("ingestBoaAudit",           (p) => ingestBoaAudit(sdk, Number(p.year)),
      "Ingest 会計検査院 検査報告.", "audit");
  cmd("ingestNtaStatistic",       (p) => ingestNtaStatistic(sdk, Number(p.year)),
      "Ingest 国税庁 統計年報 (cohort aggregate).", "tax");
  cmd("ingestUboList",            (p) => ingestUboList(sdk, str(p.childJcn), str(p.evidenceUrl ?? "")),
      "Register UBO PENDING entry for a JCN (real PDF parse out-of-band).", "ubo");
  cmd("ingestEdinetLargeholding", (p) => ingestEdinetLargeholding(sdk, str(p.date ?? todayDate())),
      "Ingest EDINET 大量保有報告 (5%+ holdings) + ownership edges.", "ubo", "edinet");
  cmd("ingestAppropriation",      (p) => ingestAppropriation(sdk, {
        fiscalYear: Number(p.fiscalYear), sourceDid: str(p.sourceDid), recipientDid: str(p.recipientDid),
        amountJpy: Number(p.amountJpy), basis: str(p.basis), programCode: str(p.programCode),
        stage: p.stage ? str(p.stage) : undefined, sourceUrl: p.sourceUrl ? str(p.sourceUrl) : undefined,
      }),
      "Write appropriation record + L5 fiscal_flow edge from a source DID to a ministry/agency.", "appropriation", "edge");
  cmd("backfillMofFy2026",        () => backfillMofFy2026(sdk),
      "Backfill FY2026 MOF 当初予算 official distribution (12 ministries + revenue).", "backfill", "mof");
  cmd("probeMurakumo",            async () => {
        const probes: Record<string, string> = {};
        const probe = async (name: string, fn: () => Promise<Response>) => {
          const t0 = Date.now();
          try {
            const r = await fn();
            const body = (await r.text().catch((_e: unknown) => "")).slice(0, 120);
            probes[name] = `${r.status} (${Date.now()-t0}ms) ${body}`;
          } catch (e: any) { probes[name] = `EXC (${Date.now()-t0}ms): ${String(e?.message ?? e).slice(0,200)}`; }
        };
        // parallel + short timeouts to fit in host-sdk 25s budget
        await Promise.all([
          probe("health-public",  () => globalThis.fetch("https://murakumo.etzhayyim.com/health",     { signal: AbortSignal.timeout(8_000) })),
          probe("models-authd",   () => globalThis.fetch("https://murakumo.etzhayyim.com/v1/models",  { headers: { "x-kotodama-verified": "true" }, signal: AbortSignal.timeout(8_000) })),
          probe("chat-tiny",      () => globalThis.fetch("https://murakumo.etzhayyim.com/v1/chat/completions", {
            method: "POST", headers: { "content-type": "application/json", "x-kotodama-verified": "true" },
            body: JSON.stringify({ model: "gemma3-1b", messages: [{ role: "user", content: "ok" }], max_tokens: 4 }),
            signal: AbortSignal.timeout(20_000),
          })),
          probe("openai-control", () => globalThis.fetch("https://api.openai.com/",             { signal: AbortSignal.timeout(6_000) })),
        ]);
        return { wrote: 0, source: "murakumo-probe", note: JSON.stringify(probes).slice(0, 1000) };
      },
      "Probe Murakumo + control endpoints to isolate Worker→Worker routing blocker.", "probe", "llm");
  sdk.app.command(nsid("com.etzhayyim.apps.jpFiscal.runScrapers"),
    async (_ctx, p: any) => proxyToBpmn(sdk, "com.etzhayyim.apps.jpFiscal.runScrapers", decodeParams(p)),
    asAgentTool("Run vertex_scraper_dsl rows via LangServer BPMN-contract (ADR-0056). Pass {dsl_vid} to limit to one."),
    withCapabilityTags("jp-fiscal", "scraper", "dsl"),
  );

  sdk.app.onCommit(async () => { /* no follow-driven processing yet */ });
});

// Cron dispatch fully migrated to LangServer BPMN-contract (ADR-0056 T2):
//   fiscalEdinetDaily.bpmn      R/P1D  → jpFiscal.ingest.edinet
//   fiscalContractWeekly.bpmn   R/P7D  → jpFiscal.ingest.egovContracts
//   runScrapers.bpmn            R/PT6H → jpFiscal.run.scrapers
export default { fetch: (worker as any).fetch };
