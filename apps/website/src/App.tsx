import Greeting from "./components/Greeting.tsx";

function App() {
  return (
    <div className="app" id="main">
      <h1>Hello</h1>
      <Greeting name="佐藤太郎" />
      <button className="primary" onClick={() => alert("clicked!")}>
        送信
      </button>
    </div>
  );
}

export default App;
