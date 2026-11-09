import { IconClose } from "../components/Icons";

/** Close, at the bottom of a page's category list (Settings, Rules): back to Home. */
export function NavClose({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="settings-link settings-close" onClick={onClose} title="Close: back to Home">
      <IconClose size={16} /><span>Close</span>
    </button>
  );
}
