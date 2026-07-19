/**
 * jp-fiscal kotoba — barrel.
 *
 * Per ADR-2606011400 + ADR-0035. Japanese public government fiscal open-data
 * (money-flow core: appropriation → contract / subsidyGrant → auditFinding) on
 * the etzhayyim substrate (AT PDS records; no RW).
 *
 *   appropriation : ingestAppropriation / getAppropriation / listAppropriations
 *   contract      : ingestContract (FK→appropriation) / listContracts
 *   subsidyGrant  : ingestSubsidyGrant (FK→appropriation) / listSubsidyGrants
 *   auditFinding  : ingestAuditFinding / listAuditFindings
 *   coverage
 *
 * Public official-source fiscal data; amounts are decimal-string JPY.
 */

export * from "./types.js";
export {
  ingestAppropriation,
  getAppropriation,
  listAppropriations,
  ingestContract,
  listContracts,
  ingestSubsidyGrant,
  listSubsidyGrants,
  ingestAuditFinding,
  listAuditFindings,
  coverage,
} from "./registry.js";
