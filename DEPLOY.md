# Web公開方法

このアプリケーションをWebで公開する方法を説明します。

## 方法1: GitHub Pages（推奨・無料）

### 手順

1. **GitHubにリポジトリをプッシュ**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **GitHubでリポジトリの設定を開く**
   - GitHubのリポジトリページで「Settings」をクリック
   - 左メニューから「Pages」を選択

3. **GitHub Pagesを有効化**
   - 「Source」で「Deploy from a branch」を選択
   - 「Branch」で「main」を選択
   - 「/ (root)」を選択
   - 「Save」をクリック

4. **公開URLを確認**
   - 数分後、`https://[ユーザー名].github.io/[リポジトリ名]/` でアクセス可能になります

## 方法2: Netlify（簡単・無料）

### 手順

1. **Netlifyにアクセス**
   - https://www.netlify.com/ にアクセス
   - アカウントを作成（GitHubアカウントでログイン可能）

2. **デプロイ**
   - 「Add new site」→「Deploy manually」を選択
   - プロジェクトフォルダをドラッグ&ドロップ
   - または、GitHubリポジトリを連携して自動デプロイ

3. **公開URLを確認**
   - デプロイ完了後、自動的にURLが生成されます
   - 例: `https://[ランダムな文字列].netlify.app`

## 方法3: Vercel（簡単・無料）

### 手順

1. **Vercelにアクセス**
   - https://vercel.com/ にアクセス
   - アカウントを作成（GitHubアカウントでログイン可能）

2. **デプロイ**
   - 「Add New Project」をクリック
   - GitHubリポジトリを選択
   - 「Deploy」をクリック

3. **公開URLを確認**
   - デプロイ完了後、自動的にURLが生成されます
   - 例: `https://[プロジェクト名].vercel.app`

## 注意事項

- カメラへのアクセスにはHTTPSが必要です（GitHub Pages、Netlify、VercelはすべてHTTPS対応）
- 初回のカメラ許可を求めるダイアログが表示されます
- モバイルデバイスでも動作しますが、カメラの許可が必要です

