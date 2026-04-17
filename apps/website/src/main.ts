import "./style.css";
import { createElement, render } from "myreact";

const name = "太郎";
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
