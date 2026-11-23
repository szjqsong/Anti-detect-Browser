# Anti-detect Browser

個人用的指紋瀏覽器管理端。核心使用開源的 [fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium)（基於 ungoogled-chromium，在 C++ 層修改指紋），本專案負責環境管理、代理、啟動和自動化 API。

## 功能（第一階段）

- 環境（Profile）管理：新建、編輯、刪除、搜尋；每個環境有獨立的 `user-data-dir`，Cookie 和快取互相隔離
- 指紋：種子、作業系統與版本、瀏覽器品牌、CPU 核心數、語言、時區，可個別關閉 Canvas、Audio、字型、ClientRects、GPU 偽裝
- 代理：支援 HTTP、HTTPS、SOCKS4、SOCKS5，可帶帳號密碼（由本機轉發層補上驗證，因為核心不支援帶密碼的代理）；可一鍵檢測出口 IP
- 時區和語言可設成「自動」，依代理出口 IP 自動對應
- 本機 API：啟動環境後回傳 CDP `wsEndpoint`，可直接接 Puppeteer 或 Playwright
- 智慧選種：建立環境時用 headless 核心實測種子，排除沒有 Audio 雜訊的種子，並避開其他環境已用的 Audio 種類（148 版核心只有約 6 種 Audio 雜訊）
- 螢幕解析度與像素比、地理位置（詢問／允許／禁止，座標依代理 IP 或自訂）：透過 CDP Emulation 在引擎內覆寫。自訂螢幕時會關閉 Site Isolation，讓跨站 iframe 也套用相同的值
- 硬體預覽：顯示種子會產生的 GPU、deviceMemory 與 Audio 種類
- 預設搜尋引擎 Google（ungoogled-chromium 預設不搜尋），以內建的純設定擴充功能實作
- 介面語言：繁體中文、簡體中文、English

## 安裝

```bash
npm install
npm run start        # 打包 UI 並啟動 Electron
npm run dev          # 開發模式（Vite 熱更新）
npm run smoke        # 不開 Electron 的端到端測試（預設用系統 Chrome）
```

> **Node 26 注意事項**：Electron 33 安裝腳本使用的 extract-zip 在 Node 26 會解壓到一半就結束，導致 `Electron failed to install correctly`。解法：
> ```bash
> cd node_modules/electron && rm -rf dist && mkdir dist
> ditto -x -k ~/Library/Caches/electron/*/electron-v33.*-darwin-arm64.zip dist
> printf 'Electron.app/Contents/MacOS/Electron' > path.txt
> ```

### 核心

App 內建 fingerprint-chromium **148.0.7778.215**（macOS arm64，位於 `Contents/Resources/kernel/`）。「設定」裡的自訂核心路徑留空時，就會使用內建核心。

```bash
npm run fetch-kernel  # 下載核心到 vendor/kernel/（驗證 SHA-256），npm run dist 會自動執行
npm run verify-fp     # 用真實核心驗證 UA、時區、語言、Canvas、Audio 偽裝是否生效
npm run dist          # 打包 release/Anti-detect-Browser-<版本>-arm64.dmg
npm run verify-device # 驗證智慧選種、螢幕／定位覆寫、跨站 iframe 一致性、預設搜尋引擎
npm run audit         # 指紋檢測（本機檢查＋公開檢測網站），報告存在 audit-output/
npm run i18n-check    # 檢查簡中／英文翻譯是否齊全
```

要升級核心時，修改 `scripts/fetch-kernel.sh` 裡的 `VERSION` 和 `SHA256`。

## 本機 API

預設埠號為 `54345`，每個請求都要帶 `x-api-key` 標頭（在「設定」中查看）。

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/v1/status` | 健康檢查 |
| GET | `/api/v1/profiles` | 環境列表（代理密碼會遮蔽） |
| POST | `/api/v1/profiles` | 新建環境（JSON body，欄位同 UI） |
| GET | `/api/v1/profiles/:id` | 取得單一環境 |
| POST | `/api/v1/profiles/:id/start` | 啟動，回傳 `{ wsEndpoint, debugPort, geo }` |
| POST | `/api/v1/profiles/:id/stop` | 關閉 |

```js
const { chromium } = require('playwright');
const res = await fetch(`http://127.0.0.1:54345/api/v1/profiles/${id}/start`, {
  method: 'POST', headers: { 'x-api-key': KEY },
}).then((r) => r.json());
const browser = await chromium.connectOverCDP(res.data.wsEndpoint);
```

## 架構

```
src/main/
  index.js        Electron 入口、IPC、API 生命週期
  store.js        JSON 儲存（原子寫入）
  fingerprint.js  指紋產生
  kernel.js       環境 → 核心啟動參數
  proxy.js        代理解析、本機轉發、出口 IP 檢測
  launcher.js     程序管理、等待 DevTools 端點
  api.js          本機 HTTP API
src/preload/      contextBridge
src/renderer/     React UI
```

資料儲存在 `~/Library/Application Support/anti-detect-browser/`。

## 後續規劃

- 第二階段：批次建立和匯入代理、Cookie 匯入匯出、環境複製和分組管理
- 第三階段：RPA 和腳本執行器、核心自動下載與版本管理
