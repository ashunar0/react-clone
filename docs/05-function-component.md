# 05. 関数コンポーネント対応

今までは `<div>`, `<h1>` みたいな HTMLタグの JSX しか書けなかった。`<App />` のような**自作の関数コンポーネント**を書けるようにする。React の「部品化」の中核。

## 目指す形

普通の React テンプレートと同じ書き方:

```tsx
function App() {
  return <div>Hello</div>;
}

render(<App />, document.getElementById("root")!);
```

## 大文字始まり / 小文字始まりの文法

JSX には**コンパイラレベルの文法ルール**がある:

```tsx
<div />   // → jsx("div", {})    ← 文字列リテラル（HTMLタグ）
<App />   // → jsx(App, {})      ← 識別子（スコープの変数を参照）
```

- **小文字始まり** → コンパイラは**文字列として扱う**。HTMLタグの名前
- **大文字始まり** → コンパイラは**スコープの変数を参照する**。関数コンポーネントや他のクラス

だから `<app />` (小文字で関数定義) は意図通り動かない。`"app"` という文字列で `document.createElement("app")` を呼ぶだけで、あなたの書いた `app` 関数は呼ばれない。

逆に `<MyButton />` と書いたら、コンパイラは「この `MyButton` という**変数**がスコープに必ずある」前提でコードを吐く。import し忘れたら `MyButton is not defined` ランタイムエラー。

**つまり「コンポーネントは大文字始まり」は規約じゃなくて文法**。

## 型の拡張

`type` が関数を受け付けるように拡張する。

```ts
// FunctionComponent: props を受け取って VNode を返す関数
export type FunctionComponent<P = Record<string, unknown>> = (props: P) => VNode;

export type VNode = {
  type: string | FunctionComponent; // ← 関数も OK に
  props: { ... };
};
```

`createElement` と `jsx` の引数も同じように拡張する。型を変えるだけで、既存のロジックには影響しない。

## render の分岐を追加

肝は `render` の先頭に**たった3行**足すだけ:

```ts
export function render(vdom: VNode, container: HTMLElement): void {
  // 関数コンポーネントなら、呼び出して返ってきた VNode を再 render する
  if (typeof vdom.type === "function") {
    const childVNode = vdom.type(vdom.props);
    render(childVNode, container);
    return;
  }

  // 以下、HTMLタグの処理（既存のコード）
  const el = document.createElement(vdom.type);
  // ...
}
```

### 何が起きているか

`<App />` のケースを追うと:

1. コンパイラが `<App />` を `jsx(App, {})` に変換
2. `jsx(App, {})` は VNode `{ type: App, props: { children: [] } }` を返す
3. `render(vdom, root)` が呼ばれる
4. `typeof vdom.type === "function"` → true
5. `App({ children: [] })` を呼ぶ → `<div>Hello</div>` が変換された VNode `{ type: "div", props: {...} }` が返る
6. その VNode を引数に `render` を**再帰呼び出し**
7. 今度は `type` が文字列 `"div"` なので、既存ロジックで実DOMに変換される

**関数コンポーネントは「VNode を返す関数」**という抽象化を render に追加するだけで実現できる。これが React の美しいところ。

### ネストも同じロジックで動く

```tsx
function Greeting({ name }: { name: string }) {
  return <p>Welcome {name}</p>;
}

function App() {
  return (
    <div>
      <h1>Hello</h1>
      <Greeting name="太郎" />
    </div>
  );
}
```

`App` 内部の `<Greeting name="太郎" />` も `jsx(Greeting, { name: "太郎" })` になるので、`App` が返す VNode の children には `{ type: Greeting, props: { name: "太郎" } }` が含まれる。

children を処理するループで VNode を見つけて `render(child, el)` を再帰呼び出しすると、その再帰の中で再び関数分岐が発動して `Greeting` が呼ばれる。**再帰が綺麗にネスト構造を処理してくれる**。

## 標準 React テンプレートの形に合わせる

`apps/website/src/` を React の公式テンプレートと同じ構造にした:

```
src/
├── App.tsx                    ← function App() { ... } export default App
├── components/
│   └── Greeting.tsx           ← 子コンポーネントは別ファイルに
└── main.tsx                   ← render(<App />, ...) だけ
```

### `App.tsx`

```tsx
import Greeting from "./components/Greeting.tsx";

function App() {
  return (
    <div className="app" id="main">
      <h1>Hello</h1>
      <Greeting name="佐藤太郎" />
      <button className="primary" onClick={() => alert("clicked!")}>
        送信
      </button>
    </div>
  );
}

export default App;
```

### `components/Greeting.tsx`

```tsx
function Greeting({ name }: { name: string }) {
  return <p>Welcome {name}</p>;
}

export default Greeting;
```

### `main.tsx`

```tsx
import { render } from "myreact";
import App from "./App.tsx";

render(<App />, document.getElementById("root")!);
```

entry ファイルは render を呼ぶだけ。コンポーネント本体は App.tsx に分離。

### 本家 React との比較

|                    | React 本家                                                 | myreact                |
| ------------------ | ---------------------------------------------------------- | ---------------------- |
| entry              | `createRoot(...).render(<StrictMode><App /></StrictMode>)` | `render(<App />, ...)` |
| Appの形            | `function App() { return <div /> }` + `export default`     | 同じ                   |
| 子コンポーネント   | `<Child prop={value} />`                                   | 同じ                   |
| props の受け取り方 | 関数の第1引数のオブジェクト                                | 同じ                   |

entry の形だけ違うが、それ以外は React を書いてる感覚とほぼ同じ。

## 学んだこと

- **関数コンポーネントの正体は「VNode を返す関数」**。たったそれだけ
- **`render` の再帰が、任意のネストを処理してくれる**。関数分岐を足しても再帰の構造は変わらない
- **大文字 / 小文字ルールは JSX 文法の一部**。コンパイラが決める挙動
- **props オブジェクトが丸ごと引数として渡る**。React のあの第一引数はここで生まれる

## 現時点での制限

- **state が持てない**: `useState` が無い。一度 render したら終わり
- **再描画できない**: 状態が変わっても画面は更新されない
- **Fragment 未対応**: `<>...</>` は書けない

## 次のステップ

- **E. state と再描画**: `useState` を作り、差分更新（reconciliation）に入る。最難関
- **F. Fragment 対応**: `<>...</>` を使えるようにする。軽い改修

E は React の心臓部。ここまで来ると「手で React を作った」と言えるレベルに近づく。
