import { mount } from "svelte";
import "$vault-shared/app.css";
import { ensureAppWasm } from "$lib/wasm-bootstrap";

await ensureAppWasm();
const { default: App } = await import("$vault-shared/App.svelte");

mount(App, { target: document.getElementById("app")! });

export default undefined;
