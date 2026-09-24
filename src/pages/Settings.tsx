import { SettingsDialog } from "@/components/settings/SettingsDialog";

export default function Settings() {
  return (
    <SettingsDialog
      open
      pageMode
      onOpenChange={() => {
        // This is a route, not a dismissible dialog. Radix can still emit an
        // outside-press event when modal={false}; clicking the app around the
        // page must never navigate away from Settings.
      }}
    />
  );
}
