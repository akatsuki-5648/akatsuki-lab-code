/* ★暁月ラボ 同期サーバー（Cloudflare Workers 版）
 *
 * ★Hikârư（2026-09-03）：「★Discordでつねにしたいんだよ」
 *
 * ★★なぜ自宅PC版（_server/sync.py）から移したか
 *   ★cloudflared のクイックトンネルは★立て直すたびにURLが変わる。
 *   ★このPCは毎日起動している（★実測：連続稼働10時間）＝★毎日URLが変わる
 *     ＝★毎日 Discord の設定を貼り直すことになる＝★「つねに」にならない。
 *   ★★Workers なら★URLが固定で★PCが落ちていても動く。★無料枠で足りる
 *     （★Durable Objects は 2025-04 から Workers 無料プランに入った。
 *       ★WebSocketの初回接続だけが1リクエスト、★以後のメッセージは数えない）。
 *
 * ★★中身は自宅PC版と★同じプロトコル（★index.html は両方に繋がる）
 *   部屋 = instanceId ／ code / lang / run / out / who / init
 *
 * ★安全
 *   ・★コードは★配るだけ（★走らせるのは各自のブラウザ）
 *   ・★部屋の鍵は Discord の instanceId ＝★VCに居る人しか知らない
 *   ・★1部屋30人まで／★コードは64KBまで
 */

const 最大人数 = 30;
const 最大文字数 = 64 * 1024;

