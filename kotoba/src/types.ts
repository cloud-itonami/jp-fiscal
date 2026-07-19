/**
 * jp-fiscal kotoba — Japanese public government fiscal open-data record types.
 *
 * Per ADR-2606011400 + ADR-0035 (reverse-topology money-flow). jp-fiscal ingests
 * PUBLIC fiscal data from official sources (e-GOV / MOF / 会計検査院 / NTA /
 * EDINET / 法務局). This package models the core money-flow chain:
 *   appropriation → contract / subsidyGrant → auditFinding
 * (the source app has 13 collections; the rest follow the same public-fiscal
 * pattern.) Registry on AT PDS records (replaces RW). ADR-2605172000 kotoba.
 *
 * AXIS NOTE (ADR-2605172400): axis-clean public open-data — official-source
 * government fiscal + public corporate-registry data, no personal PII, no
 * settlement (data ingest, not money movement), no fulfillment liability.
 *
 * AT-Lexicon: no float. Amounts are decimal STRINGS in JPY (national budgets
 * exceed 2^53). fiscalYear is an integer.
 *
 * Identity hierarchy:
 *   did:web:jp-fiscal.etzhayyim.com                          — controller
 *   did:web:jp-fiscal.etzhayyim.com:appr:{apprId}            — an appropriation
 *   did:web:jp-fiscal.etzhayyim.com:contract:{contractId}    — a contract
 *   did:web:jp-fiscal.etzhayyim.com:grant:{grantId}          — a subsidy grant
 *   did:web:jp-fiscal.etzhayyim.com:audit:{findingId}        — an audit finding
 */

export const JPF_DID_PREFIX = "did:web:jp-fiscal.etzhayyim.com:" as const;

export const APPROPRIATION_COLLECTION = "com.etzhayyim.apps.jpFiscal.appropriation";
export const CONTRACT_COLLECTION = "com.etzhayyim.apps.jpFiscal.contract";
export const SUBSIDY_COLLECTION = "com.etzhayyim.apps.jpFiscal.subsidyGrant";
export const AUDIT_COLLECTION = "com.etzhayyim.apps.jpFiscal.auditFinding";

// ─── Appropriation (budget line) ────────────────────────────────────

export interface AppropriationRecord {
  did: string;
  apprId: string;
  fiscalYear: number;
  ministry: string;
  /** COFOG function code, optional. */
  cofogCode?: string;
  /** Appropriated amount, JPY (decimal string). */
  amountJpy: string;
  purpose?: string;
  sourceUrl: string;
  createdAt: string;
}
export interface AppropriationView extends AppropriationRecord {
  apprUri: string;
}
export interface IngestAppropriationInput {
  apprId: string;
  fiscalYear: number;
  ministry: string;
  amountJpy: string;
  sourceUrl: string;
  cofogCode?: string;
  purpose?: string;
}
export interface IngestAppropriationOutput {
  status: "ingested" | "alreadyExists" | "rejected";
  apprUri?: string;
  did?: string;
  apprId?: string;
  error?: string;
}
export interface GetAppropriationInput {
  apprId: string;
}
export interface GetAppropriationOutput {
  appropriation?: AppropriationView;
  error?: string;
}
export interface ListAppropriationsInput {
  fiscalYear?: number;
  ministry?: string;
  cofogCode?: string;
  limit?: number;
  cursor?: string;
}
export interface ListAppropriationsOutput {
  items: AppropriationView[];
  cursor?: string;
  total: number;
}

// ─── Contract ───────────────────────────────────────────────────────

export interface ContractRecord {
  did: string;
  contractId: string;
  fiscalYear: number;
  agency: string;
  supplierName: string;
  /** 法人番号 (13-digit corporate number), optional. */
  supplierCorporateNumber?: string;
  amountJpy: string;
  awardDate: string;
  /** FK → funding appropriation (optional). */
  apprId?: string;
  sourceUrl: string;
  createdAt: string;
}
export interface ContractView extends ContractRecord {
  contractUri: string;
}
export interface IngestContractInput {
  contractId: string;
  fiscalYear: number;
  agency: string;
  supplierName: string;
  amountJpy: string;
  awardDate: string;
  sourceUrl: string;
  supplierCorporateNumber?: string;
  apprId?: string;
}
export interface IngestContractOutput {
  status: "ingested" | "alreadyExists" | "rejected" | "appropriationNotFound";
  contractUri?: string;
  did?: string;
  contractId?: string;
  error?: string;
}
export interface ListContractsInput {
  fiscalYear?: number;
  agency?: string;
  supplierCorporateNumber?: string;
  apprId?: string;
  limit?: number;
  cursor?: string;
}
export interface ListContractsOutput {
  items: ContractView[];
  cursor?: string;
  total: number;
}

