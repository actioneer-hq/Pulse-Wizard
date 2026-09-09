import type { Step } from "../flow/step.js";
import * as ui from "../prompts/ui.js";
import { PulseClient } from "../pulse/client.js";

/** Collect the Pulse endpoint + token and confirm the instance is reachable. */
export const connectPulse: Step = {
  id: "connect-pulse",
  title: "Connect to Pulse",
  async run(ctx) {
    const pulseUrl =
      ctx.flags.pulseUrl ??
      (await ui.text({
        message: "Your Pulse endpoint",
        placeholder: "http://localhost:8000",
        validate: (v) =>
          /^https?:\/\//.test(v) ? undefined : "must start with http:// or https://",
      }));

    const token = ctx.flags.token ?? (await ui.password({ message: "Ingest / API token" }));

    const client = new PulseClient(pulseUrl, token);
    const s = ui.spinner();
    s.start("Checking Pulse…");
    const ok = await client.health();
    s.stop(ok ? "Pulse is reachable." : "Pulse health check failed.");

    ctx.pulse = client;
    ctx.pulseUrl = pulseUrl;
    ctx.token = token;
  },
};
