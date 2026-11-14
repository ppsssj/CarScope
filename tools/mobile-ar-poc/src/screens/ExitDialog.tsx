import { useEffect, useRef } from "react";
import { Button } from "@astryxdesign/core/Button";

export function ExitDialog({
  cancel,
  confirm,
}: {
  cancel: () => void;
  confirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="cb-dialog"
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      aria-labelledby="exit-title"
      aria-describedby="exit-body"
    >
      <h2 id="exit-title" className="cb-h2">
        점검을 그만둘까요?
      </h2>
      <p id="exit-body" className="cb-body-sm">
        확정하지 않은 응답은 남지 않아요. 카메라도 꺼져요.
      </p>
      <div className="cb-dialog-actions">
        <Button
          label="점검 계속하기"
          variant="primary"
          size="lg"
          width="100%"
          onClick={cancel}
        />
        <Button
          label="그만두기"
          variant="ghost"
          size="lg"
          width="100%"
          onClick={confirm}
        />
      </div>
    </dialog>
  );
}
