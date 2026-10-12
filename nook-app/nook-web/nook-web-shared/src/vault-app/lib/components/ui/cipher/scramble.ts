import type { Action } from "svelte/action";
import { cipherMotionAllowed } from "./cipher-text";

const SCRAMBLE_GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/#%&*<>=";

const SCRAMBLE_FRAMES = 14;
const SCRAMBLE_FRAME_MS = 34;

/**
 * Reveal an element's text by "decrypting" it from random glyphs. The final
 * text is already in the DOM, so screen readers and reduced-motion users get
 * it immediately.
 */
export const scramble: Action<HTMLElement> = (node) => {
  if (!cipherMotionAllowed()) return;
  const final = node.textContent ?? "";
  if (final.length === 0) return;
  const frames = SCRAMBLE_FRAMES;
  let frame = 0;
  const timer = window.setInterval(() => {
    frame += 1;
    const keep = Math.floor((final.length * frame) / frames);
    let next = final.slice(0, keep);
    for (const character of final.slice(keep)) {
      next +=
        character === " " || character === "\n"
          ? character
          : (SCRAMBLE_GLYPHS[
              Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)
            ] ?? character);
    }
    node.textContent = next;
    if (frame >= frames) {
      window.clearInterval(timer);
      node.textContent = final;
    }
  }, SCRAMBLE_FRAME_MS);
  return {
    destroy() {
      window.clearInterval(timer);
      node.textContent = final;
    },
  };
};
