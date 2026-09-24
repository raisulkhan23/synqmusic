import { useNavigate } from "react-router";
import { SettingsDialog } from "@/components/settings/SettingsDialog";

export default function Settings() {
  const navigate = useNavigate();

  return (
    <SettingsDialog
      open
      pageMode
      onOpenChange={(open) => {
        if (!open) void navigate("/home", { replace: true });
      }}
    />
  );
}
