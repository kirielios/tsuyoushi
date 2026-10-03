// Keep a sparse checkout of keiyoushi/extensions-source in .upstream/ (git-ignored): build files, the en/id/all
// extension sources, the themes and helper libraries. generate.ts reads from it.
//   npm run upstream
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const DIR = ".upstream/extensions-source";
const REPO = "https://github.com/keiyoushi/extensions-source.git";
const PATHS = ["/LICENSE", "/core/", "/lib/", "/lib-multisrc/", "/src/en/", "/src/id/", "/src/all/", "/src/*/*/build.gradle.kts"];
const git = (...args: string[]) => execFileSync("git", args, { cwd: existsSync(DIR) ? DIR : ".", stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

if (!existsSync(DIR)) {
  execFileSync("git", ["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", REPO, DIR], { stdio: "inherit" });
} else {
  git("fetch", "--quiet", "--depth", "1", "origin", "main");
  git("reset", "--quiet", "--hard", "origin/main");
}
git("sparse-checkout", "set", "--no-cone", ...PATHS);
console.log(`${DIR} at ${git("log", "-1", "--format=%h %cs %s")}`);
