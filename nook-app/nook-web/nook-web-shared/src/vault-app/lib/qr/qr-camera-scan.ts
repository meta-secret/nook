import { Data, Effect, type Scope } from "effect";
import type {
  QrCodeReader,
  QrCodeReadFailure,
  QrCodeTexts,
} from "./qr-code-reader";

/** The camera could not be opened or its preview could not start playing. */
class QrCameraUnavailable extends Data.TaggedError("QrCameraUnavailable") {}

/** Receives the QR texts found in each scanned camera frame. */
type QrCameraDetection = (texts: QrCodeTexts) => void;

export interface QrCameraScanTarget {
  readonly video: HTMLVideoElement;
  readonly reader: QrCodeReader;
}

interface QrCameraAttempt<Started> {
  readonly try: () => Promise<Started>;
  readonly catch: () => QrCameraUnavailable;
}

/**
 * Scans full-resolution camera frames for QR codes, one frame at a time.
 *
 * The scan owns the camera stream. Interrupting its fiber cancels the pending
 * frame, detaches the preview, and stops every track, including when the
 * interruption arrives while the camera is still opening.
 */
export class QrCameraScan {
  private static readonly CONSTRAINTS: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };

  constructor(private readonly target: QrCameraScanTarget) {}

  run(
    detected: QrCameraDetection,
  ): Effect.Effect<never, QrCameraUnavailable | QrCodeReadFailure> {
    const frame = this.nextFrame().pipe(
      Effect.andThen(() =>
        this.target.reader.readVideoFrame(this.target.video),
      ),
      Effect.andThen((texts) => Effect.sync(() => detected(texts))),
    );
    return Effect.scoped(
      this.open().pipe(
        Effect.andThen((stream) => this.show(stream)),
        Effect.andThen(() => Effect.forever(frame)),
      ),
    );
  }

  private open(): Effect.Effect<MediaStream, QrCameraUnavailable, Scope.Scope> {
    const opening: QrCameraAttempt<MediaStream> = {
      try: () => navigator.mediaDevices.getUserMedia(QrCameraScan.CONSTRAINTS),
      catch: () => new QrCameraUnavailable(),
    };
    return Effect.acquireRelease(Effect.tryPromise(opening), (stream) =>
      this.release(stream),
    );
  }

  private show(
    stream: MediaStream,
  ): Effect.Effect<void, QrCameraUnavailable, Scope.Scope> {
    const playing: QrCameraAttempt<void> = {
      try: () => this.play(stream),
      catch: () => new QrCameraUnavailable(),
    };
    return Effect.acquireRelease(Effect.tryPromise(playing), () =>
      this.hide(stream),
    );
  }

  private play(stream: MediaStream): Promise<void> {
    this.target.video.srcObject = stream;
    return this.target.video.play();
  }

  /**
   * Detaches this scan's stream by replacing it with an empty one. A newer scan
   * may already own the preview after a quick restart; its stream stays.
   */
  private hide(stream: MediaStream): Effect.Effect<void> {
    return Effect.sync(() => {
      switch (this.target.video.srcObject) {
        case stream:
          this.target.video.pause();
          this.target.video.srcObject = new MediaStream();
          return;
        default:
          return;
      }
    });
  }

  private release(stream: MediaStream): Effect.Effect<void> {
    return Effect.sync(() => {
      for (const track of stream.getTracks()) track.stop();
    });
  }

  private nextFrame(): Effect.Effect<void> {
    return Effect.callback<void>((resume) => {
      const frame = requestAnimationFrame(() => resume(Effect.void));
      return Effect.sync(() => cancelAnimationFrame(frame));
    });
  }
}
