<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import { SelectRootType } from "./select-state";

  type SelectSingleRootProps = Extract<
    SelectPrimitive.RootProps,
    { type: `${SelectRootType.Single}` }
  >;

  let {
    open = $bindable(false),
    value = $bindable(""),
    ...restProps
  }: SelectSingleRootProps = $props();
</script>

<SelectPrimitive.Root bind:open bind:value {...restProps} />
