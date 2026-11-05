import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { shortcutLabel, type Command } from "@mdbase-dev/ui/command-palette";
import { Dialog } from "./overlays.js";

export function Shortcuts({ open, onClose, commands }: { open: boolean; onClose(): void; commands: readonly Command[] }) {
  return <Dialog open={open} onClose={onClose} title={t`Keyboard shortcuts`} className="shortcuts-dialog">
    <dl className="shortcuts">
      {commands.filter(command => command.shortcut).map(command => <div key={command.id}>
        <dt><kbd>{shortcutLabel(command.shortcut!)}</kbd></dt><dd>{command.label}</dd>
      </div>)}
      <div><dt><kbd>{shortcutLabel("mod+k")}</kbd></dt><dd><Trans>Find or run a command</Trans></dd></div>
    </dl>
    <p><Trans>In the editor, press Tab to move to the next control.</Trans></p>
    <p><Trans>On the manuscript list, use the arrow keys or J and K, then Enter to open.</Trans></p>
  </Dialog>;
}
