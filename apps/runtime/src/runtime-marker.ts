export function createRuntimeMarker(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "nova-runtime";
  el.textContent = "Rocketcrab Nova runtime origin placeholder";
  return el;
}
