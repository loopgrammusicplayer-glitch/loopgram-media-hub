/** Firebase web configuration is public; never put service-account credentials here. */
export function firebaseWebConfig(apiKey?: string) {
  return {
    apiKey: apiKey?.trim() || "AIzaSyCzl8Aw89zRLVgFpUAkSL1WlB7m_6CcObw",
    authDomain: "loopgram-channel.firebaseapp.com",
    projectId: "loopgram-channel",
    storageBucket: "loopgram-channel.firebasestorage.app",
    messagingSenderId: "800964564433",
    appId: "1:800964564433:web:960caaa57c4847515abcf0",
  };
}