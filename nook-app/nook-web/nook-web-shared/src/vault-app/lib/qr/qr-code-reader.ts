import { Data, Effect } from "effect";
import type {
  ReaderOptions,
  ReadResult,
  ZXingModuleOverrides,
} from "zxing-wasm/reader";
import zxingReaderWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

/** Texts of the valid QR symbols found in one picture, in reader order. */
export type QrCodeTexts = readonly string[];

enum QrCodeReadFailureKind {
  ReaderUnavailable = "reader-unavailable",
  PictureUnreadable = "picture-unreadable",
}

interface QrCodeReadFailureReason {
  readonly kind: QrCodeReadFailureKind;
}

/** The ZXing reader could not load, or a picture could not be turned into pixels. */
export class QrCodeReadFailure extends Data.TaggedError(
  "QrCodeReadFailure",
)<QrCodeReadFailureReason> {
  static of(kind: QrCodeReadFailureKind): QrCodeReadFailure {
    const reason: QrCodeReadFailureReason = { kind };
    return new QrCodeReadFailure(reason);
  }
}

/** Eager ZXing module preparation; the same overrides object reuses one WASM instance. */
interface QrCodeReaderModuleLoad {
  readonly overrides: ZXingModuleOverrides;
  readonly fireImmediately: true;
}

/** A drawable picture at its native pixel size. */
interface QrCodePicture {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

interface QrCodePictureCopy {
  readonly context: CanvasRenderingContext2D;
  readonly picture: QrCodePicture;
}

interface QrCodeReadAttempt<Read> {
  readonly try: () => Promise<Read>;
  readonly catch: () => QrCodeReadFailure;
}

/**
 * Reads QR symbols from whole pictures with the locally bundled ZXing reader.
 *
 * The reader module and its WASM load on first use. Emscripten requests only
 * `zxing_reader.wasm`, so every lookup resolves to this build's own asset and
 * the package's default CDN is never contacted.
 */
export class QrCodeReader {
  private static readonly MODULE_LOAD: QrCodeReaderModuleLoad = {
    overrides: { locateFile: () => zxingReaderWasmUrl },
    fireImmediately: true,
  };
  private static readonly READER_OPTIONS: ReaderOptions = {
    formats: ["QRCode"],
  };
  private static readonly CANVAS_SETTINGS: CanvasRenderingContext2DSettings = {
    willReadFrequently: true,
  };

  private readonly canvas = document.createElement("canvas");

  readImage(image: Blob): Effect.Effect<QrCodeTexts, QrCodeReadFailure> {
    const decoding: QrCodeReadAttempt<ImageBitmap> = {
      try: () => createImageBitmap(image),
      catch: () =>
        QrCodeReadFailure.of(QrCodeReadFailureKind.PictureUnreadable),
    };
    return Effect.tryPromise(decoding).pipe(
      Effect.andThen((bitmap) => {
        const picture: QrCodePicture = {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
        };
        return this.read(picture).pipe(
          Effect.ensuring(Effect.sync(() => bitmap.close())),
        );
      }),
    );
  }

  readVideoFrame(
    video: HTMLVideoElement,
  ): Effect.Effect<QrCodeTexts, QrCodeReadFailure> {
    const picture: QrCodePicture = {
      source: video,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    return this.read(picture);
  }

  private read(
    picture: QrCodePicture,
  ): Effect.Effect<QrCodeTexts, QrCodeReadFailure> {
    const context = this.canvas.getContext("2d", QrCodeReader.CANVAS_SETTINGS);
    return Effect.fromNullishOr(context).pipe(
      Effect.andThen((drawing) => {
        const copy: QrCodePictureCopy = { context: drawing, picture };
        return Effect.try(() => this.pixels(copy));
      }),
      Effect.mapError(() =>
        QrCodeReadFailure.of(QrCodeReadFailureKind.PictureUnreadable),
      ),
      Effect.andThen((pixels) => this.decode(pixels)),
    );
  }

  /** Resizes, draws, and copies in one synchronous step so reads never interleave. */
  private pixels(copy: QrCodePictureCopy): ImageData {
    const { context, picture } = copy;
    this.canvas.width = picture.width;
    this.canvas.height = picture.height;
    context.drawImage(picture.source, 0, 0);
    return context.getImageData(0, 0, picture.width, picture.height);
  }

  private decode(
    pixels: ImageData,
  ): Effect.Effect<QrCodeTexts, QrCodeReadFailure> {
    const reading: QrCodeReadAttempt<ReadResult[]> = {
      try: () => this.symbols(pixels),
      catch: () =>
        QrCodeReadFailure.of(QrCodeReadFailureKind.ReaderUnavailable),
    };
    return Effect.tryPromise(reading).pipe(
      Effect.map((symbols) =>
        symbols.filter((symbol) => symbol.isValid).map((symbol) => symbol.text),
      ),
    );
  }

  private async symbols(pixels: ImageData): Promise<ReadResult[]> {
    const zxing = await import("zxing-wasm/reader");
    await zxing.prepareZXingModule(QrCodeReader.MODULE_LOAD);
    return zxing.readBarcodes(pixels, QrCodeReader.READER_OPTIONS);
  }
}
