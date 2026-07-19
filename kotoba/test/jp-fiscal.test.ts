import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
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
} from "../src/index.js";

const SRC = "https://www.mof.go.jp/example";

describe("jp-fiscal kotoba", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: "did:web:jp-fiscal.etzhayyim.com" });
  });

  describe("appropriations", () => {
    it("ingests (string JPY), reads, lists by year/ministry; validates", async () => {
      expect((await ingestAppropriation(e, { apprId: "A-1", fiscalYear: 2026, ministry: "MHLW", amountJpy: "33500000000000", cofogCode: "07", sourceUrl: SRC })).status).toBe("ingested");
      expect((await getAppropriation(e, { apprId: "A-1" })).appropriation?.amountJpy).toBe("33500000000000");
      expect((await ingestAppropriation(e, { apprId: "A-2", fiscalYear: 9999, ministry: "x", amountJpy: "1", sourceUrl: SRC })).status).toBe("rejected"); // year
      expect((await ingestAppropriation(e, { apprId: "A-3", fiscalYear: 2026, ministry: "x", amountJpy: "12.5", sourceUrl: SRC })).status).toBe("rejected"); // amount
      expect((await listAppropriations(e, { fiscalYear: 2026, ministry: "MHLW" })).total).toBe(1);
    });
  });

  describe("contracts + grants FK to appropriation", () => {
    beforeEach(async () => {
      await ingestAppropriation(e, { apprId: "A-1", fiscalYear: 2026, ministry: "MLIT", amountJpy: "5000000000000", sourceUrl: SRC });
    });
    it("ingests contract (corp number + FK→appr), rejects bad corp/missing appr", async () => {
      expect((await ingestContract(e, { contractId: "C-1", fiscalYear: 2026, agency: "MLIT", supplierName: "大林組", supplierCorporateNumber: "1234567890123", amountJpy: "8000000000", awardDate: "2026-04-01", apprId: "A-1", sourceUrl: SRC })).status).toBe("ingested");
      expect((await ingestContract(e, { contractId: "C-X", fiscalYear: 2026, agency: "x", supplierName: "y", supplierCorporateNumber: "123", amountJpy: "1", awardDate: "x", sourceUrl: SRC })).status).toBe("rejected"); // corp number
      expect((await ingestContract(e, { contractId: "C-Y", fiscalYear: 2026, agency: "x", supplierName: "y", amountJpy: "1", awardDate: "x", apprId: "GHOST", sourceUrl: SRC })).status).toBe("appropriationNotFound");
      expect((await listContracts(e, { fiscalYear: 2026, apprId: "A-1" })).total).toBe(1);
    });
    it("ingests subsidy grant (FK→appr)", async () => {
      expect((await ingestSubsidyGrant(e, { grantId: "G-1", fiscalYear: 2026, agency: "METI", recipientName: "○○協会", amountJpy: "300000000", apprId: "A-1", sourceUrl: SRC })).status).toBe("ingested");
      expect((await listSubsidyGrants(e, { agency: "METI" })).total).toBe(1);
    });
  });

  describe("audit findings + coverage", () => {
    it("ingests findings, filters, coverage rolls up", async () => {
      await ingestAppropriation(e, { apprId: "A-1", fiscalYear: 2026, ministry: "MOF", amountJpy: "1000000000", sourceUrl: SRC });
      await ingestContract(e, { contractId: "C-1", fiscalYear: 2026, agency: "MOF", supplierName: "X社", amountJpy: "5000000", awardDate: "2026-05-01", sourceUrl: SRC });
      expect((await ingestAuditFinding(e, { findingId: "F-1", fiscalYear: 2026, auditedAgency: "MOF", findingType: "improper", severity: "high", summary: "過大支払", subjectRef: "C-1", sourceUrl: SRC })).status).toBe("ingested");
      expect((await ingestAuditFinding(e, { findingId: "F-X", fiscalYear: 2026, auditedAgency: "x", findingType: "bogus" as any, summary: "y", sourceUrl: SRC })).status).toBe("rejected");
      expect((await listAuditFindings(e, { findingType: "improper", severity: "high" })).total).toBe(1);
      const cov = await coverage(e, { fiscalYear: 2026 });
      expect(cov.appropriationCount).toBe(1);
      expect(cov.contractCount).toBe(1);
      expect(cov.auditFindingCount).toBe(1);
      expect(cov.findingsByType?.improper).toBe(1);
    });
  });
});
