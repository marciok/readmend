import type { NextConfig } from "next";
import { withEve } from "eve/next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // a package-lock.json further up the tree would otherwise be picked as the root
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// withEve mounts the link-doctor agent in agent/ at /eve/v1/* (a separate service on the same deployment)
export default withEve(withWorkflow(nextConfig));
