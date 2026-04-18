import { useState } from "myreact";

function TableRow({ name, age }: { name: string; age: number }) {
  // `<tr>` の直下に `<td>` を並べたい。`<div>` で囲むと HTML が不正になる。
  return (
    <>
      <td>{name}</td>
      <td>{age}</td>
    </>
  );
}

// 各アイテムに自前の state（input）を持たせる。並び替え時に state が
// key に追従するかどうかの検証用。
function Item({ label }: { label: string }) {
  const [text, setText] = useState("");
  return (
    <li>
      {label}:{" "}
      <input
        value={text}
        onInput={(e: InputEvent) => setText((e.target as HTMLInputElement).value)}
      />
    </li>
  );
}

function KeyDemo() {
  const [items, setItems] = useState([
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ]);
  let nextId = items.length;
  const prepend = () => {
    const id = `x${nextId++}`;
    setItems([{ id, label: id.toUpperCase() }, ...items]);
  };
  const reverse = () => setItems([...items].reverse());

  return (
    <>
      <h2>key demo</h2>
      <p>各 input に文字を入れてから、並び替えボタンを押すと追従するはず。</p>
      <button onClick={prepend}>先頭に追加</button>
      <button onClick={reverse}>逆順にする</button>
      <ul>
        {items.map((it) => (
          <Item key={it.id} label={it.label} />
        ))}
      </ul>
    </>
  );
}

function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <h1>Counter</h1>
      <p>count: {count}</p>
      <button onClick={() => setCount(count + 1)}>+1</button>
      <table>
        <tbody>
          <tr>
            <TableRow name="Alice" age={count} />
          </tr>
          <tr>
            <TableRow name="Bob" age={count * 2} />
          </tr>
        </tbody>
      </table>
      <KeyDemo />
    </>
  );
}

export default App;
