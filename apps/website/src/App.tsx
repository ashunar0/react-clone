import { useState } from "myreact";

function App() {
  const [count, setCount] = useState(0);

  const handleClick = () => {
    setCount(count + 1);
  };

  return (
    <div className="app" id="main">
      <h1>Hello</h1>
      <p>count: {count}</p>
      <button className="primary" onClick={handleClick}>
        +1
      </button>
    </div>
  );
}

export default App;
