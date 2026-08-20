import React from "react";
import ReactDOM from "react-dom/client";

import { AppServerRoot } from "./AppServerRoot";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <AppServerRoot />
  </React.StrictMode>,
);
