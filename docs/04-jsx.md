# 04. JSX を有効にする

`createElement` を手で書くのはしんどい。JSX 構文で `<div>Hello</div>` と書けるようにする。

## JSX とは何か

JSX は **ただの糖衣構文**。TypeScript/Babel/Oxc などのコンパイラが、JSX を普通の関数呼び出しに変換する。自分の目で実際のコード（`createElement` 呼び出し）を書いた後だから、この「変換」がイメージしやすい。

```tsx
<div className="app">Hello</div>
```

が、コンパイラで

```ts
jsx("div", { className: "app", children: "Hello" })
```

に化ける。**ランタイムは JSX を知らない**。ブラウザに届く時には全部関数呼び出しになっている。

## Classic runtime vs Automatic runtime

JSX には2つのモードがある。

| | Classic runtime | Automatic runtime |
|---|---|---|
| 変換結果 | `<div/>` → `createElement("div")` | `<div/>` → `_jsx("div")` |
| import | 自分で書く（`import { createElement } from ...`） | コンパイラが自動挿入 |
| 関数シグネチャ | `createElement(type, props, ...children)` | `jsx(type, { ...props, children })` |
| 歴史 | React 16 まで標準 | React 17 以降のデフォルト |

Classic runtime は手で import を書く必要がある。automatic runtime は「import を書かなくていい」を実現するために、コンパイラが裏で `import { jsx } from "react/jsx-runtime"` を自動挿入する。

## 今回の構成：Automatic runtime + myreact/jsx-runtime

今回は最終的に automatic runtime を採用した。理由は:

- 現代 React プロジェクトの実際の構成と一致する
- `createElement` の import が不要になるので、lint 警告も出ない
- `@vitejs/plugin-react` も内部でこれをやっている

### 4つのレイヤー

JSX を動かすのに必要な設定は**4つのレイヤー**に分かれている。

| レイヤー | やること | 触るファイル |
|---|---|---|
| 1. ライブラリ側 | `jsx-runtime` モジュールを作る | `packages/myreact/src/jsx-runtime.ts` |
| 2. パッケージ境界 | jsx-runtime を外から import 可能にする | `packages/myreact/package.json` |
| 3. 型チェック | TS に JSX の解釈方法を教える | `apps/website/tsconfig.json` |
| 4. 実行コード変換 | Oxc に JSX の変換方法を教える | `apps/website/vite.config.ts` |

### 1. `packages/myreact/src/jsx-runtime.ts`

automatic runtime がコンパイラから呼ぶ関数を export する。

```ts
import { createElement, type VNode, type VNodeChild } from "./index.ts";

export function jsx(
  type: string,
  props: Record<string, unknown> & { children?: VNodeChild | VNodeChild[] },
): VNode {
  const { children, ...rest } = props;
  const childArray: VNodeChild[] =
    children === undefined
      ? []
      : Array.isArray(children)
        ? children
        : [children];
  return createElement(type, rest, ...childArray);
}

export const jsxs = jsx;
export const Fragment = "myreact.Fragment"; // 現状未対応
```

**ポイント**: `createElement` と `jsx` の違いは children の受け取り方。

- `createElement(type, props, ...children)` → children は **rest 引数**
- `jsx(type, { ...props, children })` → children は **props の中**

だから `jsx` の中で `props` から `children` を取り出して、`createElement` に rest 引数として渡し直している。中身は既存の `createElement` に委譲してるだけ。

`jsxs` は「複数の静的 children がある時にコンパイラが使う」版。我々の実装では差がないので同じ関数を再利用。

### 2. `packages/myreact/package.json` の exports

```json
"exports": {
  ".": "./src/index.ts",
  "./jsx-runtime": "./src/jsx-runtime.ts",
  "./jsx-dev-runtime": "./src/jsx-dev-runtime.ts"
}
```

`import { jsx } from "myreact/jsx-runtime"` が成立するように、subpath を公開する。

### 3. `apps/website/tsconfig.json`

```json
"jsx": "react-jsx",
"jsxImportSource": "myreact"
```

- `"jsx": "react-jsx"` → automatic runtime を使う合図
- `"jsxImportSource": "myreact"` → `jsx` / `jsxs` を **`myreact/jsx-runtime`** から取ってこいと TS に伝える（デフォルトは `react`）

### 4. `apps/website/vite.config.ts`

```ts
oxc: {
  jsx: {
    runtime: "automatic",
    importSource: "myreact",
  },
}
```

これが**実行コードの変換**側の設定。TS は型チェックだけで、実際のコード変換は Oxc が担う。同じ内容を両方に書く必要がある。

### esbuild と Oxc と Vite+

設定を書きながら一つ歴史的な発見があった:

- 普通の Vite は **esbuild** で JSX 変換
- Vite+（実体は Rolldown-Vite）は **Oxc** で JSX 変換
- 互換のために **`esbuild.jsxFactory`** キーも生きてるけど `@deprecated`。内部的に Oxc オプションに変換される
- 正式には **`oxc.jsx.{runtime, pragma, pragmaFrag, importSource}`** を使う

React のスターターだと `@vitejs/plugin-react` プラグイン1個がこれら全部を隠蔽してくれる。今回は手で書いて仕組みを見た。

## 実際のファイル差分

### 使う側（`apps/website/src/main.tsx`）

```tsx
import "./style.css";
import { render } from "myreact";

const name = "太郎";
const vdom = (
  <div className="app" id="main">
    <h1>Hello</h1>
    <p>Welcome {name}</p>
    <button className="primary" onClick={() => alert("clicked!")}>
      送信
    </button>
  </div>
);

render(vdom, document.getElementById("root")!);
```

見てほしいのは:

- **`createElement` を import していない**。automatic runtime なので裏で勝手に import される
- `<div>` が実DOMに直接なるわけじゃなくて、まず `jsx("div", {...})` 呼び出しに変換されて、それが VNode を返す
- `render` はその VNode を実DOMに変換する

## 学んだこと

- **JSX はコンパイラの仕事**。ランタイムは関数呼び出ししか見ない
- **Classic / Automatic の違いは「import を誰が書くか」**。中身がやる仕事はほぼ同じ
- **automatic runtime の構造**: ライブラリ側が `jsx-runtime` モジュールを提供し、コンパイラがそれを自動 import する契約
- **型と実行が別レイヤー**: tsconfig の JSX 設定と vite.config の JSX 設定は別物。同じことを両方に書く必要がある
- **Vite+ は Rolldown/Oxc ベース** なので、esbuild 互換キーじゃなく `oxc` キーを使うのが正式

## 現時点での制限

- **Fragment 未対応**: `<>...</>` は書けない。`render` が `type: string` しか扱えないので、Fragment を見分ける機構がまだない
- **関数コンポーネント未対応**: `type` に関数を渡せない。次のステップで対応
- **開発/本番の違い未対応**: `jsx-dev-runtime.ts` は作ったが、`jsxDEV` は `jsx` と同じ実装（`__source`, `__self` などの dev 情報は無視）

## 次のステップ

- **D. 関数コンポーネントに対応する**: `type` に関数を受け付け、`<App />` と書けるようにする
- **E. state と再描画**: `useState` 相当を作る。差分更新（reconciliation）に入る

どちらも React の中心概念に近づく。次回相談。
