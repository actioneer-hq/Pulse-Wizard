import { resolve } from "node:path";
import { loadLocalConfig } from "../config/init.js";
import { validateIntegration } from "../integration/validator.js";
import { PulseClient } from "../pulse/client.js";
import { LOCAL_MOCK_TOKEN, startMockPulseServer } from "../pulse/mock.js";
import { WizardError } from "../util/errors.js";

export async function localCommand(command: string, repoArg: string): Promise<void> {
  const repo = resolve(repoArg);
  if (command === "validate-integration") {
    const result = await validateIntegration(repo);
    process.stdout.write(
      `Integration valid: ${Object.keys(result.fragments).length} mappers, ${result.manifest.artifacts.length} artifact rules\n`,
    );
    return;
  }
  if (command !== "register-integration") throw new WizardError(`unknown command: ${command}`);

  const result = await validateIntegration(repo);
  const config = await loadLocalConfig(repo);
  const mock = config.dev ? await startMockPulseServer() : undefined;
  const pulse = new PulseClient(
    mock?.url ?? config.pulseUrl!,
    mock ? LOCAL_MOCK_TOKEN : config.token!,
    config.org,
  );
  try {
    await pulse.putIntegrationManifest(result.manifest);
    process.stdout.write("Pulse accepted integration manifest\n");
  } finally {
    await mock?.close();
  }
}
