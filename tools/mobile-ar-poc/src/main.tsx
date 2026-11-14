import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@astryxdesign/theme-neutral/theme.css";
import "./style.css";
import { transport, informational } from "./session";
import { InfoApp } from "./InfoApp";
import { App } from "./App";
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    transport?.close();
  }
  render() {
    return this.state.failed ? (
      <main className="cb-app cb-main">
        <h1 className="cb-title">화면을 불러오지 못했어요</h1>
        <p className="cb-body">
          카메라와 연결을 끝냈어요. 새 점검을 시작하려면 페이지를 다시 열어
          주세요.
        </p>
        <p className="cb-body">
          <a href="/">처음으로</a>
        </p>
      </main>
    ) : (
      this.props.children
    );
  }
}
addEventListener("hashchange", () => location.reload());
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <Theme theme={neutralTheme} mode="light">
      {informational ? <InfoApp /> : <App />}
    </Theme>
  </Boundary>,
);
