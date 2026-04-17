export type VNode = {
  type: string | FunctionComponent;
  props: {
    [key: string]: unknown;
    children: VNodeChild[];
  };
};

export type VNodeChild = VNode | string | number;

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

// useState 用。呼び出し順で箱を特定するので、レンダリング開始時に index=0 にリセット。
const states: unknown[] = [];
let stateIndex = 0;

// 外部公開の render。root をメモしてから内部の renderNode に委譲する。
export function render(vdom: VNode, container: HTMLElement): void {
  rootVNode = vdom;
  rootContainer = container;
  stateIndex = 0;
  renderNode(vdom, container);
}

// state が変化したとき等に呼ぶ。container を空にして root から描き直す（愚直版）。
export function rerender(): void {
  if (!rootVNode || !rootContainer) return;
  stateIndex = 0;
  rootContainer.innerHTML = "";
  renderNode(rootVNode, rootContainer);
}

// 呼び出し順で states の箱を特定する。if/for の中で呼ぶと順番が崩れて壊れる。
export function useState<T>(initial: T): [T, (newValue: T) => void] {
  if (states[stateIndex] === undefined) {
    states[stateIndex] = initial;
  }
  const currentIndex = stateIndex;
  const setState = (newValue: T) => {
    states[currentIndex] = newValue;
    rerender();
  };
  stateIndex++;
  return [states[currentIndex] as T, setState];
}

// 再帰する本体。root はメモしないので子要素の呼び出しで上書きされない。
function renderNode(vdom: VNode, container: HTMLElement): void {
  // 関数コンポーネントなら、呼び出して返ってきた VNode を再 render する
  if (typeof vdom.type === "function") {
    const childVNode = vdom.type(vdom.props);
    renderNode(childVNode, container);
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
  for (const child of vdom.props.children) {
    if (typeof child === "string" || typeof child === "number") {
      el.appendChild(document.createTextNode(String(child)));
    } else {
      renderNode(child, el);
    }
  }

  container.appendChild(el);
}
