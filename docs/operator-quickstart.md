# operator quickstart

**この手順は 2026-08-14 に上から下まで実際に実行して確かめたもの。**
確かめていない手順（appview のローカル実行・デプロイ）は「未確認」として
最後に分けてある —— 踏めない手順をここに書かない。

対象は `kotoba/`（reference implementation）。所要 3 分程度。

## 前提

- Node（実測 26.3.0）と npm（実測 11.16.0）
- GitHub への HTTPS 到達（依存 2 本が git 依存のため。下記）

## 1. 取得

```bash
git clone git@github.com:cloud-itonami/jp-fiscal.git
cd jp-fiscal/kotoba
```

west 管理下の checkout を直接使う場合は、共有 checkout を編集せず
worktree を切ること（superproject の CLAUDE.md「並行エージェント運用」）。
**この repo の remote 名は `origin` ではなく `cloud-itonami`**（west が
org 名で remote を作る）ので、`git fetch origin` は
`does not appear to be a git repository` で落ちる。

## 2. 依存の取得

```bash
npm install       # 実測 135 packages / 1〜2 分（npm cache の温度による）
```

依存 2 本は npm registry ではなく **git 依存**で、`package.json` は
`github.com/etzhayyim/com-etzhayyim-sdk[-mock]` を指している。
この 2 repo は **`kotoba-lang/sdk` と `kotoba-lang/sdk-mock` に移っている**が、
GitHub のリダイレクトが生きているので URL はそのままで解決する（実測）。
リダイレクトに依存したくないなら west の checkout
（`orgs/kotoba-lang/sdk`、`orgs/kotoba-lang/sdk-mock`）を見ればよい。

### ⚠ このマシン固有の罠 —— `~/.npmrc` の `allow-scripts[]` で install が落ちる

`~/.npmrc` に `allow-scripts[]=...` が 1 行でもあると、**npm 11.16 は
git 依存の prepare 中に走る入れ子の install でそれを拒否する**:

```
npm error code EALLOWSCRIPTS
npm error --allow-scripts is not allowed in project-scoped installs.
```

**これは repo の欠陥ではない。**両方向で確かめてある（2026-08-14、npm 11.16.0）:

| user config | 結果 |
|---|---|
| `allow-scripts[]=@anthropic-ai/claude-code` のみ | `EALLOWSCRIPTS` で失敗 |
| 空 | `added 135 packages` で成功 |

回避するなら、その install の間だけ user config を外す:

```bash
mkdir -p /tmp/jpf-home && HOME=/tmp/jpf-home npm install
```

`--ignore-scripts` では直らない（入れ子の install が user config を
読む時点で落ちるため）。この状態で入る依存は git 依存の `prepare: tsc` が
未実行だが、**test も typecheck も通る** —— `sdk-mock` の `main` が
`src/index.ts` で、`registry.ts` が `@etzhayyim/sdk` を
`import type` でしか使わない（実行時に消える）ため。

## 3. テスト

```bash
npm test          # vitest run
```

実測（2026-08-14）:

```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

4 件が覆うのは、歳出予算の登録と年度/金額のバリデーション、契約と補助金の
appropriation への FK（存在しない `apprId` は `appropriationNotFound`）、
法人番号 13 桁の検査、検査指摘の種別/深刻度フィルタ、そして coverage の集計。

## 4. 型検査

```bash
npm run typecheck # tsc --noEmit
```

実測: exit 0（出力なし）。

## 変更を入れたら

`npm test` と `npm run typecheck` の両方を通してから push する。
**変更前にも一度走らせて、失敗集合を比べること** —— 元から赤い状態と
自分が割った状態を区別できなくなる。

---

## まだ確認していないこと（正直に）

- **appview のローカル実行**（`appview/etzhayyim-wasm-jpfiscal-jpf15c4l/`）。
  SvelteKit + Cloudflare Worker だが、ローカル起動手順は未検証。
- **デプロイ。** `CLAUDE.md` は
  `cd 60-apps/etzhayyim-project-jp-fiscal/appview/... && etzhayyim deploy` と
  書いているが、**この手順は今は踏めない**:
  - `60-apps/` は**この repo に存在しない**（抽出でこの repo のルートに
    上がったため。抽出元のパスがそのまま残っている）
  - `etzhayyim` CLI は入っていない（`which etzhayyim` → not found）
  - デプロイ先 `jpf15c4l.etzhayyim.com` / `jp-fiscal.etzhayyim.com` は
    **どちらも DNS が解決しない**

  デプロイ経路を復旧する人は、まずこの 3 点のどれが意図された現在地なのかを
  決めるところから始まる。
