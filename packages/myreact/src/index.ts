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
// classic runtime では `<div>` が `createElement("div", ...)` に化けるので、
// IntrinsicElements にタグ名があれば TS は通してくれる。
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

// rerender() から参照する「頂点」の記録。
// 最初の render() 呼び出し時にここにメモしておく。
let rootVNode: VNode | null = null;
let rootContainer: HTMLElement | null = null;

// コンポーネントインスタンス。Fiber の簡易版で、hooks を保持する。
type Instance = {
  type: FunctionComponent;
  hooks: unknown[];
};

// ツリー上の位置（path）をキーに Instance を管理する。
// 例: "0" = root, "0.0" = root の 0 番目の子, "0.0.1" = ...
const instances = new Map<string, Instance>();
// 今回の render で到達した path 集合。render 終了後に未到達のものを削除（unmount）。
const touchedPaths = new Set<string>();

// 「今どのコンポーネントの useState 呼び出しか」の追跡。
let currentInstance: Instance | null = null;
let hookIndex = 0;

// 外部公開の render。root をメモしてから内部の renderNode に委譲する。
export function render(vdom: VNode, container: HTMLElement): void {
  rootVNode = vdom;
  rootContainer = container;
  renderTree();
}

// state が変化したとき等に呼ぶ。container を空にして root から描き直す（愚直版）。
export function rerender(): void {
  if (!rootVNode || !rootContainer) return;
  rootContainer.innerHTML = "";
  renderTree();
}

// render / rerender 共通の手続き。instance 追跡の初期化と unmount 後始末を担う。
function renderTree(): void {
  if (!rootVNode || !rootContainer) return;
  touchedPaths.clear();
  renderNode(rootVNode, rootContainer, "0");
  // 今回 touch しなかった instance は unmount されたとみなして破棄。
  for (const path of instances.keys()) {
    if (!touchedPaths.has(path)) instances.delete(path);
  }
}

// currentInstance.hooks[hookIndex] を自分の箱にする。
// if/for の中で呼ぶと順番が崩れて壊れるのは従来どおり。
export function useState<T>(initial: T): [T, (newValue: T) => void] {
  if (!currentInstance) {
    throw new Error("useState must be called inside a function component");
  }
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

// 再帰する本体。path で instance を引き、function component のときだけ
// currentInstance / hookIndex を切り替える。
function renderNode(vdom: VNode, container: HTMLElement, path: string): void {
  // 関数コンポーネントなら、呼び出して返ってきた VNode を再 render する
  if (typeof vdom.type === "function") {
    touchedPaths.add(path);
    // path が同じでも type が違えば別物扱い（前のは捨てる）
    let instance = instances.get(path);
    if (!instance || instance.type !== vdom.type) {
      instance = { type: vdom.type, hooks: [] };
      instances.set(path, instance);
    }
    // ネストした関数コンポーネントに備えて、親の状態をスタックに積む。
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

  const el = document.createElement(vdom.type);

  // props を DOM 要素に反映する（イベント / class / その他属性）
  for (const [key, value] of Object.entries(vdom.props)) {
    if (key === "children") continue;

    if (key.startsWith("on") && typeof value === "function") {
      const eventName = key.slice(2).toLowerCase();
      el.addEventListener(eventName, value as EventListener);
    } else if (key === "className") {
      el.setAttribute("class", String(value));
    } else {
      el.setAttribute(key, String(value));
    }
  }

  // children を再帰的に処理して実DOMにぶら下げる
  const children = vdom.props.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    // null / false / undefined は何も描画しない（position は消費するので i は進める）
    if (child == null || child === false || child === true) continue;
    if (typeof child === "string" || typeof child === "number") {
      el.appendChild(document.createTextNode(String(child)));
    } else {
      renderNode(child, el, `${path}.${i}`);
    }
  }

  container.appendChild(el);
}
