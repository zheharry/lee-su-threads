# Lee-Su-Threads Userscript (Mobile Version)

這是 Lee-Su-Threads 擴充功能的 Userscript 版本，適用於支援 Userscript 的行動裝置瀏覽器。

## 功能

- 自動顯示 Threads 貼文作者的地點資訊
- 與原始瀏覽器擴充功能相同的功能
- 適用於行動裝置

## 安裝方式

### iOS (iPhone/iPad)

1. **安裝 Userscripts App**
   - 從 App Store 下載 [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) (免費)
   - 這是 Safari 擴充功能

2. **啟用擴充功能**
   - 打開 Safari 設定 → 擴充功能 → 啟用 Userscripts

3. **安裝腳本**
   - 打開 Userscripts App
   - 點擊 "Set Userscripts Directory" 選擇一個資料夾
   - 將 `lee-su-threads.user.js` 檔案複製到該資料夾
   - 或者直接在 Safari 中打開 `.user.js` 檔案網址安裝

### Android (Chrome/Firefox)

#### 使用 Firefox + Tampermonkey/Violentmonkey

1. **安裝 Firefox for Android**
   - 從 Play Store 下載 Firefox

2. **安裝 Tampermonkey 或 Violentmonkey**
   - 在 Firefox 中打開 Add-ons 頁面
   - 搜尋 "Tampermonkey" 或 "Violentmonkey" 並安裝

3. **安裝腳本**
   - 點擊 Tampermonkey/Violentmonkey 圖示
   - 選擇 "建立新腳本" 或 "新增腳本"
   - 複製貼上 `lee-su-threads.user.js` 的內容
   - 儲存

#### 使用 Kiwi Browser (支援 Chrome 擴充功能)

1. **安裝 Kiwi Browser**
   - 從 Play Store 下載 [Kiwi Browser](https://play.google.com/store/apps/details?id=com.kiwibrowser.browser)

2. **安裝 Tampermonkey**
   - 在 Kiwi 中打開 Chrome Web Store
   - 搜尋並安裝 Tampermonkey

3. **安裝腳本**
   - 同上述 Firefox 步驟

## 使用方式

1. 打開 Threads 網頁版 (www.threads.net)
2. 滾動瀏覽貼文
3. 腳本會自動在每篇貼文旁顯示作者的地點資訊

## 注意事項

- 需要登入 Threads 帳號才能使用
- 如果查詢太多次，可能會被 Threads 暫時限制
- 行動裝置上的效能可能略低於桌面版

## 問題排解

### 看不到地點資訊
- 確認腳本已啟用
- 重新整理 Threads 頁面
- 稍微滾動頁面讓腳本載入

### 顯示 ❓ 圖示
- 點擊圖示重試
- 或先點擊該使用者的個人資料頁面

### 被限制
- 等待 5 分鐘後自動恢復
- 或點擊 "繼續自動查詢" 按鈕手動重試

## 相容性

| 平台 | 瀏覽器 | 擴充功能 | 狀態 |
|------|--------|----------|------|
| iOS | Safari | Userscripts | ✅ |
| Android | Firefox | Tampermonkey/Violentmonkey | ✅ |
| Android | Kiwi Browser | Tampermonkey | ✅ |
| Android | Chrome | ❌ | 不支援 |

## 授權

MIT License
