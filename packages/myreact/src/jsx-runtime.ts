import {
  createElement,
  FRAGMENT_TYPE,
  type FunctionComponent,
  type VNode,
  type VNodeChild,
} from "./index.ts";

// automatic runtime が呼ぶ関数。
// `<div>Hello</div>` → `jsx("div", { children: "Hello" }, maybeKey)`
// key は第3引数として渡ってくる（automatic runtime の仕様）。
export function jsx(
  type: string | FunctionComponent | typeof FRAGMENT_TYPE,
  props: Record<string, unknown> & { children?: VNodeChild | VNodeChild[] },
  key?: string | number,
): VNode {
  const { children, ...rest } = props;
  const childArray: VNodeChild[] =
    children === undefined ? [] : Array.isArray(children) ? children : [children];
  const propsWithKey = key !== undefined ? { ...rest, key } : rest;
  return createElement(type, propsWithKey, ...childArray);
}

// 複数の静的 children がある場合にコンパイラが呼ぶ。
// myreact では挙動の違いが無いので jsx と同じ実装でよい。
export const jsxs = jsx;

// `<>...</>` 用。index.ts の reconcile が FRAGMENT_TYPE を認識して扱う。
export { FRAGMENT_TYPE as Fragment };
