import { useState } from "myreact";

function Counter() {
  const [count, setCount] = useState(0);
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
  const [seconds, setSeconds] = useState(100);
  return (
    <div>
      <p>timer: {seconds}</p>
      <button className="primary" onClick={() => setSeconds(seconds + 1)}>
        +1
      </button>
    </div>
  );
}

function App() {
  const [showCounter, setShowCounter] = useState(true);

  return (
    <div className="app" id="main">
      <h1>Hello</h1>
      <input placeholder="focus & type here, then click something" />
      <button onClick={() => setShowCounter(!showCounter)}>toggle Counter</button>
      {showCounter ? <Counter /> : null}
      <Timer />
    </div>
  );
}

export default App;
