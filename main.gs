// ★★★ 設定項目 ★★★

// DiscordウェブフックURLに置き換えてください
const WEBHOOK_URL = 'here'; // ここをあなたのウェブフックURLに修正してください！

// API
const API_URL = 'https://api.zpw.jp/connect/v2/serverlist.php';

// 監視対象のサーバー名
const TARGET_SERVER_NAME = 'testserver'; // ここをあなたのサーバー名に修正


const API_BASIC_VALIDATION = (data) => {
  return data && typeof data === 'object' && data.status === 'ok' && typeof data.servers === 'object' && data.servers !== null && !Array.isArray(data.servers);
};


const TIMEOUT_SECONDS = 20;


const KEY_PREFIX = 'server_status_';


const STATUS = {
  OK: 'OK', 
  DOWN_NOTIFIED: 'DOWN_NOTIFIED', 
};


const STATUS_KEY = KEY_PREFIX + 'status_' + Utilities.base64Encode(API_URL + '_' + TARGET_SERVER_NAME).replace(/=/g, '');



/**
 * メイン関数：定期的にAPIから特定のサーバーの状態をチェックし、
 * 状態が変化した場合にのみDiscordに通知します。
 * この関数をトリガーに設定してください。
 */
function checkTargetServerStatusAndNotify() { // 関数名を変更しました (旧 checkTargetServerStatus)
  Logger.log(`--- サーバー "${TARGET_SERVER_NAME}" (${API_URL}) チェック開始 (状態変化通知モード) ---`);
  const properties = PropertiesService.getScriptProperties();


  const previousStatus = properties.getProperty(STATUS_KEY) || STATUS.OK;
  Logger.log(`以前の状態: ${previousStatus}`);

  let currentStatusIsDown = false;
  let details = ''; 
  let parsedJson = null;

  try {
    Logger.log(`API "${API_URL}" にアクセス中...`);
    const response = UrlFetchApp.fetch(API_URL, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      timeout: TIMEOUT_SECONDS,
    });

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();
    Logger.log(`API応答取得成功。HTTPステータスコード: ${statusCode}`);

    if (statusCode < 200 || statusCode >= 300) {
      currentStatusIsDown = true; 
      details = `API応答エラー (HTTPステータスコード: ${statusCode})`;
      Logger.log(`判断: APIのHTTPステータスコードが異常 (${statusCode})`);

    } else {
      try {
        Logger.log(`API応答をJSONパース中...`);
        parsedJson = JSON.parse(responseText);
        Logger.log(`JSONパース成功。`);

        Logger.log(`API応答の基本構造を検証中...`);
        if (!API_BASIC_VALIDATION(parsedJson)) {
          currentStatusIsDown = true; 
          details = `API応答データ構造が不正です。`;
          Logger.log(`判断: API応答データ構造が不正`);

        } else {
            Logger.log(`API応答の基本構造は正常です。オンラインサーバーリストを走査中...`);
            let targetServerFound = false;
            const serverGroupsObject = parsedJson.servers;

            for (const clientId in serverGroupsObject) {
                if (serverGroupsObject.hasOwnProperty(clientId)) {
                    const serverGroup = serverGroupsObject[clientId];
                    if (Array.isArray(serverGroup)) {
                        for (const serverDetails of serverGroup) {
                            if (serverDetails && typeof serverDetails === 'object' && serverDetails.hasOwnProperty('server_name')) {
                                if (serverDetails.server_name === TARGET_SERVER_NAME) {
                                    targetServerFound = true;
                                    Logger.log(`対象サーバー "${TARGET_SERVER_NAME}" をオンラインリスト内で発見しました。`);
                                    break;
                                }
                            }
                        }
                    }
                }
                 if (targetServerFound) break;
            }

            if (targetServerFound) {
              currentStatusIsDown = false;
              details = 'サーバーはオンラインリストに含まれています。'; 
              Logger.log(`判断: 対象サーバー "${TARGET_SERVER_NAME}" がオンラインリストにあります。サーバーはオンラインと判断。`);
            } else {
              currentStatusIsDown = true;
              details = `API応答のオンラインリストに "${TARGET_SERVER_NAME}" が見つかりません。`;
              Logger.log(`判断: 対象サーバー "${TARGET_SERVER_NAME}" がオンラインリストにありません。`);
            }
        }

      } catch (jsonError) {
        currentStatusIsDown = true; 
        details = `API応答が有効なJSONではありません。エラー: ${jsonError.message}`;
        Logger.log(`判断: JSONパースエラー - ${jsonError.message}`);
        Logger.log(`API応答テキストの先頭 (最大500文字): ${responseText ? responseText.substring(0, 500) + '...' : 'なし'}`);
      }
    }

  } catch (e) {
    currentStatusIsDown = true;
    details = `APIへのネットワークエラー: ${e.message}`;
    Logger.log(`判断: APIへのネットワークエラー - ${e.message}`);
  }

  
  if (currentStatusIsDown) {
    
    if (previousStatus !== STATUS.DOWN_NOTIFIED) {
     
      Logger.log(`状態変化: OK -> DOWN。オフライン通知を送信します。`);
      sendDiscordNotification(TARGET_SERVER_NAME, API_URL, STATUS.DOWN_NOTIFIED, details);
      properties.setProperty(STATUS_KEY, STATUS.DOWN_NOTIFIED);
    } else {

      Logger.log(`状態継続: DOWN -> DOWN。通知はスキップします。`);
      properties.setProperty(STATUS_KEY, STATUS.DOWN_NOTIFIED);
    }
  } else { 
    
    if (previousStatus === STATUS.DOWN_NOTIFIED) {
     
      Logger.log(`状態変化: DOWN -> OK。オンライン復旧通知を送信します。`);
      sendDiscordNotification(TARGET_SERVER_NAME, API_URL, STATUS.OK);
      properties.setProperty(STATUS_KEY, STATUS.OK); 
    } else {
     
      Logger.log(`状態継続: OK -> OK。通知は不要です。`);
      properties.setProperty(STATUS_KEY, STATUS.OK); 
    }
  }

  Logger.log(`--- チェック終了 ---`);
}