// ─── Subsidy grant ──────────────────────────────────────────────────

export interface SubsidyGrantRecord {
  did: string;
  grantId: string;
  fiscalYear: number;
  agency: string;
  recipientName: string;
  amountJpy: string;
  purpose?: string;
  apprId?: string;
  sourceUrl: string;
  createdAt: string;
}
export interface SubsidyGrantView extends SubsidyGrantRecord {
  grantUri: string;
}
export interface IngestSubsidyGrantInput {
  grantId: string;
  fiscalYear: number;
  agency: string;
  recipientName: string;
  amountJpy: string;
  sourceUrl: string;
  purpose?: string;
  apprId?: string;
}
export interface IngestSubsidyGrantOutput {
  status: "ingested" | "alreadyExists" | "rejected" | "appropriationNotFound";
  grantUri?: string;
  did?: string;
  grantId?: string;
  error?: string;
}
export interface ListSubsidyGrantsInput {
  fiscalYear?: number;
  agency?: string;
  apprId?: string;
  limit?: number;
  cursor?: string;
}
export interface ListSubsidyGrantsOutput {
  items: SubsidyGrantView[];
  cursor?: string;
  total: number;
}

// ─── Audit finding (会計検査院) ─────────────────────────────────────

export type FindingType = "improper" | "wasteful" | "nonCompliant" | "recommendation" | "other";
export type Severity = "low" | "medium" | "high";

export interface AuditFindingRecord {
  did: string;
  findingId: string;
  fiscalYear: number;
  auditedAgency: string;
  findingType: FindingType;
  severity?: Severity;
  summary: string;
  /** Subject reference (contract/grant id), optional. */
  subjectRef?: string;
  sourceUrl: string;
  createdAt: string;
}
export interface AuditFindingView extends AuditFindingRecord {
  auditUri: string;
}
export interface IngestAuditFindingInput {
  findingId: string;
  fiscalYear: number;
  auditedAgency: string;
  findingType: FindingType;
  summary: string;
  sourceUrl: string;
  severity?: Severity;
  subjectRef?: string;
}
export interface IngestAuditFindingOutput {
  status: "ingested" | "alreadyExists" | "rejected";
  auditUri?: string;
  did?: string;
  findingId?: string;
  error?: string;
}
export interface ListAuditFindingsInput {
  fiscalYear?: number;
  auditedAgency?: string;
  findingType?: FindingType;
  severity?: Severity;
  limit?: number;
  cursor?: string;
}
export interface ListAuditFindingsOutput {
  items: AuditFindingView[];
  cursor?: string;
  total: number;
}

// ─── Coverage ───────────────────────────────────────────────────────

export interface CoverageInput {
  fiscalYear?: number;
  maxScan?: number;
}
export interface CoverageOutput {
  appropriationCount?: number;
  contractCount?: number;
  subsidyGrantCount?: number;
  auditFindingCount?: number;
  findingsByType?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export const FINDING_TYPES: ReadonlySet<string> = new Set(["improper", "wasteful", "nonCompliant", "recommendation", "other"]);
export const SEVERITIES: ReadonlySet<string> = new Set(["low", "medium", "high"]);

export function isUintString(s: string): boolean {
  return /^\d+$/.test(s);
}
export function isFiscalYear(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1868 && n <= 2200;
}
export function isCorporateNumber(s: string): boolean {
  return /^\d{13}$/.test(s);
}

export function apprDidFor(id: string): string {
  return `${JPF_DID_PREFIX}appr:${id.toLowerCase()}`;
}
export function apprRkey(id: string): string {
  return `appr-${id.toLowerCase()}`;
}
export function contractDidFor(id: string): string {
  return `${JPF_DID_PREFIX}contract:${id.toLowerCase()}`;
}
export function contractRkey(id: string): string {
  return `contract-${id.toLowerCase()}`;
}
export function grantDidFor(id: string): string {
  return `${JPF_DID_PREFIX}grant:${id.toLowerCase()}`;
}
export function grantRkey(id: string): string {
  return `grant-${id.toLowerCase()}`;
}
export function auditDidFor(id: string): string {
  return `${JPF_DID_PREFIX}audit:${id.toLowerCase()}`;
}
export function auditRkey(id: string): string {
  return `audit-${id.toLowerCase()}`;
}
