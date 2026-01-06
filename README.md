# Koyeb WebDAV Proxy

專門為 InfiniCLOUD (小日本碟) 設計的 WebDAV 代理服務。

## 功能

- ✅ 列出資料夾內容
- ✅ 上傳檔案
- ✅ 下載檔案
- ✅ 建立資料夾
- ✅ 刪除檔案/資料夾
- ✅ 移動/重命名
- ✅ 複製檔案

## 部署到 Koyeb

1. 將此專案推送到 GitHub
2. 在 Koyeb 建立新 App
3. 連接 GitHub 倉庫
4. 設定 Build Command: `npm install`
5. 設定 Run Command: `npm start`
6. 設定 Port: 8000

## API 端點

| 方法 | 端點 | 功能 |
|------|------|------|
| GET | /api/gateway?path=/ | 列出資料夾 |
| GET | /api/download/:id?path=/file&auth=xxx | 下載檔案 |
| PUT | /api/gateway?path=/file | 上傳檔案 |
| POST | /api/gateway?path=/folder | 建立資料夾 |
| DELETE | /api/gateway?path=/file | 刪除 |
| POST | /api/move/:id | 移動/重命名 |
| POST | /api/copy/:id | 複製 |

## 認證方式

使用 `x-drive-config` Header，內容為 Base64 編碼的 JSON：

```json
{
  "url": "https://webdav.teracloud.jp/dav/",
  "username": "your_username",
  "password": "your_password"
}
```
