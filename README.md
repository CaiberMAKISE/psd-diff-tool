# PSD差分ツール v0.2.5（比較診断版）

GitHub Pages に `index.html` と `psd-worker.js` を同じディレクトリへアップロードしてください。

## 今回の修正
- v0.2.3 の比較で一致精度が高かった配列順の描画を通常モードに固定（v0.2.4 の逆転を修正）。
- WorkerスクリプトのURLに `?v=0.2.5` を付与し、旧版キャッシュを回避しやすくしました。
- UI・Worker・描画エンジンのバージョンを画面と診断JSONに明記。
- マスクとクリッピングの4条件について、実際に使用した設定、適用候補数、適用数、画像チェックサムを記録。
- v0.2.4の暫定マスク・クリッピング実装はそのまま残しており、精度は引き続き検証中です。

## 検証
1. 公開ページを強制再読み込みし、`UI v0.2.5 / Worker v0.2.5` が表示されることを確認。
2. `ember_ic.psd` を「元の表示状態で再合成」し、平均誤差が v0.2.3 の約0.0866に近いことを確認。
3. `wisleah_ic.psd` で「4条件を連続比較してJSON保存」を実行。
4. `wisleah_ic-features-comparison.json` を共有。各 `results` 要素の `renderOptions`, `counts.maskApplied`, `counts.clipApplied`, `counts.visibleMaskCandidates`, `counts.visibleClipCandidates`, `checksum` を確認します。

検証版です。通過グループや一部マスク・クリッピング挙動は未完成であり、出力を最終成果として使用しないでください。
