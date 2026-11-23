import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { blockPageZoom } from "./noPageZoom";
import "./fonts/fonts.css";
import "./styles.css";

blockPageZoom();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
