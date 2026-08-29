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
import { ipc, type Pane } from "@/lib/ipc";

/**
 * `Ctrl+Q` in a pop-out, and nothing else. The window's own `×` docks the
 * pane back silently — that is the common action and stays one click. This
 * asks only because `Ctrl+Q` is muscle memory for closing the application,
 * and the command is labelled "Quit Riff".
 */
export function PopoutQuitDialog({
  pane,
  open,
  onOpenChange,
}: {
  pane: Pane;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(["nav", "common"]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle>{t("nav:popoutQuit.title")}</DialogTitle>
          <DialogDescription>{t("nav:popoutQuit.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common:cancel")}
          </Button>
          <Button variant="ghost" onClick={() => void ipc.practiceDockBack(pane)}>
            {t("nav:popoutQuit.dockBack")}
          </Button>
          {/* `windowQuitConfirmed`, not `windowClose`: it sets the approval
              flag so `confirmOnQuit` does not raise a second modal for one
              expressed intent, and it closes MAIN — closing this window would
              merely dock the pane back, under a button labelled Quit Riff. */}
          <Button onClick={() => void ipc.windowQuitConfirmed()}>{t("nav:popoutQuit.quit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
