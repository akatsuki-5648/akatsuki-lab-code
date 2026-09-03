# -*- coding: utf-8 -*-
r"""★「みんなで同じ画面」を1発で立てる

★Hikârư（2026-09-03）：「1個の画面をみんなで操作」「ぞんばさんのもおれがみれる、
　もうひとりもいるけど、★トンネル」

★★これ1本でやること
    ① 同期サーバー（sync.py）を立てる
    ② cloudflared でトンネルを開ける
    ③ 出てきたURLを sync.json に書いて★GitHubへpush（★ブラウザで試す用）
    ④ ★Discordに入れるURLを画面に出す（★URLマッピングに貼る）

★★★なぜ毎回この作業が要るか
    ★無料のクイックトンネルは★URLが立て直すたびに変わる。
    ★★固定したいなら Cloudflare に akatsuki-system.online を移す必要があるが、
      ★今はムームーのDNSなので★できない（★★推測ではなく、Cloudflare Tunnel の
      名前付きトンネルは★Cloudflareがネームサーバーであることが条件）。

★使い方
    python 同期をたてる.py            … 立てる（★Ctrl+C で止まる）
    python 同期をたてる.py --push     … ★sync.json をGitHubへ push もする
"""
import io
import os
import re
import subprocess
import sys
import time
import urllib.request

ここ = os.path.dirname(os.path.abspath(__file__))
公開 = os.path.dirname(ここ)
PORT = int(os.environ.get("AKATSUKI_SYNC_PORT") or 8787)

CF候補 = [
    r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
    r"C:\Program Files\cloudflared\cloudflared.exe",
    os.path.join(os.environ.get("LOCALAPPDATA", ""),
                 r"Microsoft\WinGet\Links\cloudflared.exe"),
]


def cloudflaredを探す():
    for p in CF候補:
        if os.path.exists(p):
            return p
    import glob
    g = glob.glob(os.environ.get("LOCALAPPDATA", "") +
                  r"\Microsoft\WinGet\Packages\**\cloudflared.exe", recursive=True)
    return g[0] if g else None


def 生きてるか(url, 秒=1):
    try:
        with urllib.request.urlopen(url, timeout=秒):
            return True
    except Exception:
        return False


def main():
    NO窓 = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    # ── ① 同期サーバー ──
    if 生きてるか("http://127.0.0.1:%d/health" % PORT):
        print("★同期サーバー … 既に動いています", flush=True)
        鯖 = None
    else:
        print("★同期サーバーを立てます …", flush=True)
        鯖 = subprocess.Popen([sys.executable, "-X", "utf8",
                               os.path.join(ここ, "sync.py")],
                              cwd=ここ, creationflags=NO窓)
        for i in range(20):
            time.sleep(1)
            if 生きてるか("http://127.0.0.1:%d/health" % PORT):
                break
        else:
            print("🚨 立ち上がりませんでした")
            return 1
        print("  ✅ http://127.0.0.1:%d/health" % PORT, flush=True)

    # ── ② トンネル ──
    cf = cloudflaredを探す()
    if not cf:
        print("🚨 cloudflared が見つかりません")
        print("   winget install --id Cloudflare.cloudflared")
        return 1
    print("★トンネルを開けます …", flush=True)
    ログ = os.path.join(ここ, "_tunnel.log")
    lf = io.open(ログ, "w", encoding="utf-8", errors="replace")
    tn = subprocess.Popen([cf, "tunnel", "--url",
                           "http://127.0.0.1:%d" % PORT, "--no-autoupdate"],
                          stdout=lf, stderr=subprocess.STDOUT,
                          cwd=ここ, creationflags=NO窓)
    url = None
    for i in range(40):
        time.sleep(2)
        try:
            t = io.open(ログ, encoding="utf-8", errors="replace").read()
        except Exception:
            continue
        m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", t)
        if m:
            url = m.group(0)
            break
    if not url:
        print("🚨 トンネルのURLが出ませんでした")
        tn.terminate()
        return 1

    # ★外から本当に届くか確かめてから「できた」と言う
    for i in range(12):
        if 生きてるか(url + "/health", 秒=8):
            break
        time.sleep(3)
    else:
        print("🚨 URLは出たが外から届きません: " + url)
        return 1
    print("  ✅ " + url, flush=True)

    # ── ③ sync.json ──
    p = os.path.join(公開, "sync.json")
    io.open(p, "w", encoding="utf-8", newline="").write(
        '{' + chr(10)
        + '  "url": "' + url + '",' + chr(10)
        + '  "note": "★暁月ラボ同期サーバー（cloudflare tunnel）。'
          '★立て直すたびに変わります"' + chr(10)
        + '}' + chr(10))
    print("  ✅ sync.json を書き換えました", flush=True)

    if "--push" in sys.argv:
        subprocess.run(["git", "add", "sync.json"], cwd=公開)
        subprocess.run(["git", "commit", "-q", "-m",
                        "同期サーバーのURLを更新"], cwd=公開)
        r = subprocess.run(["git", "push", "-q", "origin", "main"], cwd=公開)
        print("  %s GitHubへ push" % ("✅" if r.returncode == 0 else "🚨"), flush=True)

    # ── ④ Discordに入れる値 ──
    ドメイン = url.replace("https://", "")
    print("", flush=True)
    print("━" * 62, flush=True)
    print("★Discord Developer Portal → URLマッピング に、この1行を入れてください", flush=True)
    print("", flush=True)
    print("    プレフィックス   /sync", flush=True)
    print("    ターゲット       " + ドメイン, flush=True)
    print("", flush=True)
    print("  https://discord.com/developers/applications/"
          "1521753242457997322/embedded/url-mappings", flush=True)
    print("━" * 62, flush=True)
    print("", flush=True)
    print("★ブラウザで試す：", flush=True)
    print("   https://akatsuki-5648.github.io/akatsuki-lab-code/"
          "?room=labo&name=あなたの名前", flush=True)
    print("", flush=True)
    print("★止める時は Ctrl+C", flush=True)

    try:
        while True:
            time.sleep(30)
            if tn.poll() is not None:
                print("🚨 トンネルが落ちました。立て直してください")
                break
    except KeyboardInterrupt:
        print(chr(10) + "★止めます …")
    finally:
        for pr in (tn, 鯖):
            if pr:
                try:
                    pr.terminate()
                except Exception:
                    pass
        lf.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
