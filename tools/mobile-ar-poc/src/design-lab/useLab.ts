import { useEffect, useReducer } from "react";
import { initial, reduce, taskOf, canConfirm } from "./model";
export function useLab() {
  const [state, dispatch] = useReducer(reduce, initial);
  useEffect(() => {
    if (state.ai !== "busy") return;
    const timer = setTimeout(() => dispatch({ type: "AI_DONE" }), 650);
    return () => clearTimeout(timer);
  }, [state.ai]);
  useEffect(() => {
    document.body.dataset.labStage = state.stage;
    const heading = document.querySelector<HTMLElement>("[data-stage-title]");
    heading?.focus({ preventScroll: true });
    scrollTo(0, 0);
  }, [state.stage]);
  return {
    state,
    dispatch,
    task: taskOf(state),
    canConfirm: canConfirm(state),
  };
}
export type Lab = ReturnType<typeof useLab>;
