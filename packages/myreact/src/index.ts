export type VNode = {
  type: string | FunctionComponent | typeof FRAGMENT_TYPE;
  props: {
    [key: string]: unknown;
    children: VNodeChild[];
  };
  // reconcile 中に同じ兄弟の old/new を対応づけるための識別子。
  // props からは切り出される（コンポーネントからは見えない）。
  key: string | number | null;
};

// null / false / undefined は「何も描画しない」。React と同じ挙動。
export type VNodeChild = VNode | string | number | null | boolean | undefined;

// 関数コンポーネント。props を受け取って VNode を返す関数。
export type FunctionComponent<P = Record<string, unknown>> = (props: P) => VNode;

// JSX を使うための最小限の型定義。
// IntrinsicAttributes は intrinsic / 関数コンポーネント共通で受け取れる特殊 props。
// key はここに置くことで、各コンポーネントの props 型定義に混ぜずに済む。
declare global {
  namespace JSX {
    type Element = VNode;
    interface IntrinsicAttributes {
      key?: string | number;
    }
    interface IntrinsicElements {
      [elemName: string]: Record<string, unknown>;
    }
  }
}

// vdom を作成する
export function createElement(
  type: string | FunctionComponent | typeof FRAGMENT_TYPE,
  props: Record<string, unknown> | null,
  ...children: VNodeChild[]
): VNode {
  const { key, ...rest } = (props ?? {}) as Record<string, unknown> & {
    key?: string | number | null;
  };
  return {
    type,
    props: {
      ...rest,
      children,
    },
    key: key ?? null,
  };
}

// テキストノード（文字列/数値の子）を識別するための一意なマーカー。
// string と被らないよう Symbol にする。
const TEXT_TYPE = Symbol("TEXT");

// Fragment 用の一意なマーカー。DOM を作らず children だけを親に並べる。
// jsx-runtime から import される（`<>...</>` のコンパイル結果で type に入る）。
export const FRAGMENT_TYPE = Symbol("FRAGMENT");

// Fiber: Fiber 相当。前回描画した内容と対応する DOM、hooks を持つ。
// DOM を作り直さず差分更新するために、前回の姿を保持しておく。
type Fiber = {
  // "div" などの tag、function component、TEXT_TYPE、FRAGMENT_TYPE のいずれか。
  type: string | FunctionComponent | typeof TEXT_TYPE | typeof FRAGMENT_TYPE;
  // 前回描画した元の値。intrinsic なら VNode、TEXT なら文字列/数値。
  vnode: VNodeChild;
  // 対応する実 DOM。関数コンポーネント自身は DOM を持たないので null。
  dom: Node | null;
  // 子 Fiber。null はその位置に何も描画しない（conditional rendering）。
  children: (Fiber | null)[];
  // 関数コンポーネントの useState / useEffect の箱。
  // useState は値、useEffect は EffectHook が入る（呼ばれた順のインデックス）。
  hooks: unknown[];
  // reconcile 中に useEffect が積む「後で実行するリスト」。
  // commit phase で flush される。毎 render ごとにリセット。
  pendingEffects: Array<() => void>;
  // 兄弟の中で自分を特定する key。並び替えや削除で DOM/state を保つのに使う。
  // TEXT は常に null（key を持たない）、それ以外は VNode.key を引き継ぐ。
  key: string | number | null;
};

// useEffect が hooks に保存する記憶。次回 render で比較するための deps と、
// 前回の effect が返した cleanup 関数を保持する。
type EffectHook = {
  deps: unknown[] | undefined;
  cleanup: (() => void) | undefined;
};

// rerender() から参照する「頂点」の記録。
let rootVNode: VNode | null = null;
let rootContainer: HTMLElement | null = null;
// 前回の描画ツリー。reconcile の比較基準になる。
let rootFiber: Fiber | null = null;

// useState が所属する関数コンポーネント Fiber の追跡。
let currentFiber: Fiber | null = null;
let hookIndex = 0;

// 外部公開の render。root をメモしてから reconcile で描画する。
export function render(vdom: VNode, container: HTMLElement): void {
  rootVNode = vdom;
  rootContainer = container;
  rerender();
}

// state 更新時などに呼ぶ。前回の rootFiber と新しい rootVNode を diff して
// 必要最小限の DOM 操作で更新する（innerHTML="" で全消しはしない）。
// reconcile（= render phase）が終わってから commit phase で useEffect を flush する。
export function rerender(): void {
  if (!rootVNode || !rootContainer) return;
  rootFiber = reconcile(rootContainer, rootFiber, rootVNode);
  if (rootFiber) commitEffects(rootFiber);
}

