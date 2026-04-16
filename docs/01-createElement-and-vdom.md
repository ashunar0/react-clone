# 01. createElement と仮想DOM

Reactをゼロから再実装する最初のステップ。`createElement` を書いて、JSXが内部でどう表現されるのかを理解する。

## Reactの全体像

Reactアプリの最小構成はこういう流れ:

```
index.html に <div id="root"></div> を用意
      ↓
app.jsx を書く（JSX構文）
      ↓
コンパイラが JSX を createElement() 呼び出しに変換
      ↓
createElement() が実行されて、仮想DOM（ただのJSオブジェクト）が生成される
      ↓
render() が仮想DOMを辿って実DOMを作り、#root に埋め込む
```

## バンドラー / コンパイラ / Reactの分業

混同しやすいけど、役割は完全に別。

| 担当 | 仕事 | 代表例 |
|------|------|--------|
| コンパイラ | JSX・TypeScript を普通のJSに変換 | Babel, SWC, esbuild, Oxc |
| バンドラー | 複数のJSファイルを依存関係で繋いでまとめる | Webpack, Rollup, Rolldown |
| React本体 | `createElement` / `render` / 差分更新 / Hooks などのランタイム | — |

バンドラーはコンパイラをプラグインとして呼び出す。CRA時代の Webpack は `babel-loader` 経由で Babel を呼んでいた。Vite+ の場合は内部で Oxc/esbuild が JSX 変換を担当している。

**重要**: JSXの変換自体はReactの仕事ではない。だから Preact や Solid など別ライブラリでも同じJSX構文を使える。Reactがやっているのは「`createElement(...)` を呼ばれたら決まった形のオブジェクトを返す」部分だけ。

## createElement の入出力

コンパイラが出力する呼び出しはこの形:

```js
// 元のJSX
<h1 className="title">Hello</h1>

// コンパイラ出力
createElement("h1", { className: "title" }, "Hello")
//             ↑type  ↑props                 ↑children
```

引数:

- **第1引数 `type`**: タグ名の文字列（例: `"h1"`）
- **第2引数 `props`**: 属性のオブジェクト。属性が無い時は `null` が渡される
- **第3引数以降 `...children`**: 子要素の可変長引数

### children の区切り方

JSXは、タグの中身を「静的テキスト / `{ }` のJS式 / ネストしたタグ」の境目で分割して、それぞれを別の引数として並べる:

```jsx
<h1>Hello</h1>
// → createElement("h1", null, "Hello")

<h1>Hello {name}</h1>
// → createElement("h1", null, "Hello ", name)

<h1>{greeting} {name}!</h1>
// → createElement("h1", null, greeting, " ", name, "!")
```

`{name}` は `{}` で囲われたJS式。**テキストの中に置かれた場合は child**、**属性の位置に置かれた場合は props の値** になる。

## VNode（仮想DOMの1ノード）の形

`createElement` が返すオブジェクトは「VNode」と呼ぶ:

```ts
type VNode = {
  type: string;
  props: {
    [key: string]: unknown;
    children: VNodeChild[];
  };
};

type VNodeChild = VNode | string | number;
```

**ポイント**: 属性も子要素も `props` というひとつの箱に入れる。`children` は `props.children` として格納する。こうしておくと、後の `render` や差分更新は「`props` を見るだけ」で済む。

## 実装

```ts
export function createElement(
  type: string,
  props: Record<string, unknown> | null,
  ...children: VNodeChild[]
): VNode {
  return {
    type,
    props: {
      ...props,
      children,
    },
  };
}
```

これだけ。`...props` は `null` を展開しても `{}` になるだけなのでエラーにならない。

## 具体例のトレース

入力のJSX:

```jsx
function App() {
  const name = "太郎";
  return (
    <div className="app">
      <h1>Hello</h1>
      <p>Welcome {name}</p>
    </div>
  );
}
```

コンパイラ出力:

```js
function App() {
  const name = "太郎";
  return createElement(
    "div",
    { className: "app" },
    createElement("h1", null, "Hello"),
    createElement("p", null, "Welcome ", name)
  );
}
```

内側から評価されて、最終的に得られるVDOM:

```js
{
  type: "div",
  props: {
    className: "app",
    children: [
      { type: "h1", props: { children: ["Hello"] } },
      { type: "p",  props: { children: ["Welcome ", "太郎"] } }
    ]
  }
}
```

HTMLツリーの構造が、そのまま入れ子のJSオブジェクトとして表現されている。これが仮想DOMの正体。

## なぜ仮想DOMを挟むのか

初回描画だけなら仮想DOMは要らない。`document.createElement` を直接呼べば十分。

仮想DOMの価値は **更新時** に出る:

1. stateが変わったら、新しいVDOMツリーを作る
2. 前回のVDOMツリーと差分を取る（reconciliation）
3. 変わった部分だけ実DOMに反映する

実DOM操作は重いから、軽いJSオブジェクト同士で比較してから最小限のDOM操作に絞る。これが仮想DOMのメリット。

## モノレポ構成

`packages/myreact` として作成。ビルド（`dist/`出力）はせず、`src/index.ts` を直接 `exports` させる。同じmonorepo内からの参照なので、ビルドは不要。

```
packages/myreact/
├── package.json      // exports: "./src/index.ts"
├── tsconfig.json
└── src/index.ts      // createElement と型定義
```

`apps/website/package.json` に `"myreact": "workspace:*"` を追加すると、pnpm が `apps/website/node_modules/myreact` を `packages/myreact` へのシンボリックリンクとして張ってくれる。

## 動作確認の結果

`apps/website/src/main.ts` から手書きで `createElement` をネストして呼び、`console.log` すると期待通りの入れ子オブジェクトがブラウザのコンソールに出力された。

## 次のステップ

- **A. `render` を書く**: VDOMを実DOMに変換して `#root` に埋め込む
- **B. JSXを有効にする**: コンパイラ設定で `<div>` 構文を `createElement` 呼び出しに変換させる
