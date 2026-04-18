# 12. key prop（並び替えで state / DOM を保つ）

リストを並び替えた時に、各要素の state や DOM の内部状態（input の値、focus、scroll 位置など）が「要素と一緒に」動いて欲しい。index 対応ではそれができない。key はその対応づけを明示する仕組み。

## なぜ必要か：index 対応だと state が位置にくっつく

今までの `reconcileChildren` は `oldChildren[i]` と `newChildren[i]` を index で対応づけていた。

```
old: [A, B, C]         ← A の input に "hello" と入力済み
new: [Z, A, B, C]      ← Z を先頭に追加
```

index 対応だと：

- 新 `[0]` (Z) → old `[0]` (A) の fiber と DOM を再利用する
- 新 `[1]` (A) → old `[1]` (B) の fiber と DOM を再利用する
- ...

結果、**Z の行に "hello" が残る**。fiber に紐づく state も、実 DOM に残る入力値も、全部 1 つずつズレる。これは「要素は論理的に同じなのに、位置が変わっただけ」というケースを表現できていないから。

## 仕組み：識別子を明示する

key は開発者が書く側で「この要素の論理的 ID」を指定する。reconcile はそれを使って old/new を対応づける。

```
old: [{key:A}, {key:B}, {key:C}]
new: [{key:Z}, {key:A}, {key:B}, {key:C}]
```

`key=A` の old fiber は `key=A` の new と対応する。DOM は位置 0 から位置 1 へ移動するが、fiber と DOM 実体は同じものが引き継がれる。→ state も input の値も A についていく。

## 実装の 4 つのピース

### ① VNode / Fiber に key フィールドを生やす

key は props には含めない。子コンポーネント側からは見えない、reconcile 専用の hint だから。

```ts
type VNode = {
  type: ...;
  props: {...};
  key: string | number | null;  // ← props から切り出す
};
```

`createElement` で props から `key` を抜き出して別フィールドに：

```ts
const { key, ...rest } = props ?? {};
return { type, props: { ...rest, children }, key: key ?? null };
```

jsx-runtime（automatic runtime）では key は **第 3 引数** として渡ってくる仕様なので、そちらでも同様に処理する。

Fiber にも `key` を持たせる。reconcile 時に「old fiber の key」を参照したいから。

### ② diffChildren: key ベースの対応づけ

元々の index ベースのループを、Map lookup に変える：

```ts
function diffChildren(parentDom, oldChildren, newChildren) {
  // old を識別子でマップ化。key 付きは "k:<key>"、なしは "i:<index>" を使って衝突を避ける
  const oldByKey = new Map<string, Fiber>();
  for (let i = 0; i < oldChildren.length; i++) {
    const fiber = oldChildren[i];
    if (!fiber) continue;
    oldByKey.set(identifierFor(fiber.key, i), fiber);
  }

  // 新を順に舐めて、識別子で old を探す
  const result: (Fiber | null)[] = [];
  for (let i = 0; i < newChildren.length; i++) {
    const newChild = newChildren[i];
    const id = identifierFor(getVNodeKey(newChild), i);
    const matched = oldByKey.get(id) ?? null;
    if (matched) oldByKey.delete(id);
    result.push(reconcile(parentDom, matched, newChild));
  }

  // 使われなかった old = 削除対象
  for (const leftover of oldByKey.values()) {
    unmountFiber(leftover, parentDom);
  }

  return result;
}
```

ポイント 3 つ：

- **`k:<key>` と `i:<index>` で prefix を分ける**: key 付き要素と key なし要素が混ざっても衝突しない（`key="0"` と index 0 を別物として扱える）
- **使った old を Map から delete**: 残った old は「消えた要素」として最後に unmount
- **reorder は呼ばない**: diffChildren は「対応づけ + unmount」だけ。並び替えは呼び出し側の責務

### ③ reconcileChildren: intrinsic 用のラッパー

intrinsic 要素の children は、diff したあと DOM も並び替える必要がある：

```ts
function reconcileChildren(parentDom, oldChildren, newChildren) {
  const result = diffChildren(parentDom, oldChildren, newChildren);
  reorderChildren(parentDom, result);
  return result;
}
```

### ④ updateFragment: reorder なし版を使う

Fragment は自身 DOM を持たないので、reorder は外側の intrinsic に任せる。だから `diffChildren` を直接呼ぶ：

```ts
function updateFragment(parentDom, oldFiber, vnode) {
  oldFiber.children = diffChildren(parentDom, oldFiber.children, vnode.props.children);
  oldFiber.vnode = vnode;
  return oldFiber;
}
```

これで Fragment の children も key で対応づくし、Fragment 内部で勝手に DOM を動かして親の並びを壊すこともない。

## なぜ reorder を分けたか

試しに updateFragment から reconcileChildren（reorder 付き）を呼ぶと、次のような事故が起きる：

```tsx
<ul>
  <li>before</li>
  <>
    <li>A</li>
    <li>B</li>
  </>
  <li>after</li>
</ul>
```

Fragment の reorderChildren は `parentDom = <ul>` の childNodes を **0 番目から** Fragment の children 順に揃えようとする。つまり「外側の兄弟 `<li>before</li>` や `<li>after</li>` の存在」を無視して先頭から詰める。間違った中間状態になる。

親の intrinsic（`<ul>`）側の reorder が最終的に直してくれるので壊れはしないが、無駄な DOM 操作が走る。

「**並び替えの責任は DOM を持つ fiber にある**」という原則を守るために、diffChildren と reorderChildren を分けた。

## 動作確認

```tsx
function Item({ label }: { label: string }) {
  const [text, setText] = useState("");
  return (
    <li>
      {label}:{" "}
      <input
        value={text}
        onInput={(e: InputEvent) => setText((e.target as HTMLInputElement).value)}
      />
    </li>
  );
}

function KeyDemo() {
  const [items, setItems] = useState([
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ]);
  // prepend / reverse ボタン
  return (
    <ul>
      {items.map((it) => (
        <Item key={it.id} label={it.label} />
      ))}
    </ul>
  );
}
```

Playwright で確認：

- A に "hello-A"、B に "world-B" を入力
- 「逆順にする」→ DOM は `[C, B, A]` に並び替わり、B の input は "world-B"、A の input は "hello-A" のまま → **state と input の値が key に追従**
- 「先頭に追加」→ `[X3, C, B, A]` になり、X3 の input は空（新規 mount）、A/B/C の値は保持

## 本家との差分

骨格は同じ（key でマッチング → 再利用 → 使われなかった old は削除 → DOM 並び替え）。違いは：

- **2 パス方式**: 本家はまず「頭から順番通り」を試して、違いが出たところから Map 化に切り替える。並び替えがないケース（ほとんどのパターン）を高速化
- **`lastPlacedIndex` による移動検出**: 本家は直前に置いた old fiber の index を覚えて、逆行する fiber だけ `insertBefore` を呼ぶ。俺らの `reorderChildren` は毎回全部順に揃える
- **Fragment への key**: `<Fragment key="...">` や `<> </>` ではなく `<React.Fragment key="...">` でリスト要素にできる。自作版は未対応

学習目的としては骨格が見えれば十分。最適化は本家のソース読むときに戻ってくる話。

## 次のステップ候補

- **R. useRef**: DOM 参照と「再 render しない値の箱」。useEffect と相性良い
- **M. useMemo / useCallback**: 計算の memoize。deps の仕組みは useEffect と共通
- **U. useContext**: ツリーを降るデータ伝搬。関数コンポーネントの fiber とセットで設計すると面白い
