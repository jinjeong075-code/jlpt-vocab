// Firebase 설정값. 콘솔의 [프로젝트 설정 > 내 앱 > 웹]에서 복사한 값이다.
// 비워두면(null) 동기화 기능이 꺼진 채로 앱이 정상 동작한다.
//
// 이 값들은 공개되어도 되는 값이다. 브라우저에 그대로 내려가는 값이라
// 숨기는 것이 애초에 불가능하고, 실제 보안은 Realtime Database 규칙이 담당한다.
//   users/$uid 는 $uid === auth.uid 인 경우에만 읽기/쓰기 허용
// 인증 없이 접근하면 401 로 막히는 것을 확인했다.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBjwbww9IhXodc9RK4AoSZyk9ropwJBF8A",
  authDomain: "jlpt-vocab-91cc5.firebaseapp.com",
  databaseURL: "https://jlpt-vocab-91cc5-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "jlpt-vocab-91cc5",
  storageBucket: "jlpt-vocab-91cc5.firebasestorage.app",
  messagingSenderId: "161824662607",
  appId: "1:161824662607:web:16a6e5cf90fec3b081763a"
};
