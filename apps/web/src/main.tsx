import React from "react";
import ReactDOM from "react-dom/client";

import { AppServerRoot } from "./AppServerRoot";
import "./index.css";

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const syncColorScheme = () =>
  document.documentElement.classList.toggle("dark", colorScheme.matches);
syncColorScheme();
colorScheme.addEventListener("change", syncColorScheme);

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <AppServerRoot />
  </React.StrictMode>,
);
