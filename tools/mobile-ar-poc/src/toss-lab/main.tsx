import { createRoot } from "react-dom/client";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./style.css";
import { CameraLab } from "./CameraLab";

// P19 Toss-principles design lab. Separate entry; never imported by the product.
createRoot(document.getElementById("root")!).render(
  <Theme theme={neutralTheme} mode="light">
    <CameraLab />
  </Theme>,
);
