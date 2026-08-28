import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { SettingRow } from "@/features/settings/SettingRow";
import { ipc, type StartupRoute } from "@/lib/ipc";
import { PATH_KINDS, pathFor } from "@/lib/paths";
import { useGeneral, useSettings } from "@/stores/settings";

const STARTUP_ROUTES: StartupRoute[] = ["practice", "history", "last-used"];

export function GeneralSection() {
  const { t } = useTranslation(["settings", "common"]);
  const general = useGeneral();
  const patch = useSettings((s) => s.patch);
  const reset = useSettings((s) => s.reset);
  const paths = useSettings((s) => s.paths);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const navigate = useNavigate();

  return (
    <section className="py-2">
      <SettingRow
        label={t("settings:general.startupRoute.label")}
        description={t("settings:general.startupRoute.description")}
        htmlFor="startup-route"
      >
        <select
          id="startup-route"
          className="h-9 rounded-md border border-border-subtle bg-raised px-2 text-sm"
          value={general.startupRoute}
          onChange={(e) =>
            void patch({ general: { startupRoute: e.target.value as StartupRoute } })
          }
        >
          {STARTUP_ROUTES.map((route) => (
            <option key={route} value={route}>
              {t(`settings:general.startupOptions.${route}`)}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        label={t("settings:general.restoreWindow.label")}
        description={t("settings:general.restoreWindow.description")}
        htmlFor="restore-window"
      >
        <Switch
          id="restore-window"
          checked={general.restoreWindowState}
          onCheckedChange={(restoreWindowState) => void patch({ general: { restoreWindowState } })}
        />
      </SettingRow>

      <SettingRow
        label={t("settings:general.confirmOnQuit.label")}
        description={t("settings:general.confirmOnQuit.description")}
        htmlFor="confirm-quit"
      >
        <Switch
          id="confirm-quit"
          checked={general.confirmOnQuit}
          onCheckedChange={(confirmOnQuit) => void patch({ general: { confirmOnQuit } })}
        />
      </SettingRow>

      <div className="border-b border-separator py-4">
        <p className="text-[0.9375rem] font-medium">{t("settings:general.dataLocations.label")}</p>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">
          {t("settings:general.dataLocations.description")}
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {PATH_KINDS.map((kind) => (
            <li key={kind} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm">{t(`settings:general.paths.${kind}`)}</span>
                <code className="ms-2 truncate font-mono text-xs text-muted-foreground">
                  {pathFor(kind, paths)}
                </code>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void ipc.openPath(kind)}>
                {t("common:openFolder")}
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <SettingRow
        label={t("settings:general.importExport.label")}
        description={t("settings:general.importExport.description")}
      >
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              const path = await ipc.settingsExport();
              if (path) toast.success(t("settings:general.exported", { path }));
            }}
          >
            {t("settings:general.export")}
          </Button>
          {/* Guarded, and Reset is too. Import is the more destructive of the
              two — Reset goes to known defaults, Import goes to arbitrary
              values from a file — so leaving it as the unguarded one had it
              backwards. There is no undo for either. */}
          <Button variant="secondary" onClick={() => setConfirmingImport(true)}>
            {t("settings:general.import")}
          </Button>
        </div>
      </SettingRow>

      <SettingRow
        label={t("settings:general.rerunOnboarding.label")}
        description={t("settings:general.rerunOnboarding.description")}
      >
        <Button
          variant="secondary"
          onClick={async () => {
            await reset("onboarding");
            // The guard lives in the root route's beforeLoad, which only runs
            // on navigation. Without this the button clears completedAt and
            // the screen does not change — it looks broken.
            await navigate({ to: "/onboarding" });
          }}
        >
          {t("settings:general.rerunOnboarding.action")}
        </Button>
      </SettingRow>

      <SettingRow
        label={t("settings:general.reset.label")}
        description={t("settings:general.reset.description")}
      >
        <Button variant="secondary" onClick={() => setConfirmingReset(true)}>
          {t("settings:general.reset.action")}
        </Button>
      </SettingRow>

      <Dialog open={confirmingImport} onOpenChange={setConfirmingImport}>
        <DialogContent role="alertdialog">
          <DialogHeader>
            <DialogTitle>{t("settings:general.importConfirm.title")}</DialogTitle>
            <DialogDescription>{t("settings:general.importConfirm.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingImport(false)}>
              {t("common:cancel")}
            </Button>
            <Button
              onClick={async () => {
                setConfirmingImport(false);
                const imported = await ipc.settingsImport();
                if (imported) {
                  useSettings.getState().adopt(imported);
                  toast.success(t("settings:general.imported"));
                }
              }}
            >
              {t("settings:general.import")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingReset} onOpenChange={setConfirmingReset}>
        <DialogContent role="alertdialog">
          <DialogHeader>
            <DialogTitle>{t("settings:general.reset.confirmTitle")}</DialogTitle>
            <DialogDescription>{t("settings:general.reset.confirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingReset(false)}>
              {t("common:cancel")}
            </Button>
            <Button
              onClick={() => {
                void reset();
                setConfirmingReset(false);
              }}
            >
              {t("settings:general.reset.action")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
