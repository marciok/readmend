import { localDev, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

// Only ReadMend's own workflow (same Vercel team, via OIDC) or local dev may start sessions;
// the public site never talks to the agent directly.
export default eveChannel({
  auth: [vercelOidc(), localDev()],
});
