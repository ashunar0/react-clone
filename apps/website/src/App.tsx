import { useState } from "myreact";

function App() {
  const [count, setCount] = useState(0);

  const handleClick = () => {
    setCount(count + 1);
  };

  return (
    <div>
      <h1>Counter</h1>
      <p>count: {count}</p>
      <button onClick={handleClick}>+1</button>
    </div>
  );
}

export default App;
