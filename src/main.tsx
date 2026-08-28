import React from "react";
import ReactDOM from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <div id="app-root" />
  </React.StrictMode>,
);
