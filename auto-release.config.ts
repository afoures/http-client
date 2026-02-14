import { define_config } from "@afoures/auto-release";
import { github } from "@afoures/auto-release/platforms";
import { semver } from "@afoures/auto-release/versioning";
import { node } from "@afoures/auto-release/components";

export default define_config({
  projects: {
    "http-client": {
      components: [node(".")],
      changelog: "./CHANGELOG.md",
      versioning: semver(),
    },
  },
  git: {
    platform: github({
      owner: "afoures",
      repo: "http-client",
      token: process.env.GITHUB_TOKEN!,
    }),
  },
});
