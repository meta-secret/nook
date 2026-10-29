import type { Component } from "svelte";

/** One box of a setup step's diagram. */
export type FirstRunDiagramNode = {
  readonly icon: Component;
  readonly label: string;
  readonly testId: string;
  /** The box this step is about; it is filled in. */
  readonly current: boolean;
};

/** A setup step's diagram: its boxes, left to right, and what it shows. */
export type FirstRunDiagramView = {
  readonly label: string;
  readonly testId: string;
  readonly nodes: readonly FirstRunDiagramNode[];
};
