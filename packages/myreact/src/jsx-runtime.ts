import {
  createElement,
  FRAGMENT_TYPE,
  type FunctionComponent,
  type VNode,
  type VNodeChild,
} from "./index.ts";

// automatic runtime が呼ぶ関数。
// `<div>Hello</div>` → `jsx("div", { children: "Hello" })`
// `createElement` と違って children は props の中に入ってくる。
export function jsx(
  type: string | FunctionComponent | typeof FRAGMENT_TYPE,
  props: Record<string, unknown> & { children?: VNodeChild | VNodeChild[] },
): VNode {
  const { children, ...rest } = props;
  const childArray: VNodeChild[] =
    children === undefined ? [] : Array.isArray(children) ? children : [children];
  return createElement(type, rest, ...childArray);
}

// 複数の静的 children がある場合にコンパイラが呼ぶ。
// myreact では挙動の違いが無いので jsx と同じ実装でよい。
export const jsxs = jsx;

// `<>...</>` 用。index.ts の reconcile が FRAGMENT_TYPE を認識して扱う。
export { FRAGMENT_TYPE as Fragment };
