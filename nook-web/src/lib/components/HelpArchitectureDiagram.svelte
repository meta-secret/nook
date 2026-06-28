<script lang="ts">
  let { sectionId }: { sectionId: string } = $props()
</script>

<figure
  class="help-architecture-diagram mt-2 overflow-x-auto rounded-md border border-border/60 bg-background/80 p-3"
  data-testid="help-diagram-{sectionId}"
  aria-label="Architecture diagram: local vault syncs with GitHub and Google Drive"
>
  <svg
    viewBox="0 0 520 220"
    class="mx-auto block h-auto w-full max-w-lg text-foreground"
    role="img"
    aria-hidden="true"
  >
    <defs>
      <marker
        id="help-arrow"
        markerWidth="8"
        markerHeight="8"
        refX="7"
        refY="4"
        orient="auto"
      >
        <path d="M0,0 L8,4 L0,8 Z" class="fill-muted-foreground" />
      </marker>
    </defs>

    <rect
      x="8"
      y="8"
      width="220"
      height="204"
      rx="10"
      class="fill-muted/30 stroke-border"
      stroke-width="1.5"
    />
    <text x="24" y="30" class="fill-muted-foreground text-[11px] font-semibold"
      >This browser (working copy)</text
    >

    <rect
      x="292"
      y="8"
      width="220"
      height="204"
      rx="10"
      class="fill-muted/30 stroke-border"
      stroke-width="1.5"
    />
    <text x="308" y="30" class="fill-muted-foreground text-[11px] font-semibold"
      >Sync providers (replicas)</text
    >

    <rect
      x="36"
      y="52"
      width="164"
      height="40"
      rx="8"
      class="fill-background stroke-border"
      stroke-width="1.5"
    />
    <text
      x="118"
      y="77"
      text-anchor="middle"
      class="fill-foreground text-[12px] font-medium">nook-vault.yaml</text
    >

    <rect
      x="36"
      y="148"
      width="164"
      height="40"
      rx="8"
      class="fill-background stroke-border"
      stroke-width="1.5"
    />
    <text
      x="118"
      y="173"
      text-anchor="middle"
      class="fill-foreground text-[12px] font-medium">Device keys unlock</text
    >

    <rect
      x="320"
      y="72"
      width="164"
      height="40"
      rx="8"
      class="fill-background stroke-border"
      stroke-width="1.5"
    />
    <text
      x="402"
      y="97"
      text-anchor="middle"
      class="fill-foreground text-[12px] font-medium">GitHub</text
    >

    <rect
      x="320"
      y="148"
      width="164"
      height="40"
      rx="8"
      class="fill-background stroke-border"
      stroke-width="1.5"
    />
    <text
      x="402"
      y="173"
      text-anchor="middle"
      class="fill-foreground text-[12px] font-medium">Google Drive</text
    >

    <line
      x1="118"
      y1="128"
      x2="118"
      y2="148"
      class="stroke-muted-foreground"
      stroke-width="1.5"
      marker-end="url(#help-arrow)"
    />

    <line
      x1="200"
      y1="72"
      x2="320"
      y2="92"
      class="stroke-muted-foreground"
      stroke-width="1.5"
      marker-end="url(#help-arrow)"
    />
    <line
      x1="320"
      y1="102"
      x2="200"
      y2="82"
      class="stroke-muted-foreground/70"
      stroke-width="1.5"
      marker-end="url(#help-arrow)"
    />
    <text
      x="260"
      y="78"
      text-anchor="middle"
      class="fill-muted-foreground text-[10px]">version-based sync</text
    >

    <line
      x1="200"
      y1="168"
      x2="320"
      y2="168"
      class="stroke-muted-foreground"
      stroke-width="1.5"
      marker-end="url(#help-arrow)"
    />
    <line
      x1="320"
      y1="178"
      x2="200"
      y2="178"
      class="stroke-muted-foreground/70"
      stroke-width="1.5"
      marker-end="url(#help-arrow)"
    />
    <text
      x="260"
      y="160"
      text-anchor="middle"
      class="fill-muted-foreground text-[10px]">version-based sync</text
    >
  </svg>
</figure>
