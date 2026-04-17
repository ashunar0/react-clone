import { useEffect, useState } from "myreact";

function Counter() {
  const [count, setCount] = useState(0);

  // 依存配列あり：count が変わるたびに document.title を更新。
  useEffect(() => {
    console.log(`[Counter effect] count = ${count}`);
    document.title = `count: ${count}`;
  }, [count]);

  return (
    <div>
      <p>count: {count}</p>
      <button className="primary" onClick={() => setCount(count + 1)}>
        +1
      </button>
    </div>
  );
}

function Timer() {
  const [seconds, setSeconds] = useState(0);

  // 依存配列 []：マウント時に 1 回だけ setInterval を張り、unmount で cleanup。
  useEffect(() => {
    console.log("[Timer effect] start interval");
    const id = setInterval(() => {
      setSeconds((s: number) => s + 1);
    }, 1000);
    return () => {
      console.log("[Timer cleanup] clear interval");
      clearInterval(id);
    };
  }, []);

  return (
    <div>
      <p>timer: {seconds}s</p>
    </div>
  );
}

function App() {
  const [showTimer, setShowTimer] = useState(true);

  return (
    <div className="app" id="main">
      <h1>useEffect demo</h1>
      <input placeholder="focus & type here, then click something" />
      <button onClick={() => setShowTimer(!showTimer)}>toggle Timer</button>
      <Counter />
      {showTimer ? <Timer /> : null}
    </div>
  );
}

export default App;
