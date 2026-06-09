import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import { BackOffice } from "./backoffice/BackOffice.tsx";
import "./styles.css";

const isBackOffice = window.location.pathname.startsWith("/admin");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isBackOffice ? <BackOffice /> : <App />}</React.StrictMode>,
);
