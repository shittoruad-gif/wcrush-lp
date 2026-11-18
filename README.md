# W CRUSH 体験LP（株式会社グラツィア様）

W CRUSH iP SOME × Wデザインメソッド の施術体験（70分 8,800円税込・先着30名様）のLP。
公開URL：**https://wcrush.s-toru.com/wcrush/**

提供：株式会社しっとる（LPプラン。サーバー・ドメインはしっとる管理）

## 中身

| 置き場所 | 内容 |
|---|---|
| `public/` | 公開するファイル一式（LP本体・サンクスページ・画像・robots.txt） |
| `server.js` | 静的配信と、お申し込みフォームの受け取り（`POST /api/apply`） |
| `Dockerfile` | nginx ではなく Node で配る（フォームの受け取りがあるため） |

`public/` は手で直さない。作り元は別にある（下記）。

## 作り直し方

LPの中身を直すときは、作り元の `lp/grazia` で直してから、公開用のデータを作り直す。

```
python3 _src/build5.py     # 確認用（「要確認」の札つき・noindex）を作る
python3 _src/publish.py    # 公開用（札なし・検索に出る・フォームは /api/apply）を作る
```

`_src/publish.py` が確認用との差を吸収している。
制作メモ（HTMLコメント）を外す／「要確認」の札を外す／noindex を外す／フォームの送り先を Netlify から `/api/apply` に変える、の4点。
できた `_public/` を、このリポジトリの `public/` に入れ替えて push する。

## お申し込みの流れ

1. LPのフォームが `POST /api/apply` に送る
2. サーバーが控えを `/app/data/applications.jsonl` に1行足す（**先に控え、あとで通知**。メールが送れなくても申し込みは残る）
3. 通知メールを送る
4. `/wcrush/thanks/` に戻す

控えを見る：

```
docker exec <コンテナ> tail -5 /app/data/applications.jsonl
```

## 環境変数

| 変数 | 既定 | 内容 |
|---|---|---|
| `RESEND_API_KEY` | （なし） | **これが無いと通知メールは飛ばない**（控えは残る）。Resend の送信キー |
| `NOTIFY_TO` | （なし） | **これが無いと通知メールは飛ばない**。通知先をカンマ区切りで。先方のアドレスなのでコードには書かず、Coolify の環境変数に入れる |
| `MAIL_FROM` | `W CRUSH 体験申し込み <noreply@s-toru.com>` | 差出人。**Resend で認証済みのドメイン**にする |
| `MAIL_BCC` | （なし） | しっとる側の控え用 |
| `DATA_DIR` | `/app/data` | 控えの置き場所 |
| `PORT` | `80` | 待受ポート |

## デプロイ（Coolify）

- アプリ：`wcrush-lp`（ConoHa VPS 163.44.103.9 の Coolify）
- Build Pack：Dockerfile／Ports Exposes：`80`／FQDN：`https://wcrush.s-toru.com`
- **Persistent Storage を `/app/data` に付ける**（付けないと、反映のたびにお申し込みの控えが消える）
- DNS：`wcrush` A → `163.44.103.9`（s-toru.com のDNSは Squarespace Domains の管理）

push しても自動では反映されない（自動反映の対象は threads-studio のみ）。Coolify の Deploy を押すか、API で起動する。

## 注意

- 薬機法に触れる言い回しは使わない（美容の表現が多いLPのため）。
- Meta広告は s-toru.com の他のLPと同じドメイン扱いになる。1つが審査で問題になると他にも響く。

## 計測（Meta ピクセル）

- 2026-11-18 追加。ピクセル「GRAZIA_W CRUSH体験LP」（ID 2574963436333615・ビジネス WDM認定講師|根岸・広告アカウント GRAZIA_W CRUSH体験_Meta広告 にリンク済み）。
- LP本体で PageView、`/wcrush/thanks/`（送信完了）で PageView ＋ Lead。
- 作り元（lp/grazia）が手元に無かったため、`public/` に直接入れた。作り元から作り直すときは、この2か所の `<!-- Meta ピクセル -->` を作り元にも入れること。
