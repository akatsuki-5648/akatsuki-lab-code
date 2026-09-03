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

    return new Response("暁月ラボ 同期サーバー（Workers）", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
