export type VNode = {
  type: string | FunctionComponent;
  props: {
    [key: string]: unknown;
    children: VNodeChild[];
  };
};

// null / false / undefined は「何も描画しない」。React と同じ挙動。
export type VNodeChild = VNode | string | number | null | boolean | undefined;

// 関数コンポーネント。props を受け取って VNode を返す関数。
export type FunctionComponent<P = Record<string, unknown>> = (props: P) => VNode;

// JSX を使うための最小限の型定義。
declare global {
  namespace JSX {
    type Element = VNode;
    interface IntrinsicElements {
      [elemName: string]: Record<string, unknown>;
    }
  }
}

// vdom を作成する
export function createElement(
  type: string | FunctionComponent,
  props: Record<string, unknown> | null,
  ...children: VNodeChild[]
): VNode {
  return {
    type,
    props: {
      ...props,
      children,
    },
  };
}

// テキストノード（文字列/数値の子）を識別するための一意なマーカー。
// string と被らないよう Symbol にする。
const TEXT_TYPE = Symbol("TEXT");

// Fiber: Fiber 相当。前回描画した内容と対応する DOM、hooks を持つ。
// DOM を作り直さず差分更新するために、前回の姿を保持しておく。
type Fiber = {
  // "div" などの tag、function component、TEXT_TYPE のいずれか。
  type: string | FunctionComponent | typeof TEXT_TYPE;
  // 前回描画した元の値。intrinsic なら VNode、TEXT なら文字列/数値。
  vnode: VNodeChild;
  // 対応する実 DOM。関数コンポーネント自身は DOM を持たないので null。
  dom: Node | null;
  // 子 Fiber。null はその位置に何も描画しない（conditional rendering）。
  children: (Fiber | null)[];
  // 関数コンポーネントの useState の箱。それ以外は空で未使用。
  hooks: unknown[];
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
export function rerender(): void {
  if (!rootVNode || !rootContainer) return;
  rootFiber = reconcile(rootContainer, rootFiber, rootVNode);
}

// 呼び出し順で currentFiber.hooks の箱を特定する。
// if/for の中で呼ぶと順番が崩れて壊れるのは従来どおり。
export function useState<T>(initial: T): [T, (newValue: T) => void] {
  if (!currentFiber) {
    throw new Error("useState must be called inside a function component");
  }
  const fiber = currentFiber;
  const currentIndex = hookIndex;
  if (fiber.hooks[currentIndex] === undefined) {
    fiber.hooks[currentIndex] = initial;
  }
  const setState = (newValue: T) => {
    fiber.hooks[currentIndex] = newValue;
    rerender();
  };
  hookIndex++;
  return [fiber.hooks[currentIndex] as T, setState];
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
    };
  }

  // ここから先は VNode（intrinsic or function component）。
  const vnode = newVNode;

  // 型が同じなら update（DOM 再利用 + props/children 差分）
  if (oldFiber && oldFiber.type === vnode.type) {
    if (typeof vnode.type === "function") {
      return updateFunctionComponent(parentDom, oldFiber, vnode);
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
  };
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

// children の差分。インデックスで対応づけて reconcile、最後に DOM 順を揃える。
function reconcileChildren(
  parentDom: Node,
  oldChildren: (Fiber | null)[],
  newChildren: VNodeChild[],
): (Fiber | null)[] {
  // 新にない余剰の旧 Fiber は unmount
  for (let i = newChildren.length; i < oldChildren.length; i++) {
    const oldFiber = oldChildren[i];
    if (oldFiber) unmountFiber(oldFiber, parentDom);
  }

  const result: (Fiber | null)[] = [];
  for (let i = 0; i < newChildren.length; i++) {
    const oldFiber = oldChildren[i] ?? null;
    const childFiber = reconcile(parentDom, oldFiber, newChildren[i]);
    result.push(childFiber);
  }

  // DOM の並びを fiber の順序と一致させる（insert や再表示で必要）
  reorderChildren(parentDom, result);
  return result;
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

// fiber とその子孫の DOM を parentDom から取り除く。
function unmountFiber(fiber: Fiber, parentDom: Node): void {
  if (fiber.dom) {
    parentDom.removeChild(fiber.dom);
    return;
  }
  // 関数コンポーネント：自身は DOM を持たないので子孫の DOM を再帰で除去
  for (const child of fiber.children) {
    if (child) unmountFiber(child, parentDom);
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
