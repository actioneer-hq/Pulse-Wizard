import type { Step } from "../flow/step.js";
import * as ui from "../prompts/ui.js";
import { PulseClient } from "../pulse/client.js";
import { LOCAL_MOCK_TOKEN, startMockPulseServer } from "../pulse/mock.js";

/** Collect the Pulse endpoint + token and confirm the instance is reachable. */
export const connectPulse: Step = {
  id: "connect-pulse",
  title: "Connect to Pulse",
  async run(ctx) {
    if (ctx.flags.dev) {
      const mock = await startMockPulseServer();
      ctx.pulse = new PulseClient(mock.url, LOCAL_MOCK_TOKEN, ctx.flags.org ?? "default");
      ctx.closePulse = mock.close;
      ui.note("Pulse is reachable.", "Pulse");
      return;
    }
    const pulseUrl =
      ctx.flags.pulseUrl ??
      (await ui.text({
        message: "Your Pulse endpoint",
        placeholder: "http://localhost:8000",
        validate: (v) =>
          /^https?:\/\//.test(v) ? undefined : "must start with http:// or https://",
      }));

    const token = ctx.flags.token ?? (await ui.password({ message: "Agent ingest token" }));
    const org = ctx.flags.org ?? "default";

    const client = new PulseClient(pulseUrl, token, org);
    const s = ui.spinner();
    s.start("Checking Pulse…");
    const ok = await client.health();
    s.stop(ok ? "Pulse is reachable." : "Pulse health check failed.");

    ctx.pulse = client;
    ctx.pulseUrl = pulseUrl;
    ctx.token = token;
  },
};