// 呼び出し順で currentFiber.hooks の箱を特定する。
// if/for の中で呼ぶと順番が崩れて壊れるのは従来どおり。
// setter は値 or 関数を受け取る（関数の場合は前の値を引数に呼ばれる）。
// setInterval のように古い closure から呼ばれても最新値を反映できる。
export function useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  if (!currentFiber) {
    throw new Error("useState must be called inside a function component");
  }
  const fiber = currentFiber;
  const currentIndex = hookIndex;
  if (fiber.hooks[currentIndex] === undefined) {
    fiber.hooks[currentIndex] = initial;
  }
  const setState = (next: T | ((prev: T) => T)) => {
    const prev = fiber.hooks[currentIndex] as T;
    fiber.hooks[currentIndex] = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
    rerender();
  };
  hookIndex++;
  return [fiber.hooks[currentIndex] as T, setState];
}

// 副作用フック。effect は commit phase（reconcile 後）で実行される。
// deps が前回と変わっていれば、前回の cleanup を呼んでから新しい effect を実行する。
// deps を省略すると毎回実行。deps === [] なら初回のみ。
export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void {
  if (!currentFiber) {
    throw new Error("useEffect must be called inside a function component");
  }
  const fiber = currentFiber;
  const i = hookIndex;
  const oldHook = fiber.hooks[i] as EffectHook | undefined;

  const depsChanged = !oldHook || !sameDeps(oldHook.deps, deps);

  if (depsChanged) {
    fiber.pendingEffects.push(() => {
      // 1. 前回の cleanup（あれば）
      oldHook?.cleanup?.();
      // 2. 新しい effect を実行し、返ってきた cleanup を hooks に記憶
      const cleanup = effect();
      fiber.hooks[i] = {
        deps,
        cleanup: typeof cleanup === "function" ? cleanup : undefined,
      } satisfies EffectHook;
    });
  }

  hookIndex++;
}

