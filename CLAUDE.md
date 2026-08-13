# jp-fiscal

Japanese government fiscal data ingest actor (ADR-0035).
入口は [`README.md`](README.md)、手順は [`docs/operator-quickstart.md`](docs/operator-quickstart.md)。

**この repo には実装が 2 つある。** `kotoba/`（reference implementation、
テストが通る）と `appview/`（Worker、現在デプロイされていない）。
コレクション語彙が違うので README の対比表を先に読むこと。

## Architecture

```
External public sources (e-GOV / MOF / 総務省 / 会計検査院 / NTA / EDINET / 法務局)
    │
    │ HTTPS fetch (robots.txt + 1.5s rate limit, kotodama:net/fetch)
    ▼
etzhayyim-wasm-jpfiscal-jpf15c4l  (TS Native, single Worker)
    ├─ XRPC command `com.etzhayyim.apps.jpFiscal.runScrapers` → BPMN contract へ proxy
    ├─ cron は **この Worker に無い** — ADR-0056 で LangServer BPMN 側へ移設
    ├─ Design E Tier 2 write → ComAtprotoRepoCreateRecord (jpFiscal lexicons)
    └─ Design E Tier 1 social = `gov` actor `derive` rule (NOT this app)
```

## Component

| Component | Folder | Role |
|---|---|---|
| jp-fiscal kotoba | `kotoba/` | reference impl（appropriation → contract/subsidyGrant → auditFinding）+ vitest |
| jpfiscal-ingest | `appview/etzhayyim-wasm-jpfiscal-jpf15c4l/` | 10-source ingest + dispatch |

## 10 Source Adapters

`src/app.ts` に inline 実装（single-file principle）。

⚠ **adapter ごとの XRPC NSID は存在しない。** 登録されているコマンドは
`com.etzhayyim.apps.jpFiscal.runScrapers` の 1 本だけで、adapter は
その内部の関数。cron 列も同様に、この Worker ではなく BPMN 定義
（`fiscalEdinetDaily` R/P1D・`fiscalContractWeekly` R/P7D・
`runScrapers` R/PT6H）が持つ。

⚠ **10 本のうち 5 本は明示的なスタブ**で、fetch はするが `wrote: 0` と
`note: "...impl pending"` を返す。

| Adapter 関数 | Source | 状態 | Output collection |
|---|---|---|---|
| `ingestBudgetBook`         | MOF 予算書/決算書        | 書く（`totalJpy: 0` 固定 — 金額未解析） | `jpFiscal.budgetBook` |
| `ingestEgovContract`       | 各省庁 契約公表 CSV      | 書く（CSV を実解析）                | `jpFiscal.contract` |
| `ingestNjcJcn`             | NTA 法人番号 delta API   | 設計上 `wrote: 0`（委譲）           | (legal-entity actor delegate) |
| `ingestLgFinance`          | 総務省 地方財政状況調査   | **スタブ** `scrape impl pending`    | `jpFiscal.lgFinance` |
| `ingestIncorpFinance`      | 独法財務諸表 XBRL        | **スタブ** `XBRL parse impl pending` | `jpFiscal.incorpFinance` |
| `ingestProgramReview`      | 行政事業レビューシート    | **スタブ** `review-sheet JSON parse impl pending` | `jpFiscal.programReview` |
| `ingestBoaAudit`           | 会計検査院 検査報告      | **スタブ** `paragraphRef extract impl pending` | `jpFiscal.auditFinding` |
| `ingestNtaStatistic`       | 国税庁 統計年報          | **スタブ** `per-tax-code aggregate parse impl pending` | `jpFiscal.taxPayment` (cohort) |
| `ingestUboList`            | 法務局 実質的支配者リスト | 書く                               | `jpFiscal.beneficialOwner` |
| `ingestEdinetLargeholding` | EDINET v2 大量保有報告   | 書く                               | `jpFiscal.beneficialOwner` |

## Non-responsibilities

- 入札公告 (`procurementBid`) は **`nyusatsu` actor** が owner
- legal entity (JCN) registry は **`legal-entity` actor** が owner
- 個別契約相手 KYC は **`yabai` / `legal-entity` actor** が owner
- social post auto-derive は **`gov` actor manifest derive rule** が担当 (この actor は domain write のみ)

## Design E compliance

- Handler は `sdk.pds.dispatch({ type: "com.atproto.repo.createRecord", ...})` のみ
- `app.bsky.feed.post` を直接呼ばない (`gov` の derive rule に委譲)
- PII Tier 3 cohort は ADR-0026 cohort DID で集約 (個人 DID 発行禁止)

## Build & Test

`kotoba/` は手元で動く（実測 2026-08-14: test 4 件 pass、`tsc --noEmit` clean）。
手順と、このマシン固有の `~/.npmrc` の罠は
[`docs/operator-quickstart.md`](docs/operator-quickstart.md)。

```bash
cd kotoba && npm install && npm test && npm run typecheck
```

## Deploy — 現在この手順は踏めない

以前ここには次の 2 行が書かれていたが、**3 点とも今は成立しない**
（実測 2026-08-14）:

```bash
cd 60-apps/etzhayyim-project-jp-fiscal/appview/etzhayyim-wasm-jpfiscal-jpf15c4l
etzhayyim deploy --smoke-url https://jpf15c4l.etzhayyim.com/health
```

- `60-apps/` は**この repo に無い** — 抽出でこの repo のルートに上がった
  （`migration.edn` が抽出元のパスを持つ）。正しい相対パスは
  `appview/etzhayyim-wasm-jpfiscal-jpf15c4l`
- `etzhayyim` CLI は入っていない（`which etzhayyim` → not found）
- smoke URL の `jpf15c4l.etzhayyim.com` は **DNS が解決しない**
  （`jp-fiscal.etzhayyim.com` も同様。最終デプロイ記録は `APP_DEPLOY_AT`
  2026-05-07）

デプロイ経路を復旧する人は、この 3 点のどれが意図された現在地なのかを
決めるところから始まる。

## Related

⚠ 以下のパスは**抽出元 `etzhayyim/root` のもの**で、この repo には無い
（`migration.edn` の `:source` を参照）。

- ADR-0035 `90-docs/adr/0035-jp-tax-money-flow-reverse-topology.md`
- ADR-0056（cron/dispatch を LangServer BPMN contract へ移設）
- 14 lexicon `00-contracts/lexicons/com/etzhayyim/apps/jpFiscal/`
- 3 graph tables `30-graph/graph-schema/migrations/20260419112804_jp_fiscal_flow_tables.ts`
- gov actor `20-actors/gov/actor-manifest.jsonld` (derive rules + L0..L7 path DIDs)
- nyusatsu actor `orgs/etzhayyim/com-etzhayyim-nyusatsu/actor-manifest.jsonld` (procurement bid aggregator)
