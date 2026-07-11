import type { Component } from 'svelte'
import HelloNook from './hello-nook/Experiment.svelte'

export interface ExperimentProps {
  navigate: (path: string) => void
}

export interface Experiment {
  slug: string
  title: string
  description: string
  component: Component<ExperimentProps>
}

export const experiments: Experiment[] = [
  {
    slug: 'hello-nook',
    title: 'Hello, Nook',
    description:
      'A minimal first sketch showing the independent experiment pattern.',
    component: HelloNook,
  },
]