/**
 * Discordウェブフックに通知を送信する関数。
 * @param {string} serverName 監視対象のサーバー名
 * @param {string} apiUrl 監視に使ったAPI URL
 * @param {string} status 状態 ('OK' or 'DOWN_NOTIFIED')
 * @param {string} [details] ダウン時の詳細メッセージ (オプション)
 */
function sendDiscordNotification(serverName, apiUrl, status, details) {
  
  if (!WEBHOOK_URL || WEBHOOK_URL === 'YOUR_DISCORD_WEBHOOK_URL') {
    Logger.log('警告: DiscordウェブフックURLが設定されていません。通知送信をスキップします。');
    return;
  }

  let color;      
  let title;       
  let description; 
  const timestamp = new Date().toISOString();

  if (status === STATUS.DOWN_NOTIFIED) {
    color = 15548997; // 赤色のdecimal値
    // ★ 停止時のタイトルと本文 ★
    title = `❌️🔌Connectから切断🔌❌️`; // 停止タイトル
    description = `Connectからの切断を検知しました。`; // 停止本文
   

  } else if (status === STATUS.OK) {
    color = 3066993; 
    // ★ 復旧時のタイトルと本文を修正 ★
    title = `✅️🔌Connectに再接続🔌✅️`; // 復旧タイトル
    description = `Connectに再接続されました。\n参加することができます。`; // 復旧本文

  } else {

      Logger.log(`警告: 不明なステータス "${status}" での通知リクエストです。スキップします。`);
      return;
  }


  const payload = {
    // content: '@everyone', // 全体にメンションしたい場合はコメントを外す
    embeds: [
      {
        title: title,
        description: description,
        color: color,
        // fields: [], // フィールドは使用しない
        footer: { text: 'Google Apps Script サーバー状態通知' }, 
        timestamp: timestamp, 
      },
    ],
  };

  try {
    Logger.log(`Discordへの通知送信中... タイトル: "${title}"`);

    const discordResponse = UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    Logger.log(`Discordウェブフック応答: ステータスコード ${discordResponse.getResponseCode()}`);

  } catch (e) {

    Logger.log(`エラー: Discordへの通知送信に失敗しました: ${e.message}`);
  }
}
