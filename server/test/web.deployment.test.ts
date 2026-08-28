import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function repoFile(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("web production packaging", () => {
  it("builds the independent web project and copies its assets into the server image", async () => {
    const dockerfile = await repoFile("server/Dockerfile");

    expect(dockerfile).toContain("COPY web/package.json web/package-lock.json ./");
    expect(dockerfile).toMatch(/WORKDIR \/app\/web[\s\S]*npm ci[\s\S]*npm run build/);
    expect(dockerfile).toContain("COPY --from=web-build /app/web/dist /app/web");
  });

  it("uses the repository build context and exposes the compiled SPA to the API", async () => {
    const compose = await repoFile("server/docker-compose.yml");

    expect(compose).toMatch(/build:\s*\n\s+context: \.\./);
    expect(compose).toContain("dockerfile: server/Dockerfile");
    expect(compose).toContain("WEB_DIST_PATH: /app/web");
    expect(compose).toContain("WEB_PUBLIC_ORIGIN:");
  });

  it("tests both server and web projects in pull requests", async () => {
    const workflow = await repoFile(".github/workflows/build-and-test.yml");

    expect(workflow).toContain("working-directory: ./server");
    expect(workflow).toContain("working-directory: ./web");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run build");
  });

  it("deploy scripts include both project directories", async () => {
    const powershell = await repoFile("scripts/deploy-server.ps1");
    const bash = await repoFile("scripts/deploy-server.sh");

    expect(powershell).toContain('$webDir = Join-Path $repoRoot "web"');
    expect(powershell).toContain('"$webDir/"');
    expect(powershell).toContain('cp $(Quote-Sh "$remoteDockerDir/.env") $(Quote-Sh "$remoteServerDir/.env")');
    expect(bash).toContain('web_dir="$repo_root/web"');
    expect(bash).toContain('"$web_dir/"');
    expect(bash).toContain('cp $(quote_sh "$remote_docker_dir/.env") $(quote_sh "$remote_server_dir/.env")');
  });
});
