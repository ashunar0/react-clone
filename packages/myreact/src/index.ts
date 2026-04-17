export type VNode = {
  type: string;
  props: {
    [key: string]: unknown;
    children: VNodeChild[];
  };
};

export type VNodeChild = VNode | string | number;

// vdom を作成する
export function createElement(
  type: string,
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
