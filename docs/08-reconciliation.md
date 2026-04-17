# 08. 差分更新（reconciliation）

ここまで `rerender()` は `container.innerHTML = ""` で全消しして作り直していた。動くけど、input のフォーカスが飛んだり、スクロール位置が戻ったり、DOM を毎回作り直すので重い。

本家 React と同じく「**前回の描画ツリーと比較して、変わった部分だけ DOM を操作する**」ようにする。これが reconciliation。ここを入れるとやっと「本家っぽい」ライブラリになる。

## 何が変わるか（ユーザー目線）

- `<input>` にフォーカス・入力した内容が、別の state 更新で rerender しても**保たれる**
- テキストが変わるだけなら `Text` ノードの `data` を書き換えるだけで DOM 要素自体は再利用
- イベントリスナも必要な時だけ付け替え

## 核となるデータ構造：Fiber ツリー

前回の描画を保持するために、VDOM と対応した「Fiber ツリー」を持つ。

```ts
type Fiber = {
  type: string | FunctionComponent | typeof TEXT_TYPE;
  vnode: VNodeChild; // 前回この位置に描画した VNode / 文字列
  dom: Node | null; // 対応する実 DOM（function component は null）
  children: (Fiber | null)[]; // 子 Fiber。null は「何も描画しない」位置
  hooks: unknown[]; // function component の useState の箱
};
```

前回の `Map<path, Instance>` をやめた。理由：

- 親子関係をツリーで持つ方が DOM 並び替えや diff の再帰が自然
- 関数コンポーネントの hooks もここに一緒に入れられる（前回の Instance の役目を吸収）
- path 文字列のコスト・煩雑さを避けられる

`rootFiber` をモジュールに保持して、毎 rerender でこのツリーと新しい VDOM を突き合わせる。

## reconcile の 4 ケース

```ts
reconcile(parentDom, oldFiber, newVNode) → Fiber | null
```

1. **旧あり・新なし（unmount）**
   - new が `null` / `false` / `undefined`
   - 旧 Fiber の DOM を親から取り除く（function component なら子孫 DOM を再帰で除去）

2. **旧なし・新あり（mount）**
   - 旧 Fiber がない / 型が違う
   - DOM を作って `parentDom` に挿入、新しい Fiber を返す

3. **同じ型（update）**
   - DOM を**再利用**して props・children だけ差分適用
   - intrinsic: `updateProps` + `reconcileChildren`
   - function component: `hooks` を引き継いで関数を呼び直し、戻り値で再帰 diff

4. **違う型（replace）**
   - 旧を unmount → 新を mount

「型が同じかどうか」がキー。例えば `<div>` と `<span>` は別物扱いで DOM ごと作り直す。`<Counter>` と `<Timer>` も同様。

## テキストノードの扱い

`{count}` のような数値・文字列の子は、JSX で親要素の `children` 配列にそのまま入る。

```tsx
<p>count: {count}</p>
// → <p> の children: ["count: ", count]  ← 2 つの子
```

reconcile は `typeof newVNode === "string" | "number"` を特別扱い：

- 旧が同じ TEXT → `textNode.data` だけ書き換え（ノード再利用）
- 旧が違う型 → unmount して新規 TextNode

`TEXT` を識別するために Symbol (`TEXT_TYPE`) を使う。`"TEXT"` という文字列だと `string` に包含されて TypeScript が怒る。

## props の差分適用

```ts
updateProps(dom, oldProps, newProps);
```

- 旧にあって新にない、または値が変わった → `removeProp`
- 新にあって旧と違う → `setProp`

イベントリスナは要注意。JSX が毎 render で新しい closure を作るので、`onClick` は毎回 `oldProps.onClick !== newProps.onClick` になる。だから**必ず付け替え**。これをやらないと古い closure が残って stale state を参照する。

## children の差分と DOM の並び順

```ts
reconcileChildren(parentDom, oldChildren, newChildren) → (Fiber | null)[]
```

