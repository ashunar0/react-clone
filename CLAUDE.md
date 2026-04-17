# react-clone — Reactをゼロから再実装する学習プロジェクト

## プロジェクトの目的

Reactの原理を理解するために、最小限のReact互換ライブラリを自作する。動くものを作るのが目的ではなく、**内部で何が起きているかを手で触って理解する**のが目的。

## 進め方

- **コーチモードで少しずつ進める**（デフォルト）。一度に多くを実装しない。ユーザー（あさひ）に考えさせ、質問に答えさせながら進む
- 型よりロジック優先。型はセーフティネットとして最低限で良い
- 各ステップが終わったら `docs/` 配下に学習ノートを残す
- コミットは `feat:` / `chore:` などの Conventional Commits、日本語で書く

## 構成

```
apps/website            — createElement を呼んで動作確認する場所
packages/myreact        — 自作Reactライブラリ本体（src/index.ts を直接 export、ビルドなし）
packages/utils          — 元のスターターに付いてきたサンプル。触らない
docs/NN-*.md            — ステップごとの学習ノート
```

`apps/website` → `myreact` の依存は `"myreact": "workspace:*"` で張っている。コード編集は即反映される。

## 進捗

`docs/` の番号付きファイルが学習の記録。次に読むときはここを見れば現在地がわかる。

- [01-createElement-and-vdom.md](./docs/01-createElement-and-vdom.md) — ✅ createElement と仮想DOM（完了）
- [02-render.md](./docs/02-render.md) — ✅ render で VDOM を実DOMに変換、`#root` に描画（完了）
- [03-props.md](./docs/03-props.md) — ✅ props を実DOMに反映（className / id / onClick）（完了）
- [04-jsx.md](./docs/04-jsx.md) — ✅ JSX を有効化（automatic runtime + myreact/jsx-runtime）（完了）
- [05-function-component.md](./docs/05-function-component.md) — ✅ 関数コンポーネント対応、App.tsx / main.tsx 分離（完了）

## 次のステップ候補

- **E. state と再描画**: `useState` 的なものを作る。差分更新（reconciliation）が必要になる
- **F. Fragment 対応**: `<>...</>` を使えるようにする。`render` が Symbol 型の `type` を判別できるようにするだけ

次回開始時にあさひに E / F のどれに進むか確認すること（E が本命、F は軽い寄り道）。

## 既知の落とし穴

- **pre-commit フック**: `vp check --fix` が lint-staged 経由で実行されると、Vite+側の問題で `vite.config.ts` 読み込みに失敗する（Node 20.19.6 を `^20.19.0` が満たさないと誤判定する）。単体で `vp check --fix` は通る。**対処**: `git commit --no-verify` で回避（ユーザー許可済み）
- **ファイル `export` 形式**: `packages/myreact/package.json` の `exports` は `./src/index.ts` を直接指す。これは同じmonorepo内からの参照前提の設計。外部公開するなら tsdown でビルドを足す必要がある

## 作業開始チェックリスト

- [ ] `docs/` の最新ファイルを読んで現在地を把握
- [ ] 次回の分岐（E / F）をユーザーに確認
- [ ] コーチモードのスタンスを維持（すぐ答えを出さず、質問で考えさせる）

---

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run the Vite+ built-in tool, not any `package.json` script of the same name. To run a custom script that shares a name with a built-in command, use `vp run <script>`. For example, if you have a custom `dev` script that runs multiple services concurrently, run it with `vp run dev`, not `vp dev` (which always starts Vite's dev server).
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
<!--VITE PLUS END-->
