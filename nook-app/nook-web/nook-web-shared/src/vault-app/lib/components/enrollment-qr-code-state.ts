import type QRCodeStyling from "qr-code-styling";

export enum QrCodeMountKind {
  Unmounted = "unmounted",
  Mounted = "mounted",
}

export type QrCodeMount =
  | { kind: QrCodeMountKind.Unmounted }
  | { kind: QrCodeMountKind.Mounted; instance: QRCodeStyling };

export enum QrCodeContainerMountKind {
  Unmounted = "unmounted",
  Mounted = "mounted",
}

export type QrCodeContainerMount =
  | { kind: QrCodeContainerMountKind.Unmounted }
  | { kind: QrCodeContainerMountKind.Mounted; element: HTMLDivElement };
