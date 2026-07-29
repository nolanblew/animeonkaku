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

export type AdminMediaKind = "AUDIO" | "VIDEO" | "ANIME_POSTER" | "ANIME_COVER" | "ARTIST_IMAGE";
export type AdminMediaVariant = "SHORT" | "ORIGINAL" | "FULL" | "DEFAULT";
export interface AdminDashboardApi {
  overview(): Promise<Record<string, unknown>>;
  listUsers(input: { query: string | undefined; limit: number }): Promise<Array<Record<string, unknown>>>;
  listAnime(input: { query: string | undefined; limit: number }): Promise<Array<Record<string, unknown>>>;
  listSongs(input: { query: string | undefined; limit: number }): Promise<Array<Record<string, unknown>>>;
  listLogs(input: { level: string | undefined; limit: number }): Array<Record<string, unknown>>;
  listRequests(): Promise<Array<Record<string, unknown>>>;
  listJobs(): Promise<Array<Record<string, unknown>>>;
  syncUser(userId: string): Promise<Record<string, unknown>>;
  revokeUserSessions(userId: string): Promise<Record<string, unknown>>;
  refreshAnime(kitsuId: string): Promise<Record<string, unknown>>;
  requestAnimeMusic(kitsuId: string): Promise<Record<string, unknown>>;
  refreshThemeMedia(kitsuId: string): Promise<Record<string, unknown>>;
  removeThemeMedia(kitsuId: string): Promise<Record<string, unknown>>;
  removeMedia(kind: AdminMediaKind, refId: string, variant: AdminMediaVariant): Promise<Record<string, unknown>>;
  clearCache(category: "artwork" | "temporary" | "all"): Promise<Record<string, unknown>>;
  retryJob(jobId: number): Promise<Record<string, unknown>>;
  operateBatch(batchId: string, action: "retry" | "cancel" | "reprocess"): Promise<Record<string, unknown>>;
}

const loginBody = z.object({ password: z.string().min(1).max(200) }).strict();
const settingsBody = z.object({ mode: z.enum(MUSIC_SEARCH_MODES) }).strict();
const listQuery = z.object({ q: z.string().trim().max(200).optional(), limit: z.coerce.number().int().min(1).max(250).default(100) });
const logQuery = z.object({ level: z.preprocess((value) => value === "" ? undefined : value, z.enum(["INFO", "WARN", "ERROR"]).optional()), limit: z.coerce.number().int().min(1).max(500).default(200) });
const idParams = z.object({ id: z.string().min(1).max(100) });
const mediaParams = z.object({
  kind: z.enum(["AUDIO", "VIDEO", "ANIME_POSTER", "ANIME_COVER", "ARTIST_IMAGE"]),
  refId: z.string().min(1).max(200),
  variant: z.enum(["SHORT", "ORIGINAL", "FULL", "DEFAULT"]),
});
const cacheQuery = z.object({ category: z.enum(["artwork", "temporary", "all"]).default("all") });
const batchParams = z.object({ id: z.string().min(1).max(100), action: z.enum(["retry", "cancel", "reprocess"]) });
const jobParams = z.object({ id: z.coerce.number().int().positive() });
const COOKIE_NAME = "admin_session";