export class Room {
  constructor(state, env) {
    this.state = state;
    this.客 = new Map();                 // ★ws -> name
    // ★★部屋の今の状態（★後から入った人にそのまま渡す）
    this.画面 = { lang: "py", code: null, out: null, meta: null };
  }

  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("websocket only", { status: 426 });
    }
    const u = new URL(req.url);
    const name = (u.searchParams.get("name") || "だれか").slice(0, 40);

    if (this.客.size >= 最大人数) {
      return new Response("この部屋はいっぱいです", { status: 429 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.客.set(server, name);

    // ★入った人には★今の画面をそのまま渡す
    this.送る1人(server, { t: "init", state: this.画面,
                          names: [...this.客.values()], you: name });
    this.配る({ t: "join", name }, server);
    this.顔ぶれ();

    server.addEventListener("message", ev => {
      let d;
      try { d = JSON.parse(ev.data); } catch (e) { return; }

      if (d.t === "code") {
        const c = String(d.code || "").slice(0, 最大文字数);
        this.画面.code = c;
        if (d.lang === "py" || d.lang === "rb") this.画面.lang = d.lang;
        this.配る({ t: "code", code: c, lang: this.画面.lang, by: name }, server);

      } else if (d.t === "lang") {
        if (d.lang === "py" || d.lang === "rb") {
          this.画面.lang = d.lang;
          this.配る({ t: "lang", lang: d.lang, by: name }, server);
        }

      } else if (d.t === "run") {
        this.配る({ t: "run", by: name }, server);

      } else if (d.t === "out") {
        this.画面.out = String(d.out || "").slice(0, 最大文字数);
        this.画面.meta = String(d.meta || "").slice(0, 200);
        this.配る({ t: "out", out: this.画面.out,
                   meta: this.画面.meta, by: name }, server);

      } else if (d.t === "ping") {
        this.送る1人(server, { t: "pong" });
      }
    });

    const 去る = () => {
      this.客.delete(server);
      this.配る({ t: "left", name });
      this.顔ぶれ();
    };
    server.addEventListener("close", 去る);
    server.addEventListener("error", 去る);

    return new Response(null, { status: 101, webSocket: client });
  }

  送る1人(ws, o) {
    try { ws.send(JSON.stringify(o)); } catch (e) { this.客.delete(ws); }
  }

  配る(o, 除く) {
    const body = JSON.stringify(o);
    for (const ws of [...this.客.keys()]) {
      if (ws === 除く) continue;
      try { ws.send(body); } catch (e) { this.客.delete(ws); }
    }
  }

  顔ぶれ() {
    this.配る({ t: "who", names: [...this.客.values()] });
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);

    if (u.pathname === "/health") {
      return Response.json({ ok: true, where: "cloudflare-workers",
                             時刻: new Date().toISOString() },
                           { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (u.pathname === "/ws") {
      const room = (u.searchParams.get("room") || "").slice(0, 120);
      if (!room) return new Response("room が要ります", { status: 400 });
      // ★★部屋の名前から同じ Durable Object を引く＝★同じ部屋の人が同じ所に集まる
      const id = env.ROOM.idFromName(room);
      return env.ROOM.get(id).fetch(req);
    }

    /* ══════════════════════════════════════════════════
       ★★メシコレ（Once Human 在庫）── 2026-09-05 追加
         ★Hikârư「akatsuki-lab-syncそのままいれかえるんじゃないの？」
           ＝★新しいWorkerは作らない。★ここに2本足すだけ。
         ★Hikârư「悪意があってもそれでやられること限られるでしょ」
           ＝★合言葉で守るのは「在庫の書き換え」まで。★アカウントの鍵は作らない。
         ★上の Room / /health / /ws は 1文字も変えていない。
       ══════════════════════════════════════════════════ */

    // ★D1 がまだ無くても、上の同期は普通に動く（★足すまで劣化しない）
    const 台帳あり = !!env.DB;

    // ── 画面が読む所（★誰でも読める。★在庫は隠す物ではない）──
    if (u.pathname === "/inventory") {
      const h = { "content-type": "application/json; charset=utf-8",
                  "Access-Control-Allow-Origin": "*",
                  "Cache-Control": "no-store" };
      if (!台帳あり) {
        return new Response(JSON.stringify({ エラー: "D1 がまだ繋がっていません" }),
                            { status: 503, headers: h });
      }
      // ★最新の1行を読むだけ＝★D1の読み取りは1行（★無料枠 500万行/日）
      const row = await env.DB.prepare(
        "SELECT json FROM snapshot ORDER BY id DESC LIMIT 1").first();
      if (!row) {
        return new Response(JSON.stringify({ エラー: "まだ1度も送られていません" }),
                            { status: 404, headers: h });
      }
      return new Response(row.json, { headers: h });
    }

    // ── レオが更新を送る所（★合言葉が要る）──
    if (u.pathname === "/push") {
      if (req.method !== "POST") return new Response("POST で", { status: 405 });
      // ★合言葉は Worker の中（暗号化された変数）。★PCには置かない
      const 鍵 = req.headers.get("x-meshi-key") || "";
      if (!env.PUSH_KEY || 鍵 !== env.PUSH_KEY) {
        return new Response("合言葉がちがいます", { status: 401 });
      }
      if (!台帳あり) return new Response("D1 がまだ繋がっていません", { status: 503 });

      let 中身;
      try { 中身 = await req.json(); }
      catch (e) { return new Response("JSON ではありません", { status: 400 }); }

      const 返す = o => Response.json(o, { headers: { "Cache-Control": "no-store" } });

      // ★① 画面用のJSONを丸ごと置く（★組み立てはPC側の export_json.py のまま
      //     ＝★同じロジックを2箇所に持たない）
      if (typeof 中身.json === "string") {
        await env.DB.prepare(
          "CREATE TABLE IF NOT EXISTS snapshot" +
          " (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT, at TEXT)").run();
        await env.DB.prepare("INSERT INTO snapshot (json, at) VALUES (?, ?)")
          .bind(中身.json, new Date().toISOString()).run();
        // ★古いものは10件だけ残す（★戻せるように・★増え続けない）
        await env.DB.prepare(
          "DELETE FROM snapshot WHERE id NOT IN" +
          " (SELECT id FROM snapshot ORDER BY id DESC LIMIT 10)").run();
        return 返す({ ok: true, 置いた: "snapshot", バイト: 中身.json.length });
      }

      // ★② DBの実体をそのまま入れる（★SQL文の配列・★分割して何回でも送れる）
      if (Array.isArray(中身.sql)) {
        const 文 = 中身.sql.filter(x => typeof x === "string" && x.trim());
        if (!文.length) return 返す({ ok: true, 実行: 0 });
        if (文.length > 500) return new Response("1回500文まで", { status: 413 });
        await env.DB.batch(文.map(q => env.DB.prepare(q)));
        return 返す({ ok: true, 実行: 文.length });
      }

      return new Response("json か sql が要ります", { status: 400 });
    }

    // ★CORSの下見（★Activityから直接叩ける形にしておく）
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "content-type,x-meshi-key" } });
    }

    return new Response("暁月ラボ 同期サーバー（Workers）", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
