# 語音轉文字系統

這個版本包含前端和後端。後端使用 Node.js 原生 `http`，不需要安裝 npm 套件。

## 啟動

```bash
node server.js
```

然後打開：

```text
http://localhost:3000
```

## 功能

- 首頁顯示 QR code，掃瞄或點擊後進入登入頁。
- 學生登入後只會看到錄音介面。
- 老師登入密碼是 `123456`。
- 老師介面可新增學生和學生密碼、查看學生名單、播放每位學生的錄音、編輯或查看轉文字結果。
- 錄音會傳到後端，音訊檔儲存在 `data/uploads/`。
- 學生、錄音紀錄和文字儲存在 `data/db.json`。
- 轉文字目前先使用瀏覽器 `SpeechRecognition` / `webkitSpeechRecognition` 即時聽寫，再把文字一併存到後端。

## 測試

1. 執行 `node server.js`。
2. 打開 `http://localhost:3000`。
3. 學生登入，選擇學生並輸入學生密碼。預設三位示範學生的密碼是 `123456`。
4. 按「開始錄音」並允許麥克風權限。
5. 停止錄音後，到老師介面選擇同一位學生，即可看到錄音和文字。

## API

- `GET /api/state`：取得學生和錄音。
- `POST /api/login/teacher`：老師登入，body: `{ "password": "123456" }`。
- `POST /api/login/student`：學生登入，body: `{ "studentId": "...", "password": "..." }`。
- `POST /api/students`：新增學生，body: `{ "name": "學生姓名", "password": "學生密碼" }`。
- `POST /api/recordings`：新增錄音，body 包含 `studentId`, `audioDataUrl`, `durationMs`, `transcript`。
- `PATCH /api/recordings/:id`：更新轉文字內容。

## 注意

目前密碼以示範方式明文儲存在 `data/db.json`，正式上線應改用雜湊密碼和 session/token 身份驗證。若要使用更準確的雲端轉文字，可在後端新增 OpenAI Whisper 或 Google Speech-to-Text 串接。
