# 10. Fiber と hooks を深掘りする（概念編）

ここまでで自作 React は useEffect まで動くようになった。実装としては次のステップ（F/J/R/M）に進める状態。だけど進む前に、一度「今自分が触っている `Fiber` や `hooks` って本家ではどういう位置づけなんだっけ？」を整理しておきたくなった。会話しながら辿った概念ノート。

このノートは実装を追加しない。代わりに以下を繋げる：

- VDOM と Fiber は何が違うのか
- なぜ hooks は Fiber に住んでいるのか
- 本家は hooks を配列ではなく連結リストで持っているが、なぜか
- なぜ Fiber は 2 本立て（current / workInProgress）なのか
- RSC が複雑なのは hooks の仕様と関係ある、と言われるが本当の正体は何か
- 状態管理の選択肢（signals、jotai、LiveView 等）がそれぞれ何を解決しているのか

---

## 1. VDOM と Fiber は何が違うのか

どちらも「JS オブジェクトの入れ子」で、プロパティに子オブジェクトを入れて木を表す。そこは同じ。違うのは **持っている情報量** と **寿命**。

自作版の App.tsx を例に取る。

```tsx
function App() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <h1>Counter</h1>
      <p>count: {count}</p>
      <button onClick={handleClick}>+1</button>
    </div>
  );
}
```

### VDOM（関数コンポーネントの戻り値）

```js
{
  type: "div",
  props: {
    children: [
      { type: "h1", props: { children: ["Counter"] } },
      { type: "p",  props: { children: ["count: ", 0] } },
      { type: "button", props: { onClick: handleClick, children: ["+1"] } },
    ],
  },
}
```

持っているのは `type` と `props` だけ。関数の実行中に作られて、関数を抜けたら参照が切れて GC される。**毎 render で新品が湧いて出る使い捨ての設計図**。

### Fiber（reconcile が作って `rootFiber` が保持）

```js
{
  type: App,
  vnode: { type: App, props: { children: [] } },
  dom: null,            // 関数コンポーネントは自分の DOM を持たない
  hooks: [0],           // useState(0) の値
  pendingEffects: [],
  children: [
    {
      type: "div",
      vnode: { type: "div", props: {...} },
      dom: <div>,       // 実 DOM への参照
      hooks: [],
      pendingEffects: [],
      children: [ /* h1, p, button の Fiber */ ],
    },
  ],
}
```

VDOM にはなかった `dom` / `hooks` / `pendingEffects` / 子 Fiber への参照が乗っている。そして `rootFiber` 変数から参照されている限り **mount 中ずっと生き続ける**。

### 役割の対比

|                    | VDOM                                   | Fiber                            |
| ------------------ | -------------------------------------- | -------------------------------- |
| 作られるタイミング | 関数コンポーネント実行時に毎回         | mount 時に 1 回                  |
| 寿命               | 次 render で捨てられる                 | unmount まで生存                 |
| `dom` プロパティ   | ない                                   | ある（実 DOM を指す）            |
| `hooks` プロパティ | ない                                   | ある（状態の箱）                 |
| 役割               | 「今こういう UI を描いて」という設計図 | 前回の記録・DOM への橋・状態の箱 |

VDOM は JSX を JS に直訳しただけの薄い紙っぺら。Fiber はアプリが継続的に動くために必要な情報を全部くっつけた厚い台帳。

---

## 2. なぜ Fiber が必要なのか

一言で言うと **関数は呼ばれて終わって何も覚えられないから、関数の外に記憶係が要る**。

`useState(0)` と書いた瞬間に値が永続化される挙動は、普通に考えると不思議。関数は呼ばれるたびに新しい実行コンテキストで始まるので、ローカル変数は毎回初期化される。それでも `count` が値を保持し続けるのは、**「currently executing な Fiber」** が関数の外にいて、そこの `hooks[index]` に値が書き込まれ・読み出されているから。

自作版の実装では `currentFiber` と `hookIndex` がこの役割を担っている（src/index.ts:77-78）。

```ts
let currentFiber: Fiber | null = null;
let hookIndex = 0;

export function useState<T>(initial: T): [...] {
  const fiber = currentFiber!;
  const currentIndex = hookIndex;
  if (fiber.hooks[currentIndex] === undefined) {
    fiber.hooks[currentIndex] = initial;
  }
  // ...
}
```

