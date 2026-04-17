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

  for (const child of vdom.props.children) {
    if (typeof child === "string" || typeof child === "number") {
      el.appendChild(document.createTextNode(String(child)));
    } else {
      render(child, el);
    }
  }

  container.appendChild(el);
}
