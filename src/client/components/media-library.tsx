import { ImagePickerField, type ImagePickerKind } from "./image-picker";

interface Props {
  kind: ImagePickerKind;
  onPick: (url: string) => void;
  currentUrl?: string;
  compact?: boolean;
}

export function MediaLibrary({ kind, onPick, currentUrl, compact }: Props) {
  void compact;
  return (
    <ImagePickerField
      kind={kind}
      currentUrl={currentUrl}
      label={kind === "backgrounds" ? "Background image" : "Image"}
      buttonLabel={kind === "backgrounds" ? "Choose background" : "Choose image"}
      title={kind === "backgrounds" ? "Choose background" : "Choose image"}
      confirmLabel="OK"
      onPick={onPick}
    />
  );
}
