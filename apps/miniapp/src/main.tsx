import React from "react";
import { createRoot } from "react-dom/client";

import { MiniApp } from "./app.tsx";

const container = document.getElementById("root");

if (!container) {
  throw new Error("MiniApp root container was not found.");
}

createRoot(container).render(
  <React.StrictMode>
    <MiniApp />
  </React.StrictMode>
);
