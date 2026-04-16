export type VNode = {
  type: string;
  props: {
    [key: string]: unknown;
    children: VNodeChild[];
  };
};

export type VNodeChild = VNode | string | number;

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