// 依存配列の等価判定。deps が undefined なら「毎回実行」扱いで常に false を返す。
// 空配列同士は長さ 0 なので true（= スキップ）になる。
function sameDeps(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Fiber ツリーを post-order で歩き、各 Fiber の pendingEffects を流す。
// 子の effect を親より先に実行する（本家 React と同じ順序）。
function commitEffects(fiber: Fiber): void {
  for (const child of fiber.children) {
    if (child) commitEffects(child);
  }
  for (const effect of fiber.pendingEffects) {
    effect();
  }
  fiber.pendingEffects = [];
}

// 1 ノードの差分処理。旧 Fiber と新 VNode を突き合わせて Fiber を返す。
// 4 ケース: mount / unmount / update / replace。
function reconcile(parentDom: Node, oldFiber: Fiber | null, newVNode: VNodeChild): Fiber | null {
  // null/boolean は「何も描画しない」。旧 Fiber があれば unmount。
  if (newVNode == null || typeof newVNode === "boolean") {
    if (oldFiber) unmountFiber(oldFiber, parentDom);
    return null;
  }

  // 文字列/数値は TEXT ノード。
  if (typeof newVNode === "string" || typeof newVNode === "number") {
    const newText = String(newVNode);
    if (oldFiber && oldFiber.type === TEXT_TYPE) {
      // 同じ TEXT：内容が変わっていれば data だけ書き換え（ノードは再利用）
      const node = oldFiber.dom as Text;
      if (node.data !== newText) node.data = newText;
      oldFiber.vnode = newVNode;
      return oldFiber;
    }
    // 旧が違う型 → unmount してから新規 TEXT ノードを作る
    if (oldFiber) unmountFiber(oldFiber, parentDom);
    const dom = document.createTextNode(newText);
    parentDom.appendChild(dom);
    return {
      type: TEXT_TYPE,
      vnode: newVNode,
      dom,
      children: [],
      hooks: [],
      pendingEffects: [],
      key: null,
    };
  }

  // ここから先は VNode（intrinsic or function component）。
  const vnode = newVNode;

  // 型が同じなら update（DOM 再利用 + props/children 差分）
  if (oldFiber && oldFiber.type === vnode.type) {
    if (typeof vnode.type === "function") {
      return updateFunctionComponent(parentDom, oldFiber, vnode);
    }
    if (vnode.type === FRAGMENT_TYPE) {
      return updateFragment(parentDom, oldFiber, vnode);
    }
    return updateIntrinsic(oldFiber, vnode);
  }

  // 型が違えば replace：旧 unmount → 新 mount
  if (oldFiber) unmountFiber(oldFiber, parentDom);
  return mount(parentDom, vnode);
}

// 新規マウント。DOM を作って parentDom に追加し、Fiber を返す。
function mount(parentDom: Node, vnode: VNode): Fiber {
  if (typeof vnode.type === "function") {
    const fiber: Fiber = {
      type: vnode.type,
      vnode,
      dom: null,
      children: [],
      hooks: [],
      pendingEffects: [],
      key: vnode.key,
    };
    const prevFiber = currentFiber;
    const prevHookIndex = hookIndex;
    currentFiber = fiber;
    hookIndex = 0;
    const returned = vnode.type(vnode.props);
    currentFiber = prevFiber;
    hookIndex = prevHookIndex;
    const childFiber = reconcile(parentDom, null, returned);
    fiber.children = [childFiber];
    return fiber;
  }

  // Fragment: 自身は DOM を持たず、children を parentDom に直接並べる。
  if (vnode.type === FRAGMENT_TYPE) {
    const children: (Fiber | null)[] = [];
    for (const child of vnode.props.children) {
      children.push(reconcile(parentDom, null, child));
    }
    return {
      type: FRAGMENT_TYPE,
      vnode,
      dom: null,
      children,
      hooks: [],
      pendingEffects: [],
      key: vnode.key,
    };
  }

  // intrinsic: DOM を作り、props を適用、children を再帰的にマウント
  const dom = document.createElement(vnode.type);
  updateProps(dom, {}, vnode.props);
  const children: (Fiber | null)[] = [];
  for (const child of vnode.props.children) {
    const childFiber = reconcile(dom, null, child);
    children.push(childFiber);
  }
  parentDom.appendChild(dom);
  return {
    type: vnode.type,
    vnode,
    dom,
    children,
    hooks: [],
    pendingEffects: [],
    key: vnode.key,
  };
}

// Fragment の update。自身は DOM を持たないので parentDom に直接 children を reconcile。
// DOM の並び替えは親（intrinsic）の reorderChildren に任せる。
// collectDoms が dom: null の fiber を再帰で展開してくれるので、
// Fragment の子も親の childNodes として正しく並ぶ。
function updateFragment(parentDom: Node, oldFiber: Fiber, vnode: VNode): Fiber {
  oldFiber.children = diffChildren(parentDom, oldFiber.children, vnode.props.children);
  oldFiber.vnode = vnode;
  return oldFiber;
}

// 関数コンポーネントの update。hooks を引き継いで関数を呼び直し、戻り値を再帰 diff。
function updateFunctionComponent(parentDom: Node, oldFiber: Fiber, vnode: VNode): Fiber {
  const prevFiber = currentFiber;
  const prevHookIndex = hookIndex;
  currentFiber = oldFiber;
  hookIndex = 0;
  const returned = (vnode.type as FunctionComponent)(vnode.props);
  currentFiber = prevFiber;
  hookIndex = prevHookIndex;

  const childFiber = reconcile(parentDom, oldFiber.children[0] ?? null, returned);
  oldFiber.vnode = vnode;
  oldFiber.children = [childFiber];
  return oldFiber;
}

// intrinsic の update。DOM 再利用、props 差分、children 差分。
function updateIntrinsic(oldFiber: Fiber, vnode: VNode): Fiber {
  const dom = oldFiber.dom as HTMLElement;
  const oldProps = (oldFiber.vnode as VNode).props;
  updateProps(dom, oldProps, vnode.props);
  const newChildren = reconcileChildren(dom, oldFiber.children, vnode.props.children);
  oldFiber.vnode = vnode;
  oldFiber.children = newChildren;
  return oldFiber;
}

// children の差分。key があれば key で、なければ index で old/new を対応づける。
// 使われなかった old は unmount、DOM の並びは最後に揃える。
// intrinsic から呼ぶ用。Fragment からは reorder なしの diffChildren を直接呼ぶ
// （並び替えは外側の intrinsic に委ねる）。
function reconcileChildren(
  parentDom: Node,
  oldChildren: (Fiber | null)[],
  newChildren: VNodeChild[],
): (Fiber | null)[] {
  const result = diffChildren(parentDom, oldChildren, newChildren);
  reorderChildren(parentDom, result);
  return result;
}

// key ベースの対応づけと unmount のみ。並び替えは含まない。
function diffChildren(
  parentDom: Node,
  oldChildren: (Fiber | null)[],
  newChildren: VNodeChild[],
): (Fiber | null)[] {
  // old を識別子でマップ化。key 付きは "k:<key>"、無しは "i:<index>" を使って衝突を避ける。
  const oldByKey = new Map<string, Fiber>();
  for (let i = 0; i < oldChildren.length; i++) {
    const fiber = oldChildren[i];
    if (!fiber) continue;
    oldByKey.set(identifierFor(fiber.key, i), fiber);
  }

  // 新を順に舐めて、識別子で old を探す。見つかれば再利用、なければ新規 mount。
  const result: (Fiber | null)[] = [];
  for (let i = 0; i < newChildren.length; i++) {
    const newChild = newChildren[i];
    const id = identifierFor(getVNodeKey(newChild), i);
    const matched = oldByKey.get(id) ?? null;
    if (matched) oldByKey.delete(id);
    result.push(reconcile(parentDom, matched, newChild));
  }

  // 使われなかった old = 削除対象（並び替えで消えた or 本当に消えた）
  for (const leftover of oldByKey.values()) {
    unmountFiber(leftover, parentDom);
  }

  return result;
}

function identifierFor(key: string | number | null, index: number): string {
  return key != null ? `k:${key}` : `i:${index}`;
}

function getVNodeKey(child: VNodeChild): string | number | null {
  if (child == null || typeof child !== "object") return null;
  return child.key;
}

// fiber の並び順に合わせて parentDom の実 DOM 順を揃える。
function reorderChildren(parentDom: Node, children: (Fiber | null)[]): void {
  const expected: Node[] = [];
  for (const fiber of children) {
    if (fiber) collectDoms(fiber, expected);
  }
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i];
    const actual = parentDom.childNodes[i];
    if (actual !== want) {
      parentDom.insertBefore(want, actual ?? null);
    }
  }
}

