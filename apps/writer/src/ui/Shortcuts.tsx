import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { isApplePlatform, shortcutLabel, type Command } from "@mdbase-dev/ui/command-palette";
import { Dialog } from "@mdbase-dev/ui/dialog";

export function Shortcuts({ open, onClose, commands }: { open: boolean; onClose(): void; commands: readonly Command[] }) {
  return <Dialog open={open} onClose={onClose} title={t`Keyboard shortcuts`} className="shortcuts-dialog"><ShortcutEntries commands={commands} /></Dialog>;
}

function ShortcutEntries({ commands }: { commands: readonly Command[] }) {
  const entries = [
    ...commands.filter(command => command.shortcut).map(command => command.shortcut === "mod+f" ? { ...command, label: t`Find and replace` } : command),
    { id: "commands", group: t`Help`, label: t`Find or run a command`, shortcut: "mod+k" },
    { id: "help", group: t`Help`, label: t`Keyboard shortcuts outside text fields`, shortcut: "?" },
    ...(!commands.some(command => command.shortcut === "mod+f") ? [{ id: "find", group: t`Editor`, label: t`Find and replace`, shortcut: "mod+f" }] : []),
    { id: "find-next", group: t`Editor`, label: t`Next match`, shortcut: "mod+g" },
    { id: "find-previous", group: t`Editor`, label: t`Previous match`, shortcut: "mod+shift+g" },
    { id: "find-next-function", group: t`Editor`, label: t`Next match`, shortcut: "F3" },
    { id: "find-previous-function", group: t`Editor`, label: t`Previous match`, shortcut: "shift+F3" },
    { id: "select-next", group: t`Editor`, label: t`Select next occurrence`, shortcut: "mod+d" },
    { id: "goto", group: t`Editor`, label: t`Go to line`, shortcut: "mod+alt+g" },
    { id: "rename", group: t`Outline`, label: t`Rename the focused chapter`, shortcut: "F2" },
    { id: "move-up", group: t`Outline`, label: t`Move the focused chapter up`, shortcut: "alt+ArrowUp" },
    { id: "move-down", group: t`Outline`, label: t`Move the focused chapter down`, shortcut: "alt+ArrowDown" },
    { id: "new-line", group: t`Editor`, label: t`Insert a blank line`, shortcut: "mod+Enter" },
    { id: "undo", group: t`Editor`, label: t`Undo`, shortcut: "mod+z" },
    { id: "redo", group: t`Editor`, label: t`Redo`, shortcut: isApplePlatform() ? "mod+shift+z" : "mod+y" },
    ...(/Linux/.test(navigator.platform) ? [{ id: "redo-linux", group: t`Editor`, label: t`Redo`, shortcut: "Ctrl+shift+z" }] : []),
    { id: "complete", group: t`Editor`, label: t`Show completions`, shortcut: isApplePlatform() ? "⌃Space" : "Ctrl+Space" },
    { id: "tab", group: t`Editor`, label: t`Move to the next control`, shortcut: "Tab" },
    { id: "dismiss", group: t`Help`, label: t`Dismiss the current menu or dialog`, shortcut: "Escape" },
  ];
  return <>
    {[...new Set(entries.map(command => command.group))].map(group => <section key={group} className="shortcut-group"><h3>{group}</h3><dl className="shortcuts">
      {entries.filter(command => command.group === group).map(command => <div key={command.id}>
        <dt><kbd>{shortcutLabel(command.shortcut!)}</kbd></dt><dd>{command.label}</dd>
      </div>)}
    </dl></section>)}
    <p><Trans>On the manuscript list, use the arrow keys or J and K, then Enter to open.</Trans></p>
  </>;
}
