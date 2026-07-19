# etzhayyim-project-jp-fiscal

Japanese government fiscal data ingest actor (ADR-0035).

## Architecture

```
External public sources (e-GOV / MOF / 総務省 / 会計検査院 / NTA / EDINET / 法務局)
    │
    │ HTTPS fetch (robots.txt + 1.5s rate limit, kotodama:net/fetch)
    ▼
etzhayyim-wasm-jpfiscal-jpf15c4l  (TS Native, single Worker)
    ├─ cron */15 * * * *  → scheduler routes per source
    ├─ XRPC commands (com.etzhayyim.apps.jpFiscal.ingest{Budget,Contract,...})
    ├─ Design E Tier 2 write → ComAtprotoRepoCreateRecord (jpFiscal lexicons)
    └─ Design E Tier 1 social = `gov` actor `derive` rule (NOT this app)
```

## Component

| Component | Folder | Role |
|---|---|---|
| jpfiscal-ingest | `appview/etzhayyim-wasm-jpfiscal-jpf15c4l/` | 10-source ingest + dispatch |

## 10 Source Adapters (1 file = 1 command)

All implemented inline in `src/app.ts` per single-file principle.

| Adapter NSID | Source | Cron | Output collection |
|---|---|---|---|
| `com.etzhayyim.apps.jpFiscal.ingestBudgetBook`         | MOF 予算書/決算書                     | monthly  | `jpFiscal.budgetBook` |
| `com.etzhayyim.apps.jpFiscal.ingestEgovContract`       | 各省庁 契約公表 CSV                  | weekly   | `jpFiscal.contract` |
| `com.etzhayyim.apps.jpFiscal.ingestNjcJcn`             | NTA 法人番号 delta API               | weekly   | (legal-entity actor delegate) |
| `com.etzhayyim.apps.jpFiscal.ingestLgFinance`          | 総務省 地方財政状況調査               | annual   | `jpFiscal.lgFinance` |
| `com.etzhayyim.apps.jpFiscal.ingestIncorpFinance`      | 独法財務諸表 XBRL                    | annual   | `jpFiscal.incorpFinance` |
| `com.etzhayyim.apps.jpFiscal.ingestProgramReview`      | 行政事業レビューシート                | annual   | `jpFiscal.programReview` |
| `com.etzhayyim.apps.jpFiscal.ingestBoaAudit`           | 会計検査院 検査報告                  | annual   | `jpFiscal.auditFinding` |
| `com.etzhayyim.apps.jpFiscal.ingestNtaStatistic`       | 国税庁 統計年報                      | annual   | `jpFiscal.taxPayment` (cohort) |
| `com.etzhayyim.apps.jpFiscal.ingestUboList`            | 法務局 実質的支配者リスト             | on-request | `jpFiscal.beneficialOwner` |
| `com.etzhayyim.apps.jpFiscal.ingestEdinetLargeholding` | EDINET v2 大量保有報告               | daily    | `jpFiscal.beneficialOwner` |

## Non-responsibilities

- 入札公告 (`procurementBid`) は **`nyusatsu` actor** が owner
- legal entity (JCN) registry は **`legal-entity` actor** が owner
- 個別契約相手 KYC は **`yabai` / `legal-entity` actor** が owner
- social post auto-derive は **`gov` actor manifest derive rule** が担当 (この actor は domain write のみ)

## Design E compliance

- Handler は `sdk.pds.dispatch({ type: "com.atproto.repo.createRecord", ...})` のみ
- `app.bsky.feed.post` を直接呼ばない (`gov` の derive rule に委譲)
- PII Tier 3 cohort は ADR-0026 cohort DID で集約 (個人 DID 発行禁止)

## Build & Deploy

```bash
cd 60-apps/etzhayyim-project-jp-fiscal/appview/etzhayyim-wasm-jpfiscal-jpf15c4l
etzhayyim deploy --smoke-url https://jpf15c4l.etzhayyim.com/health
```

## Related

- ADR-0035 `90-docs/adr/0035-jp-tax-money-flow-reverse-topology.md`
- 14 lexicon `00-contracts/lexicons/com/etzhayyim/apps/jpFiscal/`
- 3 graph tables `30-graph/graph-schema/migrations/20260419112804_jp_fiscal_flow_tables.ts`
- gov actor `20-actors/gov/actor-manifest.jsonld` (derive rules + L0..L7 path DIDs)
- nyusatsu actor `orgs/etzhayyim/com-etzhayyim-nyusatsu/actor-manifest.jsonld` (procurement bid aggregator)
