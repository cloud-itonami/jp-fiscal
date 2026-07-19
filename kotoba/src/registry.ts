/**
 * jp-fiscal kotoba — appropriation + contract + subsidyGrant + auditFinding
 * registries + coverage. AT PDS records (no RW). Contracts/grants optionally
 * FK-reference a funding appropriation. Public official-source fiscal data;
 * amounts are decimal-string JPY.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  APPROPRIATION_COLLECTION,
  AUDIT_COLLECTION,
  CONTRACT_COLLECTION,
  FINDING_TYPES,
  SEVERITIES,
  SUBSIDY_COLLECTION,
  apprDidFor,
  apprRkey,
  auditDidFor,
  auditRkey,
  contractDidFor,
  contractRkey,
  grantDidFor,
  grantRkey,
  isCorporateNumber,
  isFiscalYear,
  isUintString,
  type AppropriationRecord,
  type AppropriationView,
  type AuditFindingRecord,
  type AuditFindingView,
  type ContractRecord,
  type ContractView,
  type CoverageInput,
  type CoverageOutput,
  type GetAppropriationInput,
  type GetAppropriationOutput,
  type IngestAppropriationInput,
  type IngestAppropriationOutput,
  type IngestAuditFindingInput,
  type IngestAuditFindingOutput,
  type IngestContractInput,
  type IngestContractOutput,
  type IngestSubsidyGrantInput,
  type IngestSubsidyGrantOutput,
  type ListAppropriationsInput,
  type ListAppropriationsOutput,
  type ListAuditFindingsInput,
  type ListAuditFindingsOutput,
  type ListContractsInput,
  type ListContractsOutput,
  type ListSubsidyGrantsInput,
  type ListSubsidyGrantsOutput,
  type SubsidyGrantRecord,
  type SubsidyGrantView,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

async function exists(e: Etzhayyim, collection: string, rkey: string): Promise<boolean> {
  const resp = await e.read({ collection, rkey }).catch(() => ({ records: [] }));
  return Boolean(resp.records[0]?.value);
}

async function scanAll<T>(e: Etzhayyim, collection: string, maxScan: number, onRow: (v: T) => void): Promise<number> {
  let cursor: string | undefined;
  let scanned = 0;
  while (scanned < maxScan) {
    const page = await e.read<T>({ collection, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      if (scanned >= maxScan) break;
      onRow(r.value);
      scanned += 1;
    }
    if (scanned >= maxScan || !page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return scanned;
}

// ─── Appropriation ──────────────────────────────────────────────────

export async function ingestAppropriation(e: Etzhayyim, input: IngestAppropriationInput): Promise<IngestAppropriationOutput> {
  if (!input.apprId || !input.ministry || !input.sourceUrl) return { status: "rejected", error: "missingRequiredFields" };
  if (!isFiscalYear(input.fiscalYear)) return { status: "rejected", error: "invalidFiscalYear" };
  if (!isUintString(input.amountJpy)) return { status: "rejected", error: "invalidAmountJpy" };
  const rkey = apprRkey(input.apprId);
  const existing = await e.read<AppropriationRecord>({ collection: APPROPRIATION_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", apprUri: existing.records[0].uri, did: existing.records[0].value.did, apprId: input.apprId };
  }
  const did = apprDidFor(input.apprId);
  const record: AppropriationRecord = {
    did,
    apprId: input.apprId,
    fiscalYear: input.fiscalYear,
    ministry: input.ministry,
    cofogCode: input.cofogCode,
    amountJpy: input.amountJpy,
    purpose: input.purpose,
    sourceUrl: input.sourceUrl,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: APPROPRIATION_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "ingested", apprUri: receipt.uri, did, apprId: input.apprId };
}

export async function getAppropriation(e: Etzhayyim, input: GetAppropriationInput): Promise<GetAppropriationOutput> {
  if (!input.apprId) return { error: "invalidApprId" };
  const resp = await e.read<AppropriationRecord>({ collection: APPROPRIATION_COLLECTION, rkey: apprRkey(input.apprId) }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r) return { error: "notFound" };
  return { appropriation: { ...r.value, apprUri: r.uri } };
}

export async function listAppropriations(e: Etzhayyim, input: ListAppropriationsInput = {}): Promise<ListAppropriationsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<AppropriationRecord>({ collection: APPROPRIATION_COLLECTION, cursor: input.cursor, limit });
  const items: AppropriationView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.fiscalYear != null && v.fiscalYear !== input.fiscalYear) return false;
      if (input.ministry && v.ministry !== input.ministry) return false;
      if (input.cofogCode && v.cofogCode !== input.cofogCode) return false;
      return true;
    })
    .map((r) => ({ ...r.value, apprUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Contract ───────────────────────────────────────────────────────

export async function ingestContract(e: Etzhayyim, input: IngestContractInput): Promise<IngestContractOutput> {
  if (!input.contractId || !input.agency || !input.supplierName || !input.awardDate || !input.sourceUrl) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!isFiscalYear(input.fiscalYear)) return { status: "rejected", error: "invalidFiscalYear" };
  if (!isUintString(input.amountJpy)) return { status: "rejected", error: "invalidAmountJpy" };
  if (input.supplierCorporateNumber && !isCorporateNumber(input.supplierCorporateNumber)) {
    return { status: "rejected", error: "invalidCorporateNumber" };
  }
  if (input.apprId && !(await exists(e, APPROPRIATION_COLLECTION, apprRkey(input.apprId)))) {
    return { status: "appropriationNotFound", error: `appropriationNotFound:${input.apprId}` };
  }
  const rkey = contractRkey(input.contractId);
  const existing = await e.read<ContractRecord>({ collection: CONTRACT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", contractUri: existing.records[0].uri, did: existing.records[0].value.did, contractId: input.contractId };
  }
  const did = contractDidFor(input.contractId);
  const record: ContractRecord = {
    did,
    contractId: input.contractId,
    fiscalYear: input.fiscalYear,
    agency: input.agency,
    supplierName: input.supplierName,
    supplierCorporateNumber: input.supplierCorporateNumber,
    amountJpy: input.amountJpy,
    awardDate: input.awardDate,
    apprId: input.apprId,
    sourceUrl: input.sourceUrl,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: CONTRACT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "ingested", contractUri: receipt.uri, did, contractId: input.contractId };
}

export async function listContracts(e: Etzhayyim, input: ListContractsInput = {}): Promise<ListContractsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ContractRecord>({ collection: CONTRACT_COLLECTION, cursor: input.cursor, limit });
  const items: ContractView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.fiscalYear != null && v.fiscalYear !== input.fiscalYear) return false;
      if (input.agency && v.agency !== input.agency) return false;
      if (input.supplierCorporateNumber && v.supplierCorporateNumber !== input.supplierCorporateNumber) return false;
      if (input.apprId && v.apprId !== input.apprId) return false;
      return true;
    })
    .map((r) => ({ ...r.value, contractUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Subsidy grant ──────────────────────────────────────────────────

export async function ingestSubsidyGrant(e: Etzhayyim, input: IngestSubsidyGrantInput): Promise<IngestSubsidyGrantOutput> {
  if (!input.grantId || !input.agency || !input.recipientName || !input.sourceUrl) return { status: "rejected", error: "missingRequiredFields" };
  if (!isFiscalYear(input.fiscalYear)) return { status: "rejected", error: "invalidFiscalYear" };
  if (!isUintString(input.amountJpy)) return { status: "rejected", error: "invalidAmountJpy" };
  if (input.apprId && !(await exists(e, APPROPRIATION_COLLECTION, apprRkey(input.apprId)))) {
    return { status: "appropriationNotFound", error: `appropriationNotFound:${input.apprId}` };
  }
  const rkey = grantRkey(input.grantId);
  const existing = await e.read<SubsidyGrantRecord>({ collection: SUBSIDY_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", grantUri: existing.records[0].uri, did: existing.records[0].value.did, grantId: input.grantId };
  }
  const did = grantDidFor(input.grantId);
  const record: SubsidyGrantRecord = {
    did,
    grantId: input.grantId,
    fiscalYear: input.fiscalYear,
    agency: input.agency,
    recipientName: input.recipientName,
    amountJpy: input.amountJpy,
    purpose: input.purpose,
    apprId: input.apprId,
    sourceUrl: input.sourceUrl,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: SUBSIDY_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "ingested", grantUri: receipt.uri, did, grantId: input.grantId };
}

export async function listSubsidyGrants(e: Etzhayyim, input: ListSubsidyGrantsInput = {}): Promise<ListSubsidyGrantsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<SubsidyGrantRecord>({ collection: SUBSIDY_COLLECTION, cursor: input.cursor, limit });
  const items: SubsidyGrantView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.fiscalYear != null && v.fiscalYear !== input.fiscalYear) return false;
      if (input.agency && v.agency !== input.agency) return false;
      if (input.apprId && v.apprId !== input.apprId) return false;
      return true;
    })
    .map((r) => ({ ...r.value, grantUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Audit finding ──────────────────────────────────────────────────

export async function ingestAuditFinding(e: Etzhayyim, input: IngestAuditFindingInput): Promise<IngestAuditFindingOutput> {
  if (!input.findingId || !input.auditedAgency || !input.summary || !input.sourceUrl) return { status: "rejected", error: "missingRequiredFields" };
  if (!isFiscalYear(input.fiscalYear)) return { status: "rejected", error: "invalidFiscalYear" };
  if (!FINDING_TYPES.has(input.findingType)) return { status: "rejected", error: "invalidFindingType" };
  if (input.severity && !SEVERITIES.has(input.severity)) return { status: "rejected", error: "invalidSeverity" };
  const rkey = auditRkey(input.findingId);
  const existing = await e.read<AuditFindingRecord>({ collection: AUDIT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", auditUri: existing.records[0].uri, did: existing.records[0].value.did, findingId: input.findingId };
  }
  const did = auditDidFor(input.findingId);
  const record: AuditFindingRecord = {
    did,
    findingId: input.findingId,
    fiscalYear: input.fiscalYear,
    auditedAgency: input.auditedAgency,
    findingType: input.findingType,
    severity: input.severity,
    summary: input.summary,
    subjectRef: input.subjectRef,
    sourceUrl: input.sourceUrl,
    createdAt: new Date().toISOString(),
  };
  const receipt = await e.write({ collection: AUDIT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "ingested", auditUri: receipt.uri, did, findingId: input.findingId };
}

export async function listAuditFindings(e: Etzhayyim, input: ListAuditFindingsInput = {}): Promise<ListAuditFindingsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<AuditFindingRecord>({ collection: AUDIT_COLLECTION, cursor: input.cursor, limit });
  const items: AuditFindingView[] = resp.records
    .filter((r) => {
      const v = r.value;
      if (input.fiscalYear != null && v.fiscalYear !== input.fiscalYear) return false;
      if (input.auditedAgency && v.auditedAgency !== input.auditedAgency) return false;
      if (input.findingType && v.findingType !== input.findingType) return false;
      if (input.severity && v.severity !== input.severity) return false;
      return true;
    })
    .map((r) => ({ ...r.value, auditUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Coverage ───────────────────────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const yr = input.fiscalYear;
  const match = (fy: number) => yr == null || fy === yr;
  const appropriationCount = await scanAll<AppropriationRecord>(e, APPROPRIATION_COLLECTION, maxScan, () => {});
  const contractCount = await scanAll<ContractRecord>(e, CONTRACT_COLLECTION, maxScan, () => {});
  const subsidyGrantCount = await scanAll<SubsidyGrantRecord>(e, SUBSIDY_COLLECTION, maxScan, () => {});
  const findingsByType: Record<string, number> = {};
  let auditFindingCount = 0;
  await scanAll<AuditFindingRecord>(e, AUDIT_COLLECTION, maxScan, (v) => {
    if (!match(v.fiscalYear)) return;
    auditFindingCount += 1;
    findingsByType[v.findingType] = (findingsByType[v.findingType] ?? 0) + 1;
  });
  return {
    appropriationCount,
    contractCount,
    subsidyGrantCount,
    auditFindingCount,
    findingsByType,
    truncated: appropriationCount >= maxScan || contractCount >= maxScan || subsidyGrantCount >= maxScan,
  };
}
