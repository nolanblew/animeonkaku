import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ApiError } from "../api/errors.js";
import { MUSIC_SEARCH_MODES, type MusicSearchMode, type MusicSearchSettingsDto } from "../music/settings/types.js";

export interface MusicSearchSettingsApi {
  getSettings(): Promise<MusicSearchSettingsDto>;
  updateMode(mode: MusicSearchMode): Promise<MusicSearchSettingsDto>;
}

const loginBody = z.object({ password: z.string().min(1).max(200) }).strict();
const settingsBody = z.object({ mode: z.enum(MUSIC_SEARCH_MODES) }).strict();
const COOKIE_NAME = "admin_session";

export function registerAdminRoutes(
  fastify: FastifyInstance,
  settings: MusicSearchSettingsApi,
  password: string,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const sessions = new Set<string>();
  const authenticated = (request: FastifyRequest) => {
    const token = parseCookies(request.headers.cookie ?? "").get(COOKIE_NAME);
    return token !== undefined && sessions.has(token);
  };
  const requireAdmin = async (request: FastifyRequest) => {
    if (!authenticated(request)) throw new ApiError(401, "ADMIN_AUTH_REQUIRED", "Admin authentication required.");
  };

  app.get("/admin/login", async (request, reply) => {
    if (authenticated(request)) return reply.redirect("/admin");
    return reply.type("text/html; charset=utf-8").send(loginPage());
  });

  app.post("/admin/login", { schema: { body: loginBody } }, async (request, reply) => {
    if (!sameSecret(request.body.password, password)) {
      throw new ApiError(401, "ADMIN_LOGIN_FAILED", "Incorrect password.");
    }
    const token = randomBytes(32).toString("base64url");
    sessions.add(token);
    return reply
      .header("Set-Cookie", `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200`)
      .code(204)
      .send();
  });

  app.post("/admin/logout", { preHandler: requireAdmin }, async (request, reply) => {
    const token = parseCookies(request.headers.cookie ?? "").get(COOKIE_NAME);
    if (token) sessions.delete(token);
    return reply.header("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`).code(204).send();
  });

  app.get("/admin", async (request, reply) => {
    if (!authenticated(request)) return reply.redirect("/admin/login");
    return reply.type("text/html; charset=utf-8").send(settingsPage(await settings.getSettings()));
  });

  app.get("/api/v1/admin/music/settings", { preHandler: requireAdmin }, async () => ({ settings: await settings.getSettings() }));
  app.put(
    "/api/v1/admin/music/settings",
    { schema: { body: settingsBody }, preHandler: requireAdmin },
    async (request) => ({ settings: await settings.updateMode(request.body.mode) }),
  );
}

function sameSecret(candidate: string, expected: string): boolean {
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function parseCookies(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

function loginPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Anime Ongaku Admin</title><style>${sharedStyles()}
  .login-shell{min-height:100vh;display:grid;place-items:center;padding:24px}.login-card{width:min(430px,100%);padding:38px}.brand-mark{width:54px;height:54px;border-radius:17px;background:linear-gradient(145deg,#ff8eb4,#9d7cff);display:grid;place-items:center;box-shadow:0 14px 38px #a774ff55;font-size:25px;margin-bottom:24px}.login-card h1{font-size:30px;margin:0 0 9px}.login-card p{color:var(--muted);margin:0 0 28px}.field-label{display:block;font-size:13px;font-weight:700;margin-bottom:8px}.password{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:14px;background:#171827;color:var(--text);font:inherit;padding:14px 16px;outline:none}.password:focus{border-color:#b595ff;box-shadow:0 0 0 3px #a676ff22}.primary{width:100%;margin-top:16px}.error{height:20px;color:#ff9daf;font-size:13px;margin-top:12px}</style></head>
  <body><main class="login-shell"><section class="panel login-card"><div class="brand-mark">♫</div><h1>Anime Ongaku Admin</h1><p>Sign in to manage server discovery and catalog behavior.</p><form id="login"><label class="field-label" for="password">Admin password</label><input class="password" id="password" type="password" autocomplete="current-password" autofocus required><button class="button primary" type="submit">Open admin</button><div id="error" class="error" role="alert"></div></form></section></main>
  <script>document.getElementById('login').addEventListener('submit',async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');const o=b.textContent;b.disabled=true;b.textContent='Signing in…';document.getElementById('error').textContent='';const r=await fetch('/admin/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value})});if(r.ok){location.href='/admin';return}document.getElementById('error').textContent='That password is not correct.';b.disabled=false;b.textContent=o})</script></body></html>`;
}

function settingsPage(settings: MusicSearchSettingsDto): string {
  const options: Array<{ mode: MusicSearchMode; title: string; description: string; icon: string }> = [
    { mode: "MANUAL", title: "Manually", description: "Only search when you use the debug request button on an anime.", icon: "⌁" },
    { mode: "FAVORITES", title: "Users’ favorites only", description: "Automatically search anime connected to a liked theme or full song.", icon: "♥" },
    { mode: "PLAYLISTS", title: "Users’ playlists", description: "Automatically search anime represented in user-created and smart playlists.", icon: "≡" },
    { mode: "EVERYTHING", title: "Everything in users’ libraries", description: "Automatically search every mapped anime explicitly saved to a user library.", icon: "✦" },
  ];
  const cards = options.map((option) => `<label class="mode-card"><input type="radio" name="mode" value="${option.mode}"${option.mode === settings.mode ? " checked" : ""}><span class="radio-dot"></span><span class="mode-icon">${option.icon}</span><span><strong>${option.title}</strong><small>${option.description}</small></span></label>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Music settings · Anime Ongaku</title><style>${sharedStyles()}
  .shell{max-width:1050px;margin:0 auto;padding:28px 24px 60px}.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:46px}.brand{display:flex;align-items:center;gap:13px;font-weight:800}.brand-mark{width:40px;height:40px;border-radius:13px;background:linear-gradient(145deg,#ff8eb4,#9d7cff);display:grid;place-items:center;box-shadow:0 10px 28px #a774ff44}.eyebrow{color:#c6a9ff;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px}.hero h1{font-size:clamp(32px,6vw,52px);line-height:1.05;margin:0 0 14px;letter-spacing:-.04em}.hero p{color:var(--muted);font-size:17px;line-height:1.6;max-width:690px;margin:0}.content{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:22px;margin-top:34px}.settings-card{padding:28px}.settings-card h2{font-size:18px;margin:0 0 6px}.intro{color:var(--muted);margin:0 0 22px;font-size:14px}.modes{display:grid;gap:11px}.mode-card{position:relative;display:grid;grid-template-columns:20px 42px 1fr;align-items:center;gap:13px;padding:17px;border:1px solid var(--border);border-radius:17px;cursor:pointer;transition:.18s ease;background:#151624}.mode-card:hover{transform:translateY(-1px);border-color:#6f6686}.mode-card:has(input:checked){border-color:#b08cff;background:linear-gradient(120deg,#231d36,#181729);box-shadow:0 0 0 1px #b08cff33 inset}.mode-card input{position:absolute;opacity:0}.radio-dot{width:16px;height:16px;border-radius:50%;border:2px solid #625f74;box-sizing:border-box}.mode-card:has(input:checked) .radio-dot{border:5px solid #b08cff}.mode-icon{width:40px;height:40px;border-radius:12px;background:#242337;display:grid;place-items:center;color:#e7d9ff;font-size:18px}.mode-card strong{display:block;font-size:15px;margin-bottom:4px}.mode-card small{display:block;color:var(--muted);line-height:1.45}.actions{display:flex;align-items:center;gap:14px;margin-top:22px}.actions .button{min-width:150px}.save-status{font-size:13px;color:var(--muted)}.sidebar{display:grid;align-content:start;gap:14px}.side-card{padding:20px}.side-card h3{font-size:14px;margin:0 0 9px}.side-card p{color:var(--muted);font-size:13px;line-height:1.55;margin:0}.always{border-color:#5b4877;background:linear-gradient(145deg,#1d192b,#161724)}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#80e2b2;box-shadow:0 0 10px #80e2b2;margin-right:7px}.logout{border:0;background:transparent;color:var(--muted);cursor:pointer;font:inherit;font-size:13px}.logout:hover{color:var(--text)}@media(max-width:760px){.content{grid-template-columns:1fr}.topbar{margin-bottom:34px}.settings-card{padding:19px}.mode-card{grid-template-columns:18px 38px 1fr;padding:14px}.shell{padding:20px 15px 40px}}</style></head>
  <body><main class="shell"><header class="topbar"><div class="brand"><span class="brand-mark">♫</span><span>Anime Ongaku</span></div><button id="logout" class="logout">Sign out</button></header><section class="hero"><div class="eyebrow">Admin · Music acquisition</div><h1>Full music search policy</h1><p>Choose which saved music should automatically enter the existing acquisition queue. Search and playback activity alone never qualifies an anime.</p></section><div class="content"><section class="panel settings-card"><h2>Automatic search scope</h2><p class="intro">Changing this queues a backfill for existing eligible anime. New qualifying items are picked up automatically.</p><form id="settings"><div class="modes">${cards}</div><div class="actions"><button class="button" type="submit">Save settings</button><span id="status" class="save-status">Last updated ${new Date(settings.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span></div></form></section><aside class="sidebar"><section class="panel side-card always"><h3><span class="dot"></span>Manual is always available</h3><p>Debug requests always remain available from anime details, including while favorites, playlists, or everything mode is active.</p></section><section class="panel side-card"><h3>What “Everything” means</h3><p>Only anime explicitly present in a user’s synced library are included. Merely finding or playing a song does not add it to the automatic queue.</p></section></aside></div></main>
  <script>document.getElementById('settings').addEventListener('submit',async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');const s=document.getElementById('status');b.disabled=true;b.textContent='Saving…';const mode=new FormData(e.currentTarget).get('mode');const r=await fetch('/api/v1/admin/music/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({mode})});if(r.ok){s.textContent='Saved · existing eligible anime queued';b.textContent='Saved'}else{s.textContent='Could not save settings';b.textContent='Try again'}b.disabled=false;setTimeout(()=>{if(b.textContent==='Saved')b.textContent='Save settings'},1800)});document.getElementById('logout').addEventListener('click',async()=>{await fetch('/admin/logout',{method:'POST'});location.href='/admin/login'})</script></body></html>`;
}

function sharedStyles(): string {
  return `:root{color-scheme:dark;--bg:#0d0e16;--panel:#131420;--border:#2b2c3d;--text:#f7f4ff;--muted:#9b99ac}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 18% -10%,#372249 0,transparent 34%),radial-gradient(circle at 95% 5%,#25244c 0,transparent 28%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.panel{background:linear-gradient(145deg,#171824ee,#11121cee);border:1px solid var(--border);border-radius:22px;box-shadow:0 20px 60px #05050a66}.button{border:0;border-radius:13px;background:linear-gradient(120deg,#b58cff,#f28db3);color:#130e1c;font:inherit;font-weight:800;padding:13px 19px;cursor:pointer;box-shadow:0 9px 24px #a974ff33}.button:hover{filter:brightness(1.08)}.button:disabled{opacity:.65;cursor:wait}`;
}