`useState` が暗黙に頼っているのは「**今どの関数コンポーネントの実行中か**」というランタイム上のコンテキスト。それが `currentFiber`。関数自体はコンテキストを持たないが、実行前に `currentFiber` をセットしておくことで、内部から参照できる仕組みになっている。

この「関数の外のランタイム状態に暗黙に依存する」設計が、あとの RSC の話で効いてくる伏線になる。

---

## 3. hooks はどこに住んでいるか：配列 vs 連結リスト

自作版は `hooks: unknown[]` という配列に、呼ばれた順で値を詰めている。本家 React は Fiber の `memoizedState` から始まる **単方向連結リスト**。ノードの形は概ねこう：

```ts
type Hook = {
  memoizedState: any;
  baseState: any;
  queue: UpdateQueue | null;
  next: Hook | null; // 次のフックへのポインタ
};
```

### なぜ連結リスト？

順序を保って呼ばれた順にアクセスできればいい、という要件だけ見れば配列でも動く。実際、自作版は配列で動いている。hook 数が数個〜数十個のオーダーなら性能差もほぼない。

本家が連結リストを選んだ主な理由は 2 つ：

1. **Fiber アーキテクチャ全体が連結リスト思考で書かれている**。Fiber ノード自体も `child` / `sibling` / `return`（parent）の 3 本のポインタで繋がった構造で、配列ではない。hooks もそれに合わせた、という整合性の話。
2. **各 hook ノードを独立したオブジェクトとして扱いやすい**。後述する double buffering で、current 側の hook ノードと workInProgress 側の hook ノードが `alternate` ポインタで対になる、という扱いがしやすい。配列要素だと「配列 A の 3 番目と配列 B の 3 番目」を index で合わせることになる。

つまり「連結リストじゃないと動かない」という強い理由があるわけではない。**本家の内部設計と整合する選択肢**として連結リストが採用されている、という位置づけ。

### hooks の呼び出し順依存は別の問題

「配列 vs 連結リスト」とは別に、「hooks は呼び出し順で識別される」という設計上の制約がある。これがいわゆる Rules of Hooks（`if` や `for` の中で hooks を呼ぶな）の正体。

```jsx
if (cond) {
  const [x] = useState(0); // NG：cond の真偽で順番が崩れる
}
```

**これは配列でも連結リストでも同じ制約**。どちらも「i 番目は i 番目」で対応づけているだけ。データ構造の選択とは独立したルール。

---

## 4. なぜ Fiber は 2 本立て（current / workInProgress）なのか

本家 React は Fiber を 2 本持っている。これは **double buffering** と呼ばれる。

- `current`：今画面に出ている安定版の Fiber ツリー
- `workInProgress`：今まさに構築中の次の Fiber ツリー

render phase は「current を見ながら workInProgress を新規に組み立てる」作業。全部組み終わって commit したタイミングで `root.current = workInProgress` と付け替える。コピーではなく swap。

### 1 本立てで何が困るか

自作版は Fiber 1 本（`rootFiber`）を使い回している。reconcile の中で `oldFiber.vnode = vnode` のように既存の Fiber オブジェクトを直接書き換えている。

1 本立てでも差分更新は成立している（現に自作版は動いている）。困るのは **render を途中で中断・破棄したいとき**。

本家は Concurrent Rendering という機能で、重い render を途中で止めて優先度の高い仕事（ユーザー入力など）を先に処理し、あとで render を再開・あるいは破棄する、ということをしたい。1 本立てで reconcile 途中に中断すると、書き換え途中の半端な Fiber が残る。そこから再開するのも捨てるのも面倒。

2 本立てなら：

- 作業は全部 workInProgress 側でやる
- 途中で捨てたくなったら workInProgress をまるごと捨てて current はそのまま
- 完成したら swap
- current は常に「安定した最新画面」を表す

画面のダブルバッファリング（裏バッファで次フレームを描いて描き終えてから表バッファと swap）と同じ発想。

### 自作版の位置づけ

自作版は「一度走り始めたら最後まで走り切る」方式なので、1 本立てで成立している。Concurrent を扱わないなら 1 本で十分という判断。ここを 2 本立てにするのは結構な改修になる（Fiber を作り直しながら辿る、alternate ポインタを張る、など）。

---

## 5. RSC が複雑な本当の理由