// fiber の直下にぶら下がる実 DOM を収集（関数コンポーネントは DOM を持たないので子を辿る）
function collectDoms(fiber: Fiber, result: Node[]): void {
  if (fiber.dom) {
    result.push(fiber.dom);
    return;
  }
  for (const child of fiber.children) {
    if (child) collectDoms(child, result);
  }
}

// fiber とその子孫を unmount する。useEffect の cleanup を呼んでから DOM を外す。
function unmountFiber(fiber: Fiber, parentDom: Node): void {
  runCleanups(fiber);
  removeDoms(fiber, parentDom);
}

// Fiber ツリーを post-order で歩き、各 useEffect の cleanup を呼ぶ。
// 子の cleanup を親より先に実行する（mount の逆順）。
function runCleanups(fiber: Fiber): void {
  for (const child of fiber.children) {
    if (child) runCleanups(child);
  }
  for (const hook of fiber.hooks) {
    if (hook && typeof hook === "object" && "cleanup" in hook) {
      const cleanup = (hook as EffectHook).cleanup;
      if (typeof cleanup === "function") cleanup();
    }
  }
}

// fiber とその子孫の DOM を parentDom から取り除く。
function removeDoms(fiber: Fiber, parentDom: Node): void {
  if (fiber.dom) {
    parentDom.removeChild(fiber.dom);
    return;
  }
  // 関数コンポーネント：自身は DOM を持たないので子孫の DOM を再帰で除去
  for (const child of fiber.children) {
    if (child) removeDoms(child, parentDom);
  }
}

// props の差分適用。消えたもの・変わったものだけ DOM を操作する。
function updateProps(
  dom: HTMLElement,
  oldProps: Record<string, unknown>,
  newProps: Record<string, unknown>,
): void {
  // 旧にあって新に無い or 値が変わった → 旧を外す
  for (const key of Object.keys(oldProps)) {
    if (key === "children") continue;
    if (!(key in newProps) || oldProps[key] !== newProps[key]) {
      removeProp(dom, key, oldProps[key]);
    }
  }
  // 新で変わった or 追加された → 新を付ける
  for (const key of Object.keys(newProps)) {
    if (key === "children") continue;
    if (oldProps[key] !== newProps[key]) {
      setProp(dom, key, newProps[key]);
    }
  }
}

function setProp(dom: HTMLElement, key: string, value: unknown): void {
  if (key.startsWith("on") && typeof value === "function") {
    const eventName = key.slice(2).toLowerCase();
    dom.addEventListener(eventName, value as EventListener);
  } else if (key === "className") {
    dom.setAttribute("class", String(value));
  } else {
    dom.setAttribute(key, String(value));
  }
}

function removeProp(dom: HTMLElement, key: string, value: unknown): void {
  if (key.startsWith("on") && typeof value === "function") {
    const eventName = key.slice(2).toLowerCase();
    dom.removeEventListener(eventName, value as EventListener);
  } else if (key === "className") {
    dom.removeAttribute("class");
  } else {
    dom.removeAttribute(key);
  }
}
