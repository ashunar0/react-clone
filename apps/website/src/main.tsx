import "./style.css";
import { render } from "myreact";

const name = "太郎";
const vdom = (
  <div className="app" id="main">
    <h1>Hello</h1>
    <p>Welcome {name}</p>
    <button className="primary" onClick={() => alert("clicked!")}>
      送信
    </button>
  </div>
);

render(vdom, document.getElementById("root")!);
