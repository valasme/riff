import { useNavigate } from "@tanstack/react-router";
import { Download, FolderOpen, RotateCcw, Upload, Wand2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingsGroup } from "@/features/settings/SettingRow";
import { fire, ipc, reportFailure, type StartupRoute } from "@/lib/ipc";
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
    <div className="flex flex-col gap-[var(--section-gap)]">
      <SettingsGroup title={t("settings:general.groups.startup")}>
        <SettingRow
          label={t("settings:general.startupRoute.label")}
          description={t("settings:general.startupRoute.description")}
          htmlFor="startup-route"
        >
          {/* Not `<select>`. GTK draws the native popup, so it ignored every
              token here and rendered as light-on-light on the dark themes —
              a control the user could operate but not read. */}
          <Select
            value={general.startupRoute}
            onValueChange={(startupRoute) =>
              void patch({ general: { startupRoute: startupRoute as StartupRoute } })
            }
          >
            <SelectTrigger id="startup-route" className="w-[13rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STARTUP_ROUTES.map((route) => (
                <SelectItem key={route} value={route}>
                  {t(`settings:general.startupOptions.${route}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label={t("settings:general.restoreWindow.label")}
          description={t("settings:general.restoreWindow.description")}
          htmlFor="restore-window"
        >
          <Switch
            id="restore-window"
            checked={general.restoreWindowState}
            onCheckedChange={(restoreWindowState) =>
              void patch({ general: { restoreWindowState } })
            }
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
      </SettingsGroup>

      <SettingsGroup title={t("settings:general.groups.data")}>
        <SettingRow
          label={t("settings:general.dataLocations.label")}
          description={t("settings:general.dataLocations.description")}
          stacked
        >
          <ul className="flex flex-col gap-1.5">
            {PATH_KINDS.map((kind) => (
              <li
                key={kind}
                className="flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-hover ps-3 pe-1.5 py-1.5"
              >
                <span id={`path-${kind}`} className="w-16 shrink-0 text-[0.8125rem] font-medium">
                  {t(`settings:general.paths.${kind}`)}
                </span>
                {/* `dir=ltr` and `text-start`: a path is not prose, and in an
                    RTL locale it must not be reordered around its slashes. */}
                <code
                  dir="ltr"
                  className="min-w-0 flex-1 truncate text-start font-mono text-xs text-muted-foreground"
                >
                  {pathFor(kind, paths)}
                </code>
                {/* Four buttons with the same name is fine when each is
                    described by the row it sits in — the announcement becomes
                    "Open folder, Settings". */}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("common:openFolder")}
                  aria-describedby={`path-${kind}`}
                  onClick={() => fire(ipc.openPath(kind), "opening a folder")}
                >
                  <FolderOpen aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings:general.groups.settingsFile")}>
        <SettingRow
          label={t("settings:general.importExport.label")}
          description={t("settings:general.importExport.description")}
        >
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  const path = await ipc.settingsExport();
                  // `null` means the user cancelled the picker, which is not
                  // a failure and gets no toast either way.
                  if (path) toast.success(t("settings:general.exported", { path }));
                } catch (error) {
                  reportFailure(error, "exporting settings");
                }
              }}
            >
              <Download aria-hidden />
              {t("settings:general.export")}
            </Button>
            {/* Guarded, and Reset is too. Import is the more destructive of the
                two — Reset goes to known defaults, Import goes to arbitrary
                values from a file — so leaving it as the unguarded one had it
                backwards. There is no undo for either. */}
            <Button variant="secondary" onClick={() => setConfirmingImport(true)}>
              <Upload aria-hidden />
              {t("settings:general.import")}
            </Button>
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings:general.groups.reset")}>
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
            <Wand2 aria-hidden />
            {t("settings:general.rerunOnboarding.action")}
          </Button>
        </SettingRow>

        <SettingRow
          label={t("settings:general.reset.label")}
          description={t("settings:general.reset.description")}
        >
          <Button variant="secondary" onClick={() => setConfirmingReset(true)}>
            <RotateCcw aria-hidden />
            {t("settings:general.reset.action")}
          </Button>
        </SettingRow>
      </SettingsGroup>

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
                try {
                  const imported = await ipc.settingsImport();
                  if (imported) {
                    useSettings.getState().adopt(imported);
                    toast.success(t("settings:general.imported"));
                  }
                } catch (error) {
                  // Rust rejects a malformed file — it has a test saying so.
                  // Without this the dialog simply closed and nothing changed,
                  // which reads exactly like a successful import of a file
                  // that happened to match.
                  reportFailure(error, "importing settings");
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
    </div>
  );
}
