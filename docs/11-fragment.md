# 11. Fragment（`<>...</>`）

複数の要素を「1 つの塊」として扱いたいけど、余計な DOM ノードは挟みたくない──そのための仕組みが Fragment。JSX の `<>...</>` がこれにコンパイルされる。

## なぜ必要か：`<div>` で包めばいいじゃん、は通らない

```jsx
function Row() {
  return (
    <>
      <td>Name</td>
      <td>Alice</td>
    </>
  );
}

<table><tr><Row /></tr></table>
```

Row が返すものを `<div>` で包むと、`<tr>` の直下に `<div>` が挟まる構造になる。HTML 仕様的に不正（`<tr>` の直下に許されるのは `<td>` / `<th>`）で、ブラウザによっては div が外に弾き出されて DOM が壊れる。

他にも：

- `display: flex` / `display: grid` の途中にラッパーが挟まると子カウントや layout が崩れる
- コンポーネント内の意味の区切りのために `<div>` を増やすと、CSS セレクタや scroll / ResizeObserver の対象がズレる
- DevTools の DOM ツリーがノイズだらけになる

「**論理的にまとめたいが、DOM としては何も挟みたくない**」が Fragment の役割。

## 実装の鍵：自身は DOM を持たない

Fragment は既存の 4 つのケース（intrinsic / 関数コンポーネント / TEXT / null）の中で、**関数コンポーネント**と挙動が近い。

| 処理                         | 関数コンポーネント          | Fragment                          |
| ---------------------------- | --------------------------- | --------------------------------- |
| 自身の DOM を作る？          | しない（`dom: null`）       | しない（`dom: null`）             |
| 子はどう得る？               | `vnode.type(props)` を呼ぶ  | `vnode.props.children` の配列     |
| 子を並べる先は？             | 受け取った `parentDom`      | 受け取った `parentDom`            |
| hooks / state を持つ？       | 持つ                        | 持たない                          |

違いは「children を関数呼び出しで得るか、すでに props にある配列か」だけ。**自身は DOM を持たず、受け取った `parentDom` に children を直接並べる**という核の部分は同じ。

## なぜ string じゃなく Symbol か

最初は `Fragment = "myreact.Fragment"` という string で仮置きしていた。でもこれだと、reconcile の intrinsic 分岐に流れ込んで：

```ts
document.createElement("myreact.Fragment");
```

が実行される。エラーにはならず、**`<myreact.fragment>` という謎のタグが DOM に作られてしまう**（= 余計な DOM が挟まる = Fragment の目的と真逆）。

string 型だと intrinsic な `div` / `span` / `h1` などと型レベルで区別がつかない。だから TEXT_TYPE と同じく Symbol にする：

```ts
export const FRAGMENT_TYPE = Symbol("FRAGMENT");
```

Symbol は一意なので、intrinsic ともぶつからない。`vnode.type === FRAGMENT_TYPE` という厳密比較で一発判定できる。

## reconcile への組み込み

3 箇所を足しただけで済む：

**① mount 分岐**（新規マウント）

```ts
if (vnode.type === FRAGMENT_TYPE) {
  const children: (Fiber | null)[] = [];
  for (const child of vnode.props.children) {
    children.push(reconcile(parentDom, null, child));
  }
  return {
    type: FRAGMENT_TYPE,
    vnode,
    dom: null,       // ← Fragment 自身は DOM を持たない
    children,
    hooks: [],
    pendingEffects: [],
  };
}
```

**② reconcile の update 分岐**（型が同じとき）

```ts
if (oldFiber && oldFiber.type === vnode.type) {
  if (typeof vnode.type === "function") return updateFunctionComponent(...);
  if (vnode.type === FRAGMENT_TYPE) return updateFragment(...);
  return updateIntrinsic(...);
}
```

**③ updateFragment**

```ts
function updateFragment(parentDom, oldFiber, vnode) {
  const oldChildren = oldFiber.children;
  const newChildren = vnode.props.children;

  for (let i = newChildren.length; i < oldChildren.length; i++) {
    const old = oldChildren[i];
    if (old) unmountFiber(old, parentDom);
  }

  const result: (Fiber | null)[] = [];
  for (let i = 0; i < newChildren.length; i++) {
    result.push(reconcile(parentDom, oldChildren[i] ?? null, newChildren[i]));
  }

  oldFiber.vnode = vnode;
  oldFiber.children = result;
  return oldFiber;
}
```

## 並び替えは親に任せる

intrinsic の `updateIntrinsic` は `reconcileChildren` 経由で `reorderChildren` を呼ぶ。これは `parentDom.childNodes[i]` を fiber 順に揃える処理で、**0 番目から全部詰める**。

もし Fragment の update でも同じ `reorderChildren` を呼ぶと、`parentDom` に存在する「Fragment の外の兄弟」を無視して先頭から並べ替えてしまい、構造が壊れる。

だから Fragment の update では **reorderChildren を呼ばない**。並び替えは 1 つ外側の intrinsic に任せる。

なぜそれで動くかというと、`collectDoms` がすでに Fragment に対応した実装になっているから：

```ts
function collectDoms(fiber, result) {
  if (fiber.dom) {
    result.push(fiber.dom);
    return;
  }
  for (const child of fiber.children) {
    if (child) collectDoms(child, result);
  }
}
```

`dom: null` の fiber に対しては再帰で children を展開する。だから親の `reorderChildren` は Fragment の子孫 DOM をフラットに集めて並べ替えられる。Fragment は構造上は存在するけど、DOM の並びから見れば透明。

この「透明な Fiber」という概念は関数コンポーネントの時点で既に用意できていた。Fragment はその性質を再利用しているだけ。

## 確認したシナリオ

```tsx
function TableRow({ name, age }: { name: string; age: number }) {
  return (
    <>
      <td>{name}</td>
      <td>{age}</td>
    </>
  );
}

function App() {
  const [count, setCount] = useState(0);
  return (
    <>
      <h1>Counter</h1>
      <p>count: {count}</p>
      <button onClick={() => setCount(count + 1)}>+1</button>
      <table>
        <tbody>
          <tr><TableRow name="Alice" age={count} /></tr>
          <tr><TableRow name="Bob" age={count * 2} /></tr>
        </tbody>
      </table>
    </>
  );
}
```

Playwright で DOM を直接確認：

- `#root` の直下： `[H1, P, BUTTON, TABLE]`（App の外側の Fragment が展開されている）
- `<tr>` の直下： `[TD, TD]`（TableRow の Fragment が展開されて td だけ並ぶ）
- `<myreact.fragment>` タグは存在しない
- +1 クリックで count / count\*2 が正しく更新され、Fragment 周りでレイアウト崩れなし

## 本家との差分

- **key なしでの Fragment 並び替え**: 本家も key がないと Fragment 内部の並び替えで state が吹き飛ぶ。key 対応（次の候補 J）でカバーする話
- **`<Fragment key="...">`**: 本家は Fragment に key を渡してリストの要素にできる。現状は非対応
- **React.Fragment の import**: 本家は `import { Fragment } from "react"` でも書ける。自作版は JSX 経由のみ

## 次のステップ候補

- **J. key prop**: リストの並び替えで state を保つ。Fragment 内部の並び替えでも効いてくる
- **R. useRef**: DOM 参照と「再 render しない値の箱」
- **M. useMemo / useCallback**: 計算の memoize
