# 03. props を実DOMに反映する

前回まででは `children` しか処理してなかった。`className: "app"` を渡しても DOM の `class` にはならない状態。今回は `render` を拡張して、`className` / `id` / `onClick` などの props を実DOMに反映させる。

## 使うDOM API（3つ）

props を DOM に反映する方法は、大きく分けて3種類ある:

| API                              | 用途               | 例                                      |
| -------------------------------- | ------------------ | --------------------------------------- |
| `el.setAttribute(name, value)`   | HTML属性をセット   | `el.setAttribute("id", "main")`         |
| `el.addEventListener(event, fn)` | イベントを仕掛ける | `el.addEventListener("click", handler)` |
| `el[key] = value`                | プロパティ代入     | `el.disabled = true`                    |

### 属性 (Attribute) とプロパティ (Property) の違い

紛らわしいが別物:

|      | 属性 (Attribute)                | プロパティ (Property)      |
| ---- | ------------------------------- | -------------------------- |
| どこ | HTML の文字列                   | JSオブジェクトのフィールド |
| 型   | 常に文字列                      | 真偽値・数値・関数もOK     |
| API  | `setAttribute` / `getAttribute` | `el.xxx` で直接            |

今回の v1 では `disabled` のような真偽値系も `setAttribute` で統一する（`setAttribute("disabled", "true")` でもブラウザは disabled と解釈してくれる）。プロパティ代入が必要になったら後で分岐を足す。

## props の分類

React的な props にはざっくり4種類のキーが来る:

```ts
createElement("button", {
  className: "primary",      // → class 属性
  id: "submit-btn",          // → 普通の属性
  onClick: () => alert("hi"), // → イベントハンドラ
  children: [...],            // → 既に別ループで処理済み
}, "送信")
```

render 内で `Object.entries(props)` してループしつつ、キーを**4分岐**で仕分ける。

### 分岐ロジック

1. **`key === "children"`** → スキップ（別のループで処理するから）
2. **`key.startsWith("on")` かつ値が関数** → イベントハンドラ。`addEventListener` に渡す
3. **`key === "className"`** → `setAttribute("class", value)`（`class` は JS の予約語なので React は `className` を使う）
4. **それ以外** → `setAttribute(key, value)`

### `onClick` → `"click"` の変換

`addEventListener` は `"click"`, `"input"` みたいな**小文字・`on`なし**の名前を受ける:

```ts
"onClick".slice(2); // "Click"
"onClick".slice(2).toLowerCase(); // "click"
```

- `slice(2)` で先頭の `"on"` を削る
- `toLowerCase()` で全部小文字に（`onClick` の `C` も小文字に）

## 実装

```ts
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
```

## 動作確認

`apps/website/src/main.ts`:

```ts
const vdom = createElement(
  "div",
  { className: "app", id: "main" },
  createElement("h1", null, "Hello"),
  createElement("p", null, "Welcome ", name),
  createElement(
    "button",
    {
      className: "primary",
      onClick: () => alert("clicked!"),
    },
    "送信",
  ),
);

render(vdom, document.getElementById("root")!);
```

ブラウザで:

- `<div class="app" id="main">` と `<button class="primary">` になっている
- ボタンをクリックするとアラートが出る

## 学んだこと

- **属性とプロパティは別物**: HTML文字列の属性と、JSオブジェクトのプロパティは別のレイヤー。多くの場合は同期してるが、常にではない
- **`startsWith`** : 文字列の前方一致チェック。比較演算子 `===` は完全一致しか見れない
- **`Object.entries`** : オブジェクトを `[key, value]` の配列のリストに変換する。`for...of` で分解代入しながら回せる
- **React の `className` の由来**: JS に `class` という予約語があって衝突するから。DOM に降ろすときは `class` に戻す必要がある

## 現時点での制限

- **プロパティ代入は未対応**: `disabled` や `value` などは本来 `el.disabled = true` が自然だが、今は `setAttribute` で統一している
- **イベント名の変換が雑**: `onClick` → `click` はいけるが、`onDoubleClick` → `doubleclick` は間違い（正しくは `dblclick`）。React は内部でマッピングテーブルを持っている
- **再描画未対応**: 一度 `render` したら終わり。state 変化に応じた差分更新はまだ無い

## 次のステップ

次の大きな分岐は:

- **B. JSX を有効にする**: Vite+ のコンパイラ設定で `<div>` 構文を `createElement` に変換させる
- **D. 関数コンポーネントに対応する**: `type` に文字列だけでなく関数も渡せるようにする。`function App() { return createElement(...) }` みたいな形
- **E. state と再描画**: `useState` 的なものを作る。実DOMと VDOM の差分更新（reconciliation）が必要になる

ここまで来ると React の肝の部分に近づいてくる。次回相談。
