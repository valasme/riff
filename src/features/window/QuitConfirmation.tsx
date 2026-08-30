import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fire, ipc } from "@/lib/ipc";

/**
 * Rust owns the decision: it reads `confirmOnQuit`, cancels the close and
 * emits this event. The frontend only asks the question. Keeping the check in
 * Rust means the setting is honoured even if the webview is wedged.
 */
export function QuitConfirmation() {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const pending = listen("app://confirm-quit", () => setOpen(true));
    return () => void pending.then((off) => off());
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle>{t("quit.title")}</DialogTitle>
          <DialogDescription>{t("quit.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={() => fire(ipc.windowQuitConfirmed(), "quitting")}>
            {t("quit.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
