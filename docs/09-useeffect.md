# 09. useEffect（副作用フックと commit phase）

ここまでで render（VDOM 作成）→ reconcile（差分を DOM に反映）までは動く。でも「描画が終わった後に何かやりたい」が書けない。`setInterval` を張る、`document.title` を更新する、外部ライブラリを初期化する、WebSocket を繋ぐ──全部 `useEffect` の仕事。

本家 React では render phase（関数コンポーネントを呼んで VDOM を作る）と commit phase（DOM を書き換え、effect を実行する）が明確に分かれている。自作版にもこの二相を入れる。

## 設計の根っこ：なぜ「即実行」ではダメか

`useEffect(fn, deps)` が呼ばれたその場で `fn()` を実行したらどうなるか。

- 呼ばれる場所は **関数コンポーネントの実行中**（= render phase）
- この時点では DOM 更新はまだ走っていない
- render は何度もやり直される可能性がある（本家は concurrent mode で捨てられた render もある）
- → 効果が DOM に反映されていない状態で実行されたり、副作用が複数回走ったりする

だから **「後で実行するリスト」に積んでおき、reconcile が全部終わってからまとめて呼ぶ** 必要がある。これが commit phase。

## 2 種類のデータを持つ

useEffect のために増やしたものは 2 つある。役割が違う。

```ts
// ① hooks[i] に入る「次の render への記憶」
type EffectHook = {
  deps: unknown[] | undefined; // 前回の依存配列（比較用）
  cleanup: (() => void) | undefined; // 前回の effect が return した片付け関数
};

// ② Fiber に生えた「今回の commit で走らせる予約リスト」
type Fiber = {
  ...
  pendingEffects: Array<() => void>; // commit 後に flush される
};
```

分けているのは役割が違うから：

- **①** は **ずっと覚えておく** もの。次の render で「deps が変わったか」を判定するため、そして cleanup を保持するため
- **②** は **その commit 限り** のもの。flush したらクリア

混ざると「deps が変わっていないのに前回の effect をまた実行する」バグが起きる。

## useEffect の判定ロジック

```ts
export function useEffect(effect, deps) {
  const fiber = currentFiber!;
  const i = hookIndex;
  const oldHook = fiber.hooks[i] as EffectHook | undefined;

  const depsChanged = !oldHook || !sameDeps(oldHook.deps, deps);

  if (depsChanged) {
    fiber.pendingEffects.push(() => {
      oldHook?.cleanup?.(); //  前回の片付け
      const cleanup = effect(); //  新しい本体
      fiber.hooks[i] = {
        deps,
        cleanup: typeof cleanup === "function" ? cleanup : undefined,
      };
    });
  }
  hookIndex++;
}
```

3 ケースを 1 本の分岐にまとめている：

| ケース                  | `depsChanged` | 動き                              |
| ----------------------- | ------------- | --------------------------------- |
| a) 初回（oldHook なし） | true          | 本体実行（cleanup は無し）        |
| b) deps 変わった        | true          | 前回の cleanup → 本体実行         |
| c) deps 同じ            | false         | 何もしない（hooks[i] も触らない） |

`pendingEffects` に積むのは「closure で oldHook を掴んだ関数」。commit 時に順番に呼べば、自動的に「前回の cleanup → 新しい本体」になる。

### deps の等価判定

```ts
function sameDeps(a, b) {
  if (a === undefined || b === undefined) return false; // 毎回実行
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

`deps === undefined`（依存配列を書かない）は「毎回実行」。だから常に `false` を返す。一方で `deps === []`（空配列）は長さ 0 同士の比較になって `true` を返す → 初回以外スキップされる。

```tsx
useEffect(() => {...});      // 毎回実行（deps = undefined）
useEffect(() => {...}, []);  // 初回だけ
useEffect(() => {...}, [x]); // x が変わった時だけ
```

`undefined` と `[]` が別物という点、地味に重要。

## commit phase：pendingEffects を flush

```ts
export function rerender() {
  if (!rootVNode || !rootContainer) return;
  rootFiber = reconcile(rootContainer, rootFiber, rootVNode); // render phase
  if (rootFiber) commitEffects(rootFiber); // commit phase
}

