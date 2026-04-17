# 07. コンポーネント別 state（Fiber 風）

前回 `useState` をグローバル配列で実装した。単純な例では動くが、**複数コンポーネント**や**条件付きレンダリング**が絡むと壊れる。本家 React は state を各コンポーネントインスタンス（Fiber）に紐付けているので、その簡易版を作る。

## グローバル配列の何が壊れるか

```tsx
function App() {
  const [show, setShow] = useState(true); // states[0]
  return (
    <div>
      {show && <A />} // A の useState は states[1]
      <B /> // B の useState は states[2]
    </div>
  );
}
```

`show` が false になると A は描画されず useState も呼ばれない。すると B のレンダリング時 `stateIndex=1` になり **A の値（states[1]）を B として読んでしまう**。

原因: 「全コンポーネントが1本の配列を共有している」。A の有無で B の index が動く。

## 解決の方向：state を「コンポーネントインスタンス」に紐付ける

各コンポーネントが自分専用の hooks 配列を持てば、他のコンポーネントの有無に影響されない。

本家 React はこれを **Fiber ツリー** でやっている：

```
type Fiber = {
  type, return, child, sibling,
  memoizedState: Hook | null,   // ← このコンポーネントの hooks
  ...
}
```

各 Fiber は「ツリー上のある位置のコンポーネントインスタンス」を表す。hooks はその Fiber の中に連結リストで住む。

render のたびに React は新しい VDOM と前回の Fiber ツリーを並列に歩き、同じ位置・同じ type の Fiber は**再利用**して hooks を引き継ぐ。type が違ったり消えたら破棄（unmount）。

## 我々の簡易版

Fiber の本質は「**インスタンス = ツリー上の位置 × 型**」。最低限これを保持すればいい。

### データ構造

```ts
type Instance = {
  type: FunctionComponent;
  hooks: unknown[];
};

const instances = new Map<string, Instance>();
const touchedPaths = new Set<string>();

let currentInstance: Instance | null = null;
let hookIndex = 0;
```

- `path` は `"0.0.2"` のような「ルートから何番目の子を辿ってきたか」の文字列
- `instances` は `path → Instance` の辞書
- `touchedPaths` は今回 render で到達した path 集合（unmount 検出用）
- `currentInstance` / `hookIndex` は「いま useState はどのインスタンスの何番目か」の追跡

### renderNode で関数コンポーネントを処理する流れ

```ts
if (typeof vdom.type === "function") {
  touchedPaths.add(path);

  // path が同じでも type が違えば別物扱い
  let instance = instances.get(path);
  if (!instance || instance.type !== vdom.type) {
    instance = { type: vdom.type, hooks: [] };
    instances.set(path, instance);
  }

  // ネスト対応：親の状態をスタック保存
  const prevInstance = currentInstance;
  const prevHookIndex = hookIndex;
  currentInstance = instance;
  hookIndex = 0;

  const childVNode = vdom.type(vdom.props);

  currentInstance = prevInstance;
  hookIndex = prevHookIndex;

  renderNode(childVNode, container, `${path}.0`);
  return;
}
```

ポイント:

- **path + type で識別**: 同じ位置でも type が違えば使い回さない
- **prev を保存/復元**: 関数コンポーネントが別の関数コンポーネントを返すネストに対応するため

### useState は currentInstance を見るだけ

```ts
export function useState<T>(initial: T): [T, (newValue: T) => void] {
  if (!currentInstance) throw new Error("useState は関数コンポーネントの中でのみ");
  const instance = currentInstance;
  const currentIndex = hookIndex;
  if (instance.hooks[currentIndex] === undefined) {
    instance.hooks[currentIndex] = initial;
  }
  const setState = (newValue: T) => {
    instance.hooks[currentIndex] = newValue;
    rerender();
  };
  hookIndex++;
  return [instance.hooks[currentIndex] as T, setState];
}
```

setter は `instance` をクロージャで掴む。同じインスタンスオブジェクトは renders 間で使い回される（Map に保持）ので、setter は正しい箱を書き換え続けられる。

### unmount の処理

render の前に `touchedPaths.clear()`、render 中に到達した path を add、render 後に**未到達の path を削除**：

```ts
function renderTree() {
  touchedPaths.clear();
  renderNode(rootVNode, rootContainer, "0");
  for (const path of instances.keys()) {
    if (!touchedPaths.has(path)) instances.delete(path);
  }
}
```

これで `{show && <A />}` が false になった瞬間 A の instance は破棄される。再表示すれば type は合うが instance が無いので**新規作成** → hooks が空 → 初期値で始まる。本家と同じ挙動。

## 確認シナリオ

- **独立動作**: Counter と Timer がそれぞれ増える。互いに影響なし
- **state 保持**: toggle で Counter を消しても Timer の値はそのまま
- **state リセット**: 再表示された Counter は 0 から。前回の値は残らない

## 本家との差分（依然として）

- 位置の識別を文字列 path でやっている（本家は Fiber の親子ポインタ）
- データ構造が Map（本家は連結リスト）
- `key` prop 未対応（リストの並び替えで state を保つ仕組み）
- useEffect 未実装（unmount 時のクリーンアップも無い）
- 再レンダリングは依然として**全消し → 再構築**（reconciliation 未実装）

## 次にやること

差分更新（reconciliation）を実装して、DOM を毎回作り直すのをやめる。これで input のフォーカスが飛んだりスクロールが戻ったりしなくなる。ここが本家 React の最後のコアパーツ。
