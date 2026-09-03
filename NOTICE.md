# 使っているもの と ライセンス

このページは★同梱したファイルだけで動きます（★外部CDNを呼びません）。

## Pyodide 0.26.4

- ★Mozilla Public License 2.0（★[pyodide/LICENSE](pyodide/LICENSE) に全文を同梱）
- ★★改変していません（★配布物をそのまま置いています）
- 出どころ: https://github.com/pyodide/pyodide

## CPython 標準ライブラリ（python_stdlib.zip に含まれる）

- ★PSF License Agreement
- 出どころ: https://www.python.org/

## このページ自体

- 暁月ラボ ライブコーディング（2026-09-03）
- ★Discord Activity として動かすために作りました

## Ruby 3.4（ruby.wasm）

- 配布元: `@ruby/3.4-wasm-wasi` / `@ruby/wasm-wasi` v2.10.1（npm）
- ライセンス: **MIT**（全文は `ruby/LICENSE`）
- 同梱物: `ruby/ruby.wasm`（stdlib入り 29.2MB）／`ruby/browser.umd.js`／`ruby/browser.script.umd.js`
- ★改変していません（配布物をそのまま置いています）
- ★同梱した理由: Discord Activity のCSPで外部CDNが弾かれるため（同一オリジンにする）
