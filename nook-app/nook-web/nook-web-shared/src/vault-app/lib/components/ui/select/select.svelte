<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";

  type SelectSingleRootProps = Extract<
    SelectPrimitive.RootProps,
    { type: "single" }
  >;

  let {
    open = $bindable(false),
    value = $bindable(""),
    ...restProps
  }: SelectSingleRootProps = $props();
</script>

<SelectPrimitive.Root bind:open bind:value {...restProps} />
