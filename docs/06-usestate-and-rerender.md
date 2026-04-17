# 06. useState と再レンダリング（愚直版）

React の心臓部分。`useState` で state を持ち、値が変わったら画面を更新する仕組み。

ここでは**差分更新（reconciliation）は後回し**で、「state が変わったら画面全体を作り直す」愚直版を作る。まず動く仕組みを掴むのが先、最適化は後。

## 完成形

```tsx
import { useState } from "myreact";

function App() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

押すたびに数字が増える。ごく普通の React。

## 問題を分解

押してから画面が更新されるまで：

1. `onClick` が発火 → `setCount(count + 1)` が呼ばれる
2. 内部の値を書き換える
3. **再レンダリングが走る**
4. `App` が再実行されて新しい VDOM が作られる
5. 画面に反映される

今回作るのは主に 2〜4。5 は「全消して作り直す」で妥協（差分更新は次回）。

## パート 1：再レンダリングの仕組み

### なぜ「root を覚える」必要があるか

`rerender()` は setter の中から呼ばれる。そのコードからは「何を」「どこに」描画するかの情報は**見えない**。

```tsx
onClick={() => {
  count++;
  rerender();  // ← 引数なし。何を再描画するか知らない
}}
```

最初の `render(<App />, root)` 呼び出し時にしか `<App />` と `root` の情報は無いので、**モジュール内変数にメモ**しておく必要がある。

### render と renderNode の分離

今の `render` は再帰的に自分を呼んでる（子要素の描画のため）。ここで素朴に root を記録しようとすると、**再帰呼び出しで rootVNode/container が上書き**される。

```ts
// 悪い例: 子要素の VNode で root が上書きされてしまう
export function render(vdom, container) {
  rootVNode = vdom; // 再帰呼び出しでも実行される
  rootContainer = container;
  // ...
  render(child, el); // ← ここで子要素が root になっちゃう
}
```

解決: **外から呼ばれる `render`** と **内部で再帰する `renderNode`** に分ける。

```ts
let rootVNode: VNode | null = null;
let rootContainer: HTMLElement | null = null;

export function render(vdom, container) {
  rootVNode = vdom;
  rootContainer = container;
  stateIndex = 0; // useState 用リセット（後述）
  renderNode(vdom, container);
}

export function rerender() {
  if (!rootVNode || !rootContainer) return;
  stateIndex = 0;
  rootContainer.innerHTML = ""; // 愚直派：全消し
  renderNode(rootVNode, rootContainer);
}

function renderNode(vdom, container) {
  // 元の render の中身。再帰も renderNode に閉じる
}
```

「外部 API」と「内部実装」の分離パターン。root を覚えるのは外部 API 側の責務。

## パート 2：useState

### そもそも何が難しいか

```tsx
const [count, setCount] = useState(0);
```

この行は**初回レンダリングでも 2回目以降でも同じコード**。なのに：

- 初回は `0` で初期化したい
- 2回目以降は「前回 setCount で書き換えた値」を返したい

ということは `useState` は**関数の外**に「前回の値」を覚えていないといけない。

### どう区別するか：「呼び出し順」を index にする

```tsx
function Form() {
  const [name] = useState(""); // 1 番目
  const [age] = useState(0); // 2 番目
  const [email] = useState(""); // 3 番目
}
```

useState 関数の中から「自分はどの呼び出しか」を知る方法は**呼ばれた順番**しかない。

- 外部に配列 `states[]` を用意
- 呼び出しごとに index を進める（1 個目は index=0, 2 個目は index=1, ...）
- レンダリング開始時に index を 0 にリセット

```ts
const states: unknown[] = [];
let stateIndex = 0;

export function useState<T>(initial: T): [T, (newValue: T) => void] {
  if (states[stateIndex] === undefined) {
    states[stateIndex] = initial; // 初回のみ初期化
  }
  const currentIndex = stateIndex; // クロージャに閉じ込める（重要）
  const setState = (newValue: T) => {
    states[currentIndex] = newValue;
    rerender();
  };
  stateIndex++;
  return [states[currentIndex] as T, setState];
}
```

### なぜ `currentIndex` を別変数に？

setter は**後で**（ボタンクリック時）呼ばれる。その時 `stateIndex` は全然違う値になってる（次の useState 呼び出しで進んでる / 次のレンダリングで 0 にリセットされてる）。

だから setter が生成された**その瞬間の index** をクロージャに閉じ込める必要がある。これを忘れると全 setter が最後の index を指してしまう古典的バグ。

### Rules of Hooks はこの仕組みから生まれてる

```tsx
if (someCondition) {
  const [a] = useState(0); // 呼ばれたり呼ばれなかったり
}
const [b] = useState(""); // index がズレる
```

`a` が呼ばれなかった回は `b` が index=0 の箱を取ってしまう。前回の `a` の値を `b` として読んでしまって大惨事。

だから公式ドキュメントが言う「フックをトップレベルで呼べ」「条件分岐の中で呼ぶな」は、この**配列 + 呼び出し順インデックス**という実装の制約そのもの。

## setter の「関数版」は今回保留

```tsx
setCount((prev) => prev + 1);
```

これに対応しないと、1クリックで 3 回 `setCount(count + 1)` を連打しても count は 1 しか増えない（`count` はクロージャで 0 に固定されてる = stale closure）。

原理を理解したら `typeof newValue === "function"` の分岐を足すだけで対応できるので、今回は保留。

## 本家 React との違い

- **データ構造**：配列ではなく連結リスト（各フックが `next` ポインタを持つ）
- **保存場所**：**コンポーネントごと**の Fiber に紐付く（我々はグローバル1本）
- **再描画**：スケジューラで優先度制御、Concurrent Mode、double-buffering

つまり我々の実装は「1 コンポーネントが 1 本の state を共有する」前提でしか動かない。**複数のコンポーネントで useState を使うと state が混ざって壊れる**。これは次のステップでリファクタする。

## 試した確認

1. `count` を 0 から +1 ボタンで増やせる
2. `name` を併用しても、それぞれ独立した箱で管理される
3. stale closure: 1 つの handler 内で `setCount(count + 1)` を 3 回呼んでも 1 しか増えない

## 次にやること

- 複数コンポーネントで useState を使うと壊れることを体験
- state を**コンポーネント（Fiber 相当）ごと**に紐付けるリファクタ
- 愚直な「全消し再描画」を **差分更新（reconciliation）** に置き換える
