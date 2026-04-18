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
    </>
  );
}

export default App;
