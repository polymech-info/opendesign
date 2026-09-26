import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const stage = path.join(root, "dist-site");
const appSrc = path.join(root, "dist/client-web");
const remoteDir = "/var/www/vhosts/polymech.info/httpdocs/apps/opendesign";
const owner = "polymech.info_3eingv1fl98:psacln";

if (!existsSync(path.join(appSrc, "index.html")) || !existsSync(path.join(appSrc, "opend.bundle.js"))) {
  console.error("dist/client-web is missing. Run npm run build:web first.");
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(path.join(stage, "app"), { recursive: true });
cpSync(path.join(root, "web"), stage, { recursive: true });
cpSync(path.join(appSrc, "index.html"), path.join(stage, "app", "index.html"));
cpSync(path.join(appSrc, "opend.bundle.js"), path.join(stage, "app", "opend.bundle.js"));
const bundledIcons = path.join(appSrc, "tabler-icons");
const iconDir = existsSync(bundledIcons)
  ? bundledIcons
  : [
      path.join(root, "dist/tabler-icons"),
      path.resolve(root, "../../packages/tabler-icons/icons/filled"),
    ].find((dir) => existsSync(dir));
if (iconDir) cpSync(iconDir, path.join(stage, "app", "tabler-icons"), { recursive: true });

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { stdio: "inherit", cwd });
  return result.status === 0;
}

const archive = path.join(root, "dist-site.tar");
rmSync(archive, { force: true });
if (!run("tar", ["--force-local", "-cf", "dist-site.tar", "-C", "dist-site", "."], root)) process.exit(1);

// The polymech.info rclone mount is the FTP home at /var/polymech/service, not the public document root.
console.log(`Copying to polymech:${remoteDir}`);
const remoteArchive = "/tmp/opendesign-site.tar";
if (!run("ssh", ["-o", "BatchMode=yes", "polymech", `mkdir -p ${remoteDir}`])) process.exit(1);
if (!run("scp", ["-o", "BatchMode=yes", archive, `polymech:${remoteArchive}`])) process.exit(1);
if (!run("ssh", ["-o", "BatchMode=yes", "polymech", `tar -xf ${remoteArchive} -C ${remoteDir} && rm -f ${remoteArchive}`])) {
  process.exit(1);
}
rmSync(archive, { force: true });

const sitemapLine = "Sitemap: https://polymech.info/apps/opendesign/sitemap.xml";
const robots = "/var/www/vhosts/polymech.info/httpdocs/robots.txt";
const stray = "/var/polymech/service/httpdocs/apps/opendesign";
if (
  !run("ssh", [
    "-o",
    "BatchMode=yes",
    "polymech",
    [
      `chown -R ${owner} ${remoteDir}`,
      `find ${remoteDir} -type d -exec chmod 755 {} +`,
      `find ${remoteDir} -type f -exec chmod 644 {} +`,
      `grep -F '${sitemapLine}' '${robots}' >/dev/null || printf '\\n${sitemapLine}\\n' >> '${robots}'`,
      `rm -rf '${stray}'`,
    ].join(" && "),
  ])
) {
  process.exit(1);
}
