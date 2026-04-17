import "./style.css";
import { createElement, render } from "myreact";

const name = "太郎";
const vdom = createElement(
  "div",
  { className: "app" },
  createElement("h1", null, "Hello"),
  createElement("p", null, "Welcome ", name),
);

render(vdom, document.getElementById("root")!);
