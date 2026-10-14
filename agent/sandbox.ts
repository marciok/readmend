import { defineSandbox } from "eve/sandbox";
import { VercelSandbox } from "eve/sandbox/vercel";

export const environment = VercelSandbox.environment();

// The agent reads untrusted README text, so its sandbox can only reach GitHub (to clone).
export default defineSandbox(() =>
  environment.open({
    networkPolicy: {
      allow: {
        "github.com": [],
      },
    },
  }),
);
