// development build 用。oxc の development:true の時に使われる。
// dev 特有の機能（__source, __self など）は未対応なので jsx と同じ実装を再 export。
export { jsx as jsxDEV, Fragment } from "./jsx-runtime.ts";
