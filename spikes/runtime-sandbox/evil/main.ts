// Origin C: an UNRELATED page that tries to bootstrap the runtime the same
// way the real host would. The runtime must reject it because ev.origin is
// not the host origin. The attempted reply would arrive on port1 — it must
// stay empty.
const RUNTIME_ORIGIN = location.origin.replace(/:\d+$/, ":5274");

const iframe = document.getElementById("runtime-frame") as HTMLIFrameElement;

iframe.onload = () => {
  const channel = new MessageChannel();
  channel.port1.onmessage = (ev: MessageEvent) => {
    (window as unknown as { __received: unknown }).__received = ev.data;
  };
  iframe.contentWindow!.postMessage({ type: "nova:bootstrap", version: 1 }, RUNTIME_ORIGIN, [
    channel.port2,
  ]);
};

iframe.src = `${RUNTIME_ORIGIN}/`;
