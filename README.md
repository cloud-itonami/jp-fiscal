# jp-fiscal

**日本政府の公開財政データ（予算・契約・補助金・会計検査）を公的一次情報源から取り込み、
「予算 → 契約/補助金 → 検査指摘」という資金の流れとして記録する ingest actor。**

PII も決済も扱わない。扱うのは各府省・会計検査院・国税庁・EDINET・法務局が
既に公開しているデータだけで、この repo がやるのは *取得と正規化* であって
資金の移動ではない。

`etzhayyim/root` の `60-apps/etzhayyim-project-jp-fiscal` から抽出された
（`migration.edn` に抽出元 revision と tree hash）。

---

## この repo には実装が 2 つ入っている

同じ主題に対する実装が 2 つあり、**コレクション語彙が違う**。片方をもう片方の
最新版だと思って読むと間違える。

| | `kotoba/` | `appview/etzhayyim-wasm-jpfiscal-jpf15c4l/` |
|---|---|---|
| 何 | reference implementation（TS パッケージ） | Cloudflare Worker（frontend: cljs + reagent + re-frame + jp-go-dds、backend: TS ingest actor） |
| 収録範囲 | 資金フローの中核 4 コレクション | 10 source adapter |
| コレクション | `jpFiscal.appropriation` / `.contract` / `.subsidyGrant` / `.auditFinding` | `jpFiscal.budgetBook` / `.contract` / `.beneficialOwner` ほか |
| テスト | あり（4 件、`vitest`） | frontend: あり（`cljs/test/`, shadow-cljs `:node-test`） / backend: なし |
| 手元で動くか | **動く**（下記 quickstart） | frontend build/test は動く（下記）。`wrangler dev`/デプロイは未確認 |
| デプロイ | しない（ライブラリ） | **現在ライブではない**（下記） |

`kotoba/` の型定義が自ら書いているとおり、`kotoba/` は appview の
13 コレクションのうち中核だけを取ったサブセットであり、appview を置き換えたもの
ではない。

## 現在地

**動くと確認したもの**

- `kotoba/` の test 4 件が通る / `tsc --noEmit` が通る（2026-08-14 実測、手順は
  [`docs/operator-quickstart.md`](docs/operator-quickstart.md)）
- **appview の frontend**（2026-08-26 実測、ADR-2608260900）:
  `appview/etzhayyim-wasm-jpfiscal-jpf15c4l/cljs/` を
  `amu compile --target wasm32-browser app`（0 warnings）/ `amu compile --target wasm32-browser test` +
  `node out/tests.js`（5 tests, 14 assertions, 0 failures）で確認済み。
  SvelteKit（`svelte/`）を置き換えた reagent + re-frame + jp-go-dds の
  static ページ。**Worker としての `wrangler dev`/`wrangler deploy` は
  未検証のまま**（下記 appview/.../wrangler.jsonc のヘッダコメント参照）。

**動かない・まだ無いもの**

- **appview はデプロイされていない。** `wrangler.jsonc` が主張する
  `jpf15c4l.etzhayyim.com` と `jp-fiscal.etzhayyim.com` は
  **どちらも DNS が解決しない**（最終デプロイ記録は `APP_DEPLOY_AT`
  2026-05-07。2026-08-26 の frontend 移行でも変わっていない）。
- **appview の XRPC BFF は現在デプロイ経路に無い。** SvelteKit の
  server-side route（旧 `svelte/src/routes/xrpc/[...path]/+server.ts`）が
  実際にデプロイされていた XRPC ハンドラだったが、`wrangler.jsonc` から
  `main` を削除したため、この Worker は現在 assets-only。ハンドラ本体は
  `appview/etzhayyim-wasm-jpfiscal-jpf15c4l/src/xrpc-mcp-router-proxy.ts`
  に無傷で移設済み（未配線、復活させるかは product decision）。
- **10 adapter のうち実際に書き込むのは 4 つだけ。** 残りは戻り値に
  `note: "...impl pending"` を持つ明示的なスタブで、fetch はするが
  `wrote: 0` を返す。

| adapter | 状態 |
|---|---|
| `ingestBudgetBook` | 書く（ただし `totalJpy: 0` 固定。金額はまだ解析していない） |
| `ingestEgovContract` | 書く（CSV を実際に解析） |
| `ingestUboList` / `ingestEdinetLargeholding` | 書く |
| `ingestNjcJcn` | 設計上 `wrote: 0`（法人番号は `legal-entity` actor が所有） |
| `ingestLgFinance` / `ingestIncorpFinance` / `ingestProgramReview` / `ingestBoaAudit` / `ingestNtaStatistic` | **スタブ**（`impl pending`） |

- **XRPC コマンドは 1 本だけ。** `com.etzhayyim.apps.jpFiscal.runScrapers` が
  BPMN contract へ proxy する。adapter ごとの NSID は**存在しない** ——
  cron と dispatch は ADR-0056 で LangServer BPMN 側へ移っている
  （`fiscalEdinetDaily` / `fiscalContractWeekly` / `runScrapers`）。
  この Worker に `scheduled` ハンドラは無い。

## この repo が所有しないもの

- 入札公告 → `nyusatsu` actor
- 法人番号（JCN）レジストリ → `legal-entity` actor
- 契約相手の KYC → `yabai` / `legal-entity` actor
- ソーシャル投稿の自動生成 → `gov` actor の derive rule
  （この actor は domain write のみを行い、`app.bsky.feed.post` を直接呼ばない）

## 金額は文字列

AT Lexicon に float は無く、国の予算は 2^53 を超える。したがって金額は
**JPY の 10 進文字列**として持ち、`fiscalYear` だけが整数。
`isUintString` を通らない値（`"12.5"` など）は `rejected` になる。

## ライセンス

Apache License 2.0 + etzhayyim Charter Compliance Rider v3.1（`NOTICE` 参照）。
