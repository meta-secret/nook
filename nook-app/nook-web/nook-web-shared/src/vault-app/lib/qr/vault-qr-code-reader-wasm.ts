import zxingReaderWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { QrCodeReaderWasm } from "./qr-code-reader-wasm";

/** The vault apps' Vite-emitted copy of the ZXing reader WASM. */
export const vaultQrCodeReaderWasm = new QrCodeReaderWasm(zxingReaderWasmUrl);