よく「RSC が難しいのは hooks の順番依存のせい」みたいに語られがちだが、正確には違う。**本当の正体は hooks が Fiber ランタイムに癒着していること**。

### hooks は Fiber なしでは生きられない

`useState` が値を覚えられるのは、実行時に `currentFiber` というランタイム状態を通じて Fiber の `hooks` 配列を読み書きしているから（セクション 2 参照）。

一方、Server Component は以下のように動く：

- サーバー上で関数を 1 回実行
- 結果（VDOM 相当のデータ）をシリアライズしてクライアントに送る
- クライアントは受け取ったデータをそのまま描画する
- **クライアント側で同じ関数は実行されない**

ここでポイント：サーバー側には次の render のための Fiber を持ち続ける理由がない。リクエストが終わればサーバーは解放される。だから `useState` の箱を置いておく場所がない。useEffect のタイミング（commit 後・DOM あり前提）もサーバーには存在しない。

**これが「Server Component では hooks 使えない」の根本的な理由**。順番依存だから、ではなく、状態保持の仕組みが Fiber ランタイムに強く結びついているから。

### "use client" 境界が生まれる理由

解決策として React は「状態が必要な木は Client Component、不要な木は Server Component」という **境界を明示する** 方式を採った。`"use client"` ディレクティブがその境界マーカー。

- Server Component：fetch してデータを埋めた VDOM を作るだけの純関数。`useState` 等は禁止
- Client Component：従来通りの React。hooks フル装備でブラウザで動く

サーバー側で「状態を持つ」路線は選ばなかった。理由は次のセクションの trade-off に続く。

---

## 6. 状態の 2 種類：ビジネスデータ vs UI 状態

「状態」という言葉が指すものが実は 2 種類あって、これを分けて考えないと話が絡まる。

| 分類           | 例                                                   | 同期の必要性                                |
| -------------- | ---------------------------------------------------- | ------------------------------------------- |
| ビジネスデータ | メッセージ、チャット一覧、既読フラグ、ユーザー情報   | サーバー側と同期したい（DB が真実のソース） |
| UI 状態        | 入力中のテキスト、スクロール位置、開閉、選択中のタブ | クライアントごと独立でよい                  |

### LINE のトークルームで見る分け方

LINE のようなリアルタイムアプリで WebSocket が同期しているのは **ビジネスデータ**。

```
サーバー → クライアント1, 2, 3 に push：
{ event: "message_received", data: { from: "asahi", text: "Hello" } }
```

各クライアントが受け取って自分のローカル state に push する。厳密には「状態を共有」しているのではなく「**イベントを配信してクライアント側で state を再構築**」している。

一方、入力中のテキスト・スクロール位置・キーボード開閉などは一切送らない。各クライアント独立。

### サーバーに持てる状態もある

「状態 = クライアントのみ」と言い切ると嘘になる。Cookie / Session の仕組みで「sessionId 経由でサーバーがクライアントごとの状態を持つ」ことは伝統的にやっている（ログイン状態、権限、カート等）。

ただし以下は物理的にクライアントのみ：

- `localStorage` / `sessionStorage`
- `window.innerWidth` / `window.scrollY`
- DOM 要素の参照、active element
- キーボード入力、マウス座標

これらは「**クライアント環境と密結合**」で、サーバー側にコピーを置くとしても本物はクライアント。

### まとめると

- ビジネスデータ：サーバー側に置いて同期（RSC の fetch、WebSocket、等）
- UI 状態：クライアント側で閉じる（useState、signals、atom、等）

RSC が扱いにくいのは後者。前者は従来通りやり方があるので問題にならない。

---

## 7. 各フレームワークの戦略

「サーバー側とクライアント側をどう共存させるか」の解は 1 つではなく、各フレームワークが違う戦略を選んでいる。