function commitEffects(fiber) {
  // 子から先に実行（post-order）
  for (const child of fiber.children) {
    if (child) commitEffects(child);
  }
  for (const effect of fiber.pendingEffects) effect();
  fiber.pendingEffects = [];
}
```

post-order（子 → 親）で走らせるのは本家 React と同じ。子の方が内側の状態、親はそれをまとめる立場。子の mount が終わって DOM が整ってから親の effect が見に行ける順番。

`pendingEffects` は flush のたびに空にする。これをやらないと次の commit で同じ effect が二重に走る。

## unmount 時の cleanup

Fiber を unmount する時、その subtree にある useEffect の cleanup を**全部呼ばないとリークする**。`setInterval` を張ったコンポーネントが消えた後、interval が裏で走り続ける典型ケース。

旧 `unmountFiber` は DOM を外すだけだった。ここに「cleanup を呼ぶ」処理を足す。責務を分けるために 2 つに割った：

```ts
function unmountFiber(fiber, parentDom) {
  runCleanups(fiber);
  removeDoms(fiber, parentDom);
}

function runCleanups(fiber) {
  for (const child of fiber.children) if (child) runCleanups(child); // post-order
  for (const hook of fiber.hooks) {
    if (hook && typeof hook === "object" && "cleanup" in hook) {
      (hook as EffectHook).cleanup?.();
    }
  }
}

function removeDoms(fiber, parentDom) {
  if (fiber.dom) {
    parentDom.removeChild(fiber.dom);
    return;
  }
  for (const child of fiber.children) if (child) removeDoms(child, parentDom);
}
```

`removeDoms` は旧 `unmountFiber` の構造そのまま。「DOM ありの Fiber なら `removeChild` で一気に subtree を外せる」という最適化を残している。でも cleanup は subtree 全体を必ず歩かないといけない（関数コンポーネントは DOM を持たないので、DOM を外しただけでは cleanup が呼ばれない）。だから `runCleanups` は DOM の有無に関わらず常に再帰する。

## 確認したシナリオ

```tsx
function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    document.title = `count: ${count}`;
  }, [count]);
  ...
}

function Timer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  ...
}

function App() {
  const [showTimer, setShowTimer] = useState(true);
  return (
    <div>
      <Counter />
      {showTimer ? <Timer /> : null}
    </div>
  );
}
```

- **初回マウント**: Counter の effect → title が "count: 0" に、Timer の effect → interval 開始
- **+1 ボタン**: Counter の deps [count] が変わり effect 再実行 → title が "count: 1" に。Timer は deps [] なので走らない
- **Timer 消す**: Timer の cleanup が呼ばれて `clearInterval`、seconds の進みが止まる
- **Timer 再表示**: 新規マウントとして Timer の effect が走り直す、seconds は 0 から再スタート

## おまけ：useState が関数 updater を受け付けるようになった

`setInterval` の closure は `[]` で効果が張られた時点の `seconds` を掴みっぱなしになる。`setSeconds(seconds + 1)` では `seconds` が常に初期値になってしまう。本家 React と同じく setter に関数を渡せるようにした。

```ts
const setState = (next: T | ((prev: T) => T)) => {
  const prev = fiber.hooks[i] as T;
  fiber.hooks[i] = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
  rerender();
};
```

関数が渡されたら「最新の値」を引数に呼ぶ。だから `setSeconds((s) => s + 1)` は正しくインクリメントされる。

## 本家との差分（依然として）

- **effect のタイミング**: 本家は `useLayoutEffect`（同期・paint 前）と `useEffect`（非同期・paint 後）を分けている。自作版は `rerender` の末尾で同期実行のみ
- **スケジューラ**: 本家は `scheduler` で優先度を付けて flush。自作版は即時
- **useEffect 以外のフック**: `useRef` / `useMemo` / `useCallback` / `useReducer` / `useContext` など未実装
- **key prop**: リスト diff は依然インデックス対応

## 次のステップ候補

- **F. Fragment**: `<>...</>` のサポート。`type` に Symbol を足すだけの軽め
- **J. key prop**: リストの並び替えで state を保つ。今は index 対応なのでズレる
- **R. useRef**: DOM 参照と「再 render しない値の箱」。useEffect と相性が良い
- **M. useMemo / useCallback**: 計算の memoize。deps の仕組みは useEffect と共通