- 新の配列の長さを超える旧の余剰は unmount
- 新の各インデックスに対して reconcile を実行
- 最後に `reorderChildren` で DOM の並びを Fiber 順に揃える

### なぜ並び替えが必要か

例：`{show ? <Counter /> : null}` で Counter を再表示するとき。

- 前回の状態：`[h1, input, button, null, Timer]`
- 新しい状態：`[h1, input, button, Counter, Timer]`
- Counter の mount 時に `parentDom.appendChild` すると、**Timer の後ろ**に付いてしまう
- `reorderChildren` で期待順に `insertBefore` で並び替える

`reorderChildren` の中身：

```ts
// fiber 順に並べた期待 DOM 列を作る
const expected: Node[] = [];
for (const fiber of children) if (fiber) collectDoms(fiber, expected);

// parent.childNodes が期待と違う位置だけ insertBefore
for (let i = 0; i < expected.length; i++) {
  if (parentDom.childNodes[i] !== expected[i]) {
    parentDom.insertBefore(expected[i], parentDom.childNodes[i] ?? null);
  }
}
```

`collectDoms` は関数コンポーネントが DOM を持たないので、子孫を再帰で集める。

## 関数コンポーネントの update（hooks 引き継ぎ）

```ts
updateFunctionComponent(parentDom, oldFiber, vnode) {
  currentFiber = oldFiber;         // useState がこの hooks を見るように
  hookIndex = 0;
  const returned = vnode.type(vnode.props);
  // 戻り値の VNode を旧の子 Fiber と突き合わせて reconcile
  const childFiber = reconcile(parentDom, oldFiber.children[0], returned);
  oldFiber.vnode = vnode;
  oldFiber.children = [childFiber];
  return oldFiber;
}
```

`oldFiber` を**再利用**するので、中の `hooks` 配列はそのまま。`useState` が前回の値を返せる。

## useState の変更点

前回はグローバル `Map<path, Instance>` を見ていた。今回は `currentFiber.hooks` を見るだけ。Fiber が引き継がれれば hooks も自動的に引き継がれる。

```ts
export function useState<T>(initial: T): [T, (newValue: T) => void] {
  const fiber = currentFiber!;
  const i = hookIndex;
  if (fiber.hooks[i] === undefined) fiber.hooks[i] = initial;
  const setState = (newValue: T) => {
    fiber.hooks[i] = newValue;
    rerender();
  };
  hookIndex++;
  return [fiber.hooks[i] as T, setState];
}
```

setter は fiber をクロージャで掴む。同じ fiber オブジェクトが renders 間で使い回される（reconcile で `oldFiber` を書き換えて返す）ので、setter は常に正しい箱を書き換えられる。

## 確認したシナリオ

- **input フォーカス保持**: 入力中に別のボタンで rerender してもフォーカス・入力内容が残る
- **テキストだけの更新**: count の数字だけが Text ノードの data 書き換えで更新される
- **mount/unmount**: toggle で Counter を出し入れ、Timer の state 保持、Counter は再表示時にリセット
- **DOM 並び順**: Counter を再表示しても Timer の前に正しく戻る

## 本家との差分（依然として）

- `key` prop 未対応。リストの並び替えで state を保つ仕組みが無い（インデックスだけで対応づけている）
- スケジューラ無し。setter を呼んだ瞬間に同期 rerender（本家は concurrent mode で優先度制御）
- useEffect 無し。副作用フックとライフサイクルが未実装
- Fragment 無し。`<>...</>` が使えない
- Suspense / Context / useMemo / useRef などの他 hooks 無し

## 次のステップ候補

- **I. useEffect**: 副作用フック。マウント/更新/アンマウントのライフサイクル。差分更新の仕組みと組み合わせて「依存配列が変わったときだけ実行」を実現する
- **F. Fragment**: `<>...</>` のサポート。Symbol 型の `type` に分岐を足すだけの軽め
- **J. key prop**: リストの並び替えで state を保つ。今は index 対応なので並び替えると state がズレる
