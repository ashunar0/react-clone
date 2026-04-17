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

// vdom を実DOMに変換して container に追加する
export function render(vdom: VNode, container: HTMLElement): void {
  // 関数コンポーネントなら、呼び出して返ってきた VNode を再 render する
  if (typeof vdom.type === "function") {
    const childVNode = vdom.type(vdom.props);
    render(childVNode, container);
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
      render(child, el);
    }
  }

  container.appendChild(el);
}
