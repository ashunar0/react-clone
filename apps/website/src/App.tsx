import { useState } from "myreact";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button className="primary" onClick={() => setCount(count + 1)}>
      count: {count}
    </button>
  );
}

function Timer() {
  const [seconds, setSeconds] = useState(100);
  return (
    <button className="primary" onClick={() => setSeconds(seconds + 1)}>
      timer: {seconds}
    </button>
  );
}

function App() {
  const [showCounter, setShowCounter] = useState(true);

  return (
    <div className="app" id="main">
      <h1>Hello</h1>
      <button onClick={() => setShowCounter(!showCounter)}>toggle Counter</button>
      {showCounter ? <Counter /> : null}
      <Timer />
    </div>
  );
}

export default App;