| 戦略             | 例                                                | 要点                                               | 弱点                                          |
| ---------------- | ------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| 全部サーバー     | Rails, PHP, Django                                | 真実のソースはサーバー、クライアントは描画するだけ | ページ全体リロード、UX 弱め                   |
| 全部クライアント | 従来の SPA（React, Vue）                          | ブラウザで全部動かす                               | 初期表示遅い、SEO 弱い、データ取得が手作業    |
| SSR              | Next.js 初期、Nuxt 初期                           | サーバーで HTML 生成 → クライアントで hydrate      | hydration mismatch、同じ関数を 2 回実行       |
| RSC              | Next.js App Router                                | Server/Client Component を `"use client"` で分離   | 境界設計の判断、mental model 複雑             |
| LiveView 型      | Phoenix LiveView, Rails Hotwire, Laravel Livewire | サーバー側に state、WebSocket で DOM 差分 push     | 接続切れたら動かない、スケール重い            |
| Resumable        | Qwik                                              | hydration せず、イベントで必要な箇所だけ復元       | 新しい概念学習コスト、エコシステム若い        |
| Islands          | Astro                                             | デフォルト静的 HTML、インタラクティブ部分だけ JS   | インタラクティブが多い SPA 的アプリ向きでない |

どの混ぜ方も何かを犠牲にして何かを得ている。銀の弾丸はない。

### 状態管理ライブラリは何を解決する？

Preact signals や jotai の atom は、hooks の **Fiber 癒着と呼び出し順依存** を解消する。

```ts
// jotai
const countAtom = atom(0); // 関数の外で宣言。呼び出し順に依存しない
```

ただし、これで RSC の根本問題が解決するわけではない。atom / signal もクライアント側のメモリに住んでいる。サーバーからは相変わらず見えない。

つまり：

- hooks の **API の不自由さ**（if/for で呼べない）→ signals/atom で解決
- **細粒度リアクティビティ**（コンポーネント全体が再実行される）→ signals で解決
- **Server Component から state が見えない** → signals/atom でも解決しない。どの道 Client Component 化が必要

signals/atom は RSC を楽にする方向の道具（境界設計しやすくする、Client Component を小さく保つ）ではあるが、RSC の壁そのものを壊す魔法ではない。

---

## 8. 教訓：極端はシンプル、混ぜると複雑

各フレームワークの比較から見えるのは、**両極端（全部サーバー / 全部クライアント）は設計がシンプルで、混ぜると急に複雑になる** というパターン。

- Rails / PHP：サーバーが真実のソース。1 本筋
- 昔の SPA：ブラウザで全部。1 本筋
- SSR / RSC / LiveView：**良いとこ取りを狙って境界を切る必要が出て複雑化**

React が特に重いのは、既に React で書かれた膨大な資産（OSS、プロダクション、採用市場、教材）を捨てずに、サーバー描画の利点を後付けしようとしているから。綺麗に設計し直すなら Qwik や Solid のような選択もあるが、既存の React 資産が地盤として存在する以上、**後方互換性の呪い** と付き合いながら進むしかない。

COBOL から脱出できない、Windows から Mac に移行できない、QWERTY キーボードが最適でないのに使われ続ける、というのと同じ経路依存性。技術的に綺麗か、と、社会的・経済的に選ばれるか、は別問題。

新しいプロジェクトでの技術選定では、「混ぜる複雑さ」を飲む価値があるのか、それとも両極端のどちらかを素直に選ぶのか、を意識できるのは強い。

---

## 9. 自作版との対応

この概念整理を踏まえて、自作版の位置づけを確認しておく。

| 本家の仕組み              | 自作版の状態                                         |
| ------------------------- | ---------------------------------------------------- |
| Fiber ツリー              | 実装済み（`Fiber` 型、`reconcile`）。ただし 1 本立て |
| hooks を Fiber に持つ     | 実装済み（`hooks: unknown[]`）。配列で代用           |
| double buffering          | 未実装                                               |
| Concurrent Rendering      | 未実装（render は一気に最後まで走る）                |
| SSR / RSC                 | 対象外（学習の範囲外）                               |
| useEffect の commit phase | 実装済み（`pendingEffects`）                         |

自作版が「配列の hooks・1 本立ての Fiber」で動くのは、Concurrent も SSR も扱わない割り切りのおかげ。本家の複雑さの多くは Concurrent Rendering と SSR/RSC を支えるためにあると見ていい。

---

## 10. 次のステップ

実装としては引き続き 4 候補から選ぶ：

- **F. Fragment**：`<>...</>` のサポート
- **J. key prop**：リスト差分で state を保つ
- **R. useRef**：DOM 参照と「再 render しない値の箱」
- **M. useMemo / useCallback**：計算の memoize

今回の概念整理はどの分岐にも直接は依存しない横道ノート。続きは通常通り 4 候補のどれかから。
