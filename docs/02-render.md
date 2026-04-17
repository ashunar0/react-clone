# 02. render — VDOMを実DOMに変換する

`createElement` で仮想DOM（JSオブジェクト）を作るところまではできた。次は、その仮想DOMを実際のDOMノードに変換して `<div id="root">` に差し込む `render` 関数を書く。これでようやく画面に何かが表示される。

## render のシグネチャ

```ts
function render(vdom: VNode, container: HTMLElement): void
```

- **第1引数 `vdom`**: `createElement` で作ったVNodeオブジェクト
- **第2引数 `container`**: 出力先の親DOM要素（通常は `document.getElementById("root")`）
- **戻り値**: `void`。`render` はDOMに副作用を起こすのが仕事なので、何かを返す必要はない

## 使うDOM API

実DOMの組み立てには Vanilla JS の3つだけで足りる:

| API | 用途 |
|-----|------|
| `document.createElement(tagName)` | 要素ノードを作る（`<div>` など） |
| `document.createTextNode(text)` | テキストノードを作る（"Hello" など） |
| `parent.appendChild(child)` | 子ノードを親に繋ぐ |

DOMは「Nodeのツリー」で、要素ノードもテキストノードも同じ `Node` 型として `appendChild` で繋げる。

### textContent ではなく createTextNode を使う理由

`el.textContent = "Hello"` は手軽だが、複数のテキスト子を扱えない:

```ts
{ type: "p", props: { children: ["Hello ", "太郎"] } }
```

`textContent` を2回代入すると2回目で上書きされてしまう。`createTextNode` + `appendChild` なら子ノードとして並べて持てるので、要素子・テキスト子が混ざるケースも自然に扱える。

## 処理の流れ

VDOMが `{ type: "div", props: { children: [...] } }` のような形だとして:

1. `vdom.type` から実要素を作る（`document.createElement("div")`）
2. `vdom.props.children` を1個ずつループして処理する
   - **文字列 / 数値** なら → `document.createTextNode` でテキストノードを作って `appendChild`
   - **VNodeオブジェクト** なら → `render` を**再帰的に**呼ぶ
3. 出来上がった要素を `container` に `appendChild`

今回は v1 として `props` の他のキー（`className` など）は無視。`children` だけ処理する。属性対応は後で足す。

## 実装

```ts
export function render(vdom: VNode, container: HTMLElement): void {
  const el = document.createElement(vdom.type);

  for (const child of vdom.props.children) {
    if (typeof child === "string" || typeof child === "number") {
      el.appendChild(document.createTextNode(String(child)));
    } else {
      render(child, el);
    }
  }

  container.appendChild(el);
}
```

## 再帰について

ここでのキモは `render(child, el)` の **再帰呼び出し**。VDOMは木構造で、各ノードの子もまた同じ形のノード（VNode）になっている。「自分に似た構造」を処理するときは、自分を呼ぶのが自然な解になる。

```
render(<div>)
  ├─ render(<h1>) を再帰呼び出し
  │    └─ createTextNode("Hello") を appendChild
  └─ render(<p>) を再帰呼び出し
       ├─ createTextNode("Welcome ")
       └─ createTextNode("太郎")
```

このパターンは後の差分更新（reconciliation）でも同じように出てくる。

## 動作確認

`apps/website/src/main.ts`:

```ts
import "./style.css";
import { createElement, render } from "myreact";

const name = "太郎";
const vdom = createElement(
  "div",
  { className: "app" },
  createElement("h1", null, "Hello"),
  createElement("p", null, "Welcome ", name),
);

render(vdom, document.getElementById("root")!);
```

`index.html` の `<div id="app">` を `<div id="root">` にリネームし、Viteスターターのデモ画面（`innerHTML = ...` の塊）は削除した。`vp dev` で起動するとブラウザに「Hello」と「Welcome 太郎」が表示される。

## 現時点での制限

- **propsの属性は無視**: `className` を渡しても DOM の `class` 属性にはならない。次のステップで対応
- **イベントハンドラ未対応**: `onClick` などはまだ動かない
- **再描画未対応**: 一度 `render` したら終わり。state の変化に応じて差分更新する仕組みはまだ無い

## 次のステップ

- **C. props を実DOMの属性に反映する**: `className` → `class`、その他の属性、イベントハンドラなど
- **B. JSXを有効にする**: コンパイラ設定で `<div>` 構文を `createElement` 呼び出しに変換させる

B か C のどちらを先にやるかは次回相談。