export function registerAdminRoutes(
  fastify: FastifyInstance,
  settings: MusicSearchSettingsApi,
  password: string,
  dashboard?: AdminDashboardApi,
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
    const current = await settings.getSettings();
    return reply.type("text/html; charset=utf-8").send(dashboard ? dashboardPage(current) : settingsPage(current));
  });

  app.get("/api/v1/admin/music/settings", { preHandler: requireAdmin }, async () => ({ settings: await settings.getSettings() }));
  app.put(
    "/api/v1/admin/music/settings",
    { schema: { body: settingsBody }, preHandler: requireAdmin },
    async (request) => ({ settings: await settings.updateMode(request.body.mode) }),
  );

  if (!dashboard) return;
  app.get("/api/v1/admin/overview", { preHandler: requireAdmin }, () => dashboard.overview());
  app.get("/api/v1/admin/users", { schema: { querystring: listQuery }, preHandler: requireAdmin }, async (request) => ({ users: await dashboard.listUsers({ query: request.query.q, limit: request.query.limit }) }));
  app.get("/api/v1/admin/anime", { schema: { querystring: listQuery }, preHandler: requireAdmin }, async (request) => ({ anime: await dashboard.listAnime({ query: request.query.q, limit: request.query.limit }) }));
  app.get("/api/v1/admin/songs", { schema: { querystring: listQuery }, preHandler: requireAdmin }, async (request) => ({ songs: await dashboard.listSongs({ query: request.query.q, limit: request.query.limit }) }));
  app.get("/api/v1/admin/logs", { schema: { querystring: logQuery }, preHandler: requireAdmin }, async (request) => ({ logs: dashboard.listLogs({ level: request.query.level, limit: request.query.limit }) }));
  app.get("/api/v1/admin/requests", { preHandler: requireAdmin }, async () => ({ requests: await dashboard.listRequests() }));
  app.get("/api/v1/admin/jobs", { preHandler: requireAdmin }, async () => ({ jobs: await dashboard.listJobs() }));

  app.post("/api/v1/admin/users/:id/sync", { schema: { params: idParams }, preHandler: requireAdmin }, async (request, reply) => reply.code(202).send(await dashboard.syncUser(request.params.id)));
  app.delete("/api/v1/admin/users/:id/sessions", { schema: { params: idParams }, preHandler: requireAdmin }, async (request, reply) => reply.code(202).send(await dashboard.revokeUserSessions(request.params.id)));
  app.post("/api/v1/admin/anime/:id/refresh", { schema: { params: idParams }, preHandler: requireAdmin }, async (request, reply) => reply.code(202).send(await dashboard.refreshAnime(request.params.id)));
  app.post("/api/v1/admin/anime/:id/music-requests", { schema: { params: idParams }, preHandler: requireAdmin }, async (request, reply) => reply.code(202).send(await dashboard.requestAnimeMusic(request.params.id)));
  app.post("/api/v1/admin/anime/:id/tv-media/refresh", { schema: { params: idParams }, preHandler: requireAdmin }, async (request, reply) => reply.code(202).send(await dashboard.refreshThemeMedia(request.params.id)));
  app.delete("/api/v1/admin/anime/:id/tv-media", { schema: { params: idParams }, preHandler: requireAdmin }, async (request, reply) => reply.code(202).send(await dashboard.removeThemeMedia(request.params.id)));
  app.delete("/api/v1/admin/media/:kind/:refId/:variant", { schema: { params: mediaParams }, preHandler: requireAdmin }, async (request, reply) => reply.code(202).send(await dashboard.removeMedia(request.params.kind, request.params.refId, request.params.variant)));
  app.delete("/api/v1/admin/cache", { schema: { querystring: cacheQuery }, preHandler: requireAdmin }, async (request, reply) => reply.code(202).send(await dashboard.clearCache(request.query.category)));
  app.post("/api/v1/admin/jobs/:id/retry", { schema: { params: jobParams }, preHandler: requireAdmin }, async (request, reply) => reply.code(202).send(await dashboard.retryJob(request.params.id)));
  app.post("/api/v1/admin/batches/:id/:action", { schema: { params: batchParams }, preHandler: requireAdmin }, async (request, reply) => reply.code(202).send(await dashboard.operateBatch(request.params.id, request.params.action)));
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

