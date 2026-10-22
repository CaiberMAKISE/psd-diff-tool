# PSD差分ツール v0.4.10 — ZIP出力ボタン無効化の修正

## 原因
v0.4.9 HTMLのWorker読み込みURLが `psd-worker.js?v=0.4.8` のままで、キャッシュから旧Workerを読み込む可能性がありました。一括出力ボタンは `activeWorkerVersion===UI_VERSION` が必要なため、v0.4.8 Workerでは無効になります。

## 変更
- UI/Worker本体/Worker URLのバージョンをv0.4.10へ統一。
- バージョン不一致時、ZIPパネルに原因を表示。
- v0.4.9のPNG/WebP/ZIP、連番開始番号、90pxサムネイル等は維持。
- 可逆WebPは対象外のまま。

## 更新・確認
1. `index.html` と `psd-worker.js` を両方置換。
2. GitHub Pagesで強制再読み込み（Ctrl+Shift+R）。
3. PSD読込後、`UI v0.4.10 / Worker v0.4.10` を確認。
4. 組み合わせ生成後、ZIP出力ボタンが有効になることを確認。
5. 3件程度をPNG出力し、指定した連番開始番号からZIPに入ることを確認。
