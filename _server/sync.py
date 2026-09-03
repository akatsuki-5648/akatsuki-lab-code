# -*- coding: utf-8 -*-
r"""★暁月ラボ 同期サーバー ── ★1つの画面を3人で操作する

★Hikârư（2026-09-03）：「みんなでおなじがめんは？」「1個の画面をみんなで操作」
                      「ぞんばさんのもおれがみれる、もうひとりもいるけど、★トンネル」

★★なぜサーバーが要るか（★憶測ではない・★公式に書いてある）
    Discord の Activity ドキュメントに、こう明記されている：
      「any info ... must be shared via your application's server」
      「The instanceId should be used as a key to save and load the shared data」
    ★★Embedded App SDK には★参加者どうしでデータを配る仕組みが無い。
    ★★★だから★自分でサーバーを立てて、★instanceId を部屋の鍵として使う。

★★このサーバーがやること（★これだけ）
    ① 部屋（instanceId）ごとに WebSocket をまとめる
    ② 誰かの変更を★その部屋の他の全員へそのまま配る
    ③ ★部屋の今の状態（コード・言語）を覚えておく
       → ★後から入った人にも★同じ画面がすぐ出る
    ④ 誰が居るかを配る（★名前の一覧）

★★置き場所と外への出し方
    ★このPCで走らせる → ★cloudflared tunnel で外から届くようにする
    ★★Hikârưの自宅PCが止まれば止まる（★★VPSは要らない）

★★安全
    ・★実行はしない（★★コードは配るだけ。★走らせるのは各自のブラウザ）
    ・★部屋の鍵は Discord の instanceId ＝ ★★VCに居る人しか知らない
    ・★1部屋 30人まで／★コードは 64KB まで（★流し込み対策）
    ・★空になった部屋は 10分で消す（★覚えっぱなしにしない）
"""
import asyncio
import json
import os
import time

from aiohttp import web, WSMsgType

PORT = int(os.environ.get("AKATSUKI_SYNC_PORT") or 8787)
最大人数 = 30
最大文字数 = 64 * 1024
掃除まで = 600            # ★空の部屋を消すまでの秒数

部屋 = {}                 # room -> {"客": {ws: name}, "状態": {...}, "最後": ts}


def _部屋を取る(room):
    if room not in 部屋:
        部屋[room] = {"客": {}, "最後": time.time(),
                      "状態": {"lang": "py", "code": None, "out": None, "meta": None}}
    return 部屋[room]


async def _配る(room, data, 除く=None):
    """★その部屋の全員へ送る（★送った本人には返さない）"""
    r = 部屋.get(room)
    if not r:
        return
    死んだ = []
    body = json.dumps(data, ensure_ascii=False)
    for ws in list(r["客"]):
        if ws is 除く:
            continue
        try:
            await ws.send_str(body)
        except Exception:
            死んだ.append(ws)
    for ws in 死んだ:
        r["客"].pop(ws, None)


async def _顔ぶれ(room):
    r = 部屋.get(room)
    if r:
        await _配る(room, {"t": "who", "names": list(r["客"].values())})


async def ws_handler(req):
    room = (req.query.get("room") or "").strip()[:120]
    name = (req.query.get("name") or "だれか").strip()[:40]
    if not room:
        return web.Response(status=400, text="room が要ります")

    ws = web.WebSocketResponse(heartbeat=25, max_msg_size=1 << 20)
    await ws.prepare(req)

    r = _部屋を取る(room)
    if len(r["客"]) >= 最大人数:
        await ws.send_str(json.dumps({"t": "err", "msg": "この部屋はいっぱいです"}))
        await ws.close()
        return ws
    r["客"][ws] = name
    r["最後"] = time.time()

    # ★入った人には★今の画面をそのまま渡す（★★これで同じ物が見える）
    await ws.send_str(json.dumps({"t": "init", "state": r["状態"],
                                  "names": list(r["客"].values()),
                                  "you": name}, ensure_ascii=False))
    await _配る(room, {"t": "join", "name": name}, 除く=ws)
    await _顔ぶれ(room)

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                d = json.loads(msg.data)
            except Exception:
                continue
            t = d.get("t")
            r["最後"] = time.time()

            if t == "code":                       # ★誰かが書き換えた
                c = (d.get("code") or "")[:最大文字数]
                r["状態"]["code"] = c
                if d.get("lang") in ("py", "rb"):
                    r["状態"]["lang"] = d["lang"]
                await _配る(room, {"t": "code", "code": c,
                                   "lang": r["状態"]["lang"], "by": name}, 除く=ws)

            elif t == "lang":                     # ★言語を切り替えた
                if d.get("lang") in ("py", "rb"):
                    r["状態"]["lang"] = d["lang"]
                    await _配る(room, {"t": "lang", "lang": d["lang"], "by": name}, 除く=ws)

            elif t == "run":                      # ★実行が押された（★全員の画面で走る）
                await _配る(room, {"t": "run", "by": name}, 除く=ws)

            elif t == "out":                      # ★実行した人の出力を配る
                o = (d.get("out") or "")[:最大文字数]
                r["状態"]["out"] = o
                r["状態"]["meta"] = (d.get("meta") or "")[:200]
                await _配る(room, {"t": "out", "out": o,
                                   "meta": r["状態"]["meta"], "by": name}, 除く=ws)

            elif t == "ping":
                await ws.send_str(json.dumps({"t": "pong"}))
    finally:
        r["客"].pop(ws, None)
        await _配る(room, {"t": "left", "name": name})
        await _顔ぶれ(room)
    return ws


async def health(req):
    return web.json_response({
        "ok": True,
        "部屋数": len(部屋),
        "人数": sum(len(v["客"]) for v in 部屋.values()),
        "時刻": time.strftime("%Y-%m-%d %H:%M:%S"),
    })


async def 掃除(app):
    """★空になった部屋を消す（★覚えっぱなしにしない）"""
    try:
        while True:
            await asyncio.sleep(60)
            now = time.time()
            for k in [k for k, v in 部屋.items()
                      if not v["客"] and now - v["最後"] > 掃除まで]:
                部屋.pop(k, None)
    except asyncio.CancelledError:
        pass


async def 起動時(app):
    app["掃除"] = asyncio.create_task(掃除(app))


async def 終了時(app):
    app["掃除"].cancel()


def main():
    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/health", health)
    app.on_startup.append(起動時)
    app.on_cleanup.append(終了時)
    print("★暁月ラボ 同期サーバー  http://127.0.0.1:%d/health" % PORT, flush=True)
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    main()