function dashboardPage(settings: MusicSearchSettingsDto): string {
  const safeSettings = JSON.stringify(settings).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin · Anime Ongaku</title><style>${sharedStyles()}
  :root{--accent:#b58cff;--good:#73dbab;--warn:#ffca6a;--bad:#ff8099}html,body{max-width:100%;overflow-x:hidden}.layout{min-height:100vh;display:grid;grid-template-columns:245px minmax(0,1fr)}.sidebar{min-width:0;padding:24px 18px;border-right:1px solid var(--border);background:#0d0e17e8;position:sticky;top:0;height:100vh}.brand{display:flex;align-items:center;gap:12px;font-weight:850;padding:0 8px 24px}.brand-mark{width:39px;height:39px;border-radius:13px;background:linear-gradient(145deg,#ff8eb4,#9d7cff);display:grid;place-items:center}.nav{min-width:0;display:grid;gap:5px}.nav button{border:0;background:transparent;color:var(--muted);font:inherit;text-align:left;padding:11px 13px;border-radius:11px;cursor:pointer}.nav button:hover,.nav button.active{color:var(--text);background:#242238}.sidebar-foot{position:absolute;bottom:22px;left:18px;right:18px}.content{width:100%;min-width:0;padding:30px clamp(18px,4vw,50px) 60px}.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}.topbar h1{margin:0;font-size:28px}.muted{color:var(--muted)}.section{display:none}.section.active{display:block}.metrics{display:grid;grid-template-columns:repeat(3,minmax(150px,1fr));gap:13px}.metric{min-width:0;padding:20px}.metric strong{font-size:28px;display:block;margin-top:5px}.storage{margin-top:18px;padding:22px}.storage-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.storage-item{min-width:0;padding:14px;border-radius:13px;background:#1b1c2a}.toolbar{display:flex;gap:10px;margin-bottom:15px}.search{flex:1;max-width:440px;background:#171827;border:1px solid var(--border);border-radius:12px;color:var(--text);padding:11px 13px;font:inherit}.table-wrap{max-width:100%;overflow:auto;border:1px solid var(--border);border-radius:17px;background:#12131e}table{width:100%;border-collapse:collapse;min-width:720px}th,td{text-align:left;padding:13px 14px;border-bottom:1px solid #262737;font-size:13px}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#29273c;color:#d8c8ff;font-size:11px}.mini{border:1px solid #3a3a50;background:#202131;color:var(--text);border-radius:9px;padding:7px 10px;cursor:pointer;font:inherit;font-size:12px}.mini.danger{color:#ffb2c0;border-color:#633845}.mini:hover{filter:brightness(1.16)}.actions{display:flex;gap:7px;flex-wrap:wrap}.settings-card{padding:22px}.settings-card label{display:block;padding:9px}.toast{position:fixed;right:25px;bottom:25px;background:#232338;border:1px solid #55516f;padding:13px 16px;border-radius:12px;opacity:0;transform:translateY(10px);transition:.2s;pointer-events:none}.toast.show{opacity:1;transform:none}@media(max-width:850px){.layout{grid-template-columns:minmax(0,1fr)}.sidebar{max-width:100vw;height:auto;position:static;overflow:hidden;border-right:0;border-bottom:1px solid var(--border)}.nav{max-width:100%;display:flex;overflow-x:auto}.nav button{flex:0 0 auto;white-space:nowrap}.sidebar-foot{display:none}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.storage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:480px){.metrics{grid-template-columns:1fr}.storage-grid{grid-template-columns:1fr}.topbar>.mini{display:none}}
  </style></head><body><div class="layout"><aside class="sidebar"><div class="brand"><span class="brand-mark">♫</span>Anime Ongaku</div><nav class="nav" id="nav">${["Overview","Users","Anime","Songs","Requests","Jobs","Logs","Storage & cache","Settings"].map((name, i) => `<button data-tab="${name.toLowerCase().replaceAll(" ","-").replace("&-","")}"${i === 0 ? ' class="active"' : ''}>${name}</button>`).join("")}</nav><div class="sidebar-foot"><button id="logout" class="mini">Sign out</button></div></aside><main class="content"><header class="topbar"><div><h1 id="title">Overview</h1><span class="muted">Server operations and media catalog</span></div><button id="refresh" class="mini">Refresh</button></header>
  <section id="overview" class="section active"><div id="metrics" class="metrics"></div><div class="panel storage"><h2>Storage</h2><div id="overview-storage" class="storage-grid"></div></div></section>
  ${tableSection("users", "Search users")}${tableSection("anime", "Search anime")}${tableSection("songs", "Search songs")}${tableSection("requests", "Search requests")}${tableSection("jobs", "Search jobs")}${tableSection("logs", "Filter logs")}
  <section id="storage-cache" class="section"><div class="panel storage"><h2>Disk usage</h2><div id="storage-detail" class="storage-grid"></div><div class="actions" style="margin-top:18px"><button class="mini danger" data-cache="temporary">Clear temporary cache</button><button class="mini danger" data-cache="artwork">Clear artwork cache</button><button class="mini danger" data-cache="all">Clear all cache</button></div><p class="muted">Full-size originals are never removed by cache clearing.</p></div></section>
  <section id="settings" class="section"><form id="settings-form" class="panel settings-card"><h2>Automatic full music search</h2>${["MANUAL","FAVORITES","PLAYLISTS","EVERYTHING"].map(mode => `<label><input type="radio" name="mode" value="${mode}"${settings.mode === mode ? " checked" : ""}> ${mode[0]}${mode.slice(1).toLowerCase()}</label>`).join("")}<button class="button" type="submit">Save settings</button></form></section>
  </main></div><div id="toast" class="toast" role="status"></div><script>const initialSettings=${safeSettings};
  const state={tab:'overview',data:{}};const $=s=>document.querySelector(s);const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const bytes=n=>{n=Number(n||0);for(const u of ['B','KB','MB','GB','TB']){if(n<1024||u==='TB')return n.toFixed(u==='B'?0:1)+' '+u;n/=1024}};function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400)}
  async function api(path,options){const r=await fetch(path,options);if(r.status===401){location.href='/admin/login';return}const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error?.message||'Request failed');return data}
  function tableSection(id,placeholder){return ''}function renderTable(id,rows,columns){const body=rows.map(row=>'<tr>'+columns.map(c=>'<td>'+c.render(row)+'</td>').join('')+'</tr>').join('');$('#'+id+' .table-wrap').innerHTML='<table><thead><tr>'+columns.map(c=>'<th>'+c.label+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>';if(id==='anime'){[...document.querySelectorAll('#anime tbody tr')].forEach((tr,index)=>tr.querySelector('td:last-child .actions')?.insertAdjacentHTML('beforeend',action('Remove TV media','/api/v1/admin/anime/'+encodeURIComponent(rows[index].kitsuId)+'/tv-media','DELETE',true)))}}
  const action=(label,path,method='POST',danger=false)=>'<button class="mini '+(danger?'danger':'')+'" data-action="'+esc(method)+'" data-path="'+esc(path)+'">'+esc(label)+'</button>';
  async function loadOverview(){const d=await api('/api/v1/admin/overview');state.data.overview=d;$('#metrics').innerHTML=Object.entries(d.counts).map(([k,v])=>'<div class="panel metric"><span class="muted">'+esc(k.replace(/([A-Z])/g,' $1'))+'</span><strong>'+esc(v)+'</strong></div>').join('');renderStorage('#overview-storage',d.storage);renderStorage('#storage-detail',d.storage)}
  function renderStorage(target,s){$(target).innerHTML=[['Total',s.totalBytes],['TV songs',s.tvSongsBytes],['Full-sized songs',s.fullSongsBytes],['Artwork',s.artworkBytes],['Cache & other',s.cacheBytes]].map(([k,v])=>'<div class="storage-item"><span class="muted">'+k+'</span><strong style="display:block;margin-top:6px">'+bytes(v)+'</strong></div>').join('')}
  const loaders={users:async q=>{const d=await api('/api/v1/admin/users?q='+encodeURIComponent(q||''));renderTable('users',d.users,[{label:'User',render:r=>'<strong>'+esc(r.username)+'</strong><br><span class="muted">'+esc(r.id)+'</span>'},{label:'Auth',render:r=>'<span class="badge">'+esc(r.authState)+'</span>'},{label:'Sessions',render:r=>esc(r.sessionCount)},{label:'Last sync',render:r=>esc(r.lastSyncAt)},{label:'Actions',render:r=>'<div class="actions">'+action('Sync','/api/v1/admin/users/'+encodeURIComponent(r.id)+'/sync')+action('Revoke sessions','/api/v1/admin/users/'+encodeURIComponent(r.id)+'/sessions','DELETE',true)+'</div>'}])},anime:async q=>{const d=await api('/api/v1/admin/anime?q='+encodeURIComponent(q||''));renderTable('anime',d.anime,[{label:'Anime',render:r=>'<strong>'+esc(r.title)+'</strong><br><span class="muted">Kitsu '+esc(r.kitsuId)+'</span>'},{label:'Mapping',render:r=>'<span class="badge">'+(r.mapped?'Mapped':'Unmapped')+'</span>'},{label:'Themes',render:r=>esc(r.themeCount)},{label:'TV / Full ready',render:r=>esc(r.tvReady)+' / '+esc(r.fullReady)},{label:'Actions',render:r=>'<div class="actions">'+action('Refresh metadata','/api/v1/admin/anime/'+encodeURIComponent(r.kitsuId)+'/refresh')+action('Request full music','/api/v1/admin/anime/'+encodeURIComponent(r.kitsuId)+'/music-requests')+action('Refresh TV media','/api/v1/admin/anime/'+encodeURIComponent(r.kitsuId)+'/tv-media/refresh')+'</div>'}])},songs:async q=>{const d=await api('/api/v1/admin/songs?q='+encodeURIComponent(q||''));renderTable('songs',d.songs,[{label:'Song',render:r=>'<strong>'+esc(r.title)+'</strong><br><span class="muted">'+esc(r.artist)+'</span>'},{label:'Media',render:r=>'<span class="badge">'+esc(r.mediaState)+'</span>'},{label:'Size',render:r=>bytes(r.byteSize)},{label:'Updated',render:r=>esc(r.updatedAt)},{label:'Actions',render:r=>r.mediaState==='READY'?action('Remove full media','/api/v1/admin/media/AUDIO/song%3A'+encodeURIComponent(r.id)+'/ORIGINAL','DELETE',true):'—'}])},requests:async q=>{const d=await api('/api/v1/admin/requests');const rows=d.requests.filter(r=>JSON.stringify(r).toLowerCase().includes((q||'').toLowerCase()));renderTable('requests',rows,[{label:'Anime / request',render:r=>'<strong>'+esc(r.title||r.kitsuId)+'</strong><br><span class="muted">'+esc(r.id)+'</span>'},{label:'State',render:r=>'<span class="badge">'+esc(r.state)+'</span>'},{label:'Updated',render:r=>esc(r.updatedAt)},{label:'Batches',render:r=>(r.batches||[]).map(b=>'<div class="actions"><span>'+esc(b.index)+' · '+esc(b.state)+'</span>'+action('Retry','/api/v1/admin/batches/'+encodeURIComponent(b.id)+'/retry')+action('Reprocess','/api/v1/admin/batches/'+encodeURIComponent(b.id)+'/reprocess')+action('Cancel','/api/v1/admin/batches/'+encodeURIComponent(b.id)+'/cancel','POST',true)+'</div>').join('')}])},jobs:async q=>{const d=await api('/api/v1/admin/jobs');const rows=d.jobs.filter(r=>JSON.stringify(r).toLowerCase().includes((q||'').toLowerCase()));renderTable('jobs',rows,[{label:'Job',render:r=>'<strong>#'+esc(r.id)+' '+esc(r.type)+'</strong>'},{label:'State',render:r=>'<span class="badge">'+esc(r.state)+'</span>'},{label:'Attempts',render:r=>esc(r.attempts)+' / '+esc(r.maxAttempts)},{label:'Error',render:r=>esc(r.lastError)},{label:'Actions',render:r=>r.state==='FAILED'?action('Retry','/api/v1/admin/jobs/'+r.id+'/retry'):'—'}])},logs:async q=>{const level=/^(INFO|WARN|ERROR)$/i.test(q||'')?(q||'').toUpperCase():'';const d=await api('/api/v1/admin/logs?level='+level);renderTable('logs',d.logs,[{label:'Time',render:r=>esc(r.time)},{label:'Level',render:r=>'<span class="badge">'+esc(r.level)+'</span>'},{label:'Message',render:r=>esc(r.message)},{label:'Context',render:r=>'<code>'+esc(JSON.stringify(r.data))+'</code>'}])}};
  async function load(){try{if(state.tab==='overview'||state.tab==='storage-cache')await loadOverview();else if(loaders[state.tab])await loaders[state.tab]($('#'+state.tab+' input')?.value)}catch(e){toast(e.message)}}
  $('#nav').addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(!b)return;document.querySelectorAll('.nav button,.section').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.tab=b.dataset.tab;$('#'+state.tab).classList.add('active');$('#title').textContent=b.textContent;load()});document.addEventListener('input',e=>{if(e.target.matches('.toolbar input')){clearTimeout(e.target.timer);e.target.timer=setTimeout(load,250)}});document.addEventListener('click',async e=>{const b=e.target.closest('[data-action],[data-cache]');if(!b)return;const path=b.dataset.path||('/api/v1/admin/cache?category='+b.dataset.cache);if((b.classList.contains('danger')||b.dataset.cache)&&!confirm('Confirm this server operation?'))return;b.disabled=true;try{await api(path,{method:b.dataset.action||'DELETE'});toast('Operation queued');await load()}catch(err){toast(err.message)}finally{b.disabled=false}});$('#refresh').onclick=load;$('#logout').onclick=async()=>{await fetch('/admin/logout',{method:'POST'});location.href='/admin/login'};$('#settings-form').onsubmit=async e=>{e.preventDefault();await api('/api/v1/admin/music/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({mode:new FormData(e.target).get('mode')})});toast('Settings saved')};load();</script></body></html>`;
}

function tableSection(id: string, placeholder: string): string {
  return `<section id="${id}" class="section"><div class="toolbar"><input class="search" type="search" placeholder="${placeholder}" aria-label="${placeholder}"></div><div class="table-wrap"><table><tbody><tr><td class="muted">Loading…</td></tr></tbody></table></div></section>`;
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
