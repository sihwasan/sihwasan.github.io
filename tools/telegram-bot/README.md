# 시화산노회 관리자 알림 봇 (텔레그램)

노회장·서기·간사가 함께 있는 텔레그램 방에 상주하면서 이런 일을 합니다.

| 언제 | 봇이 하는 일 |
|---|---|
| 서류 신청이 들어왔을 때 | 신청자·서류·용도를 방에 알립니다 |
| 증명서를 발급했을 때 | 발급번호와 대상을 알립니다 (노회장이 바로 확인) |
| 노회장·서기·간사가 바뀌었을 때 | 인수인계 절차를 안내합니다 |
| 새 임원이 방에 들어왔을 때 | 맞이하고, 임기를 마치신 분께 퇴장을 권합니다 |

방에서 쓸 수 있는 말: `/임원` `/인수인계` `/신청` `/도움말`

---

## 처음 한 번 준비하기 (10분)

### 1) 텔레그램에서 봇 만들기

1. 텔레그램에서 **@BotFather** 를 찾아 대화를 시작합니다.
2. `/newbot` 이라고 보냅니다.
3. 봇 이름을 물으면 → `시화산노회 알림`
4. 아이디를 물으면 → `sihwasan_notice_bot` (이미 쓰는 이름이면 다른 이름으로)
5. BotFather 가 **토큰**을 줍니다. 이렇게 생긴 긴 글자입니다.
   `8123456789:AAH1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6P`
   → 이 토큰을 복사해 두세요. **다른 사람에게 알려주면 안 됩니다.**

### 2) Supabase 키 가져오기

1. [Supabase 대시보드](https://supabase.com/dashboard/project/ltbhgwozkffenahqdzfj) 접속
2. 왼쪽 아래 **Project Settings → API**
3. **Project API keys** 에서 `service_role` 키의 **Reveal** 을 눌러 복사합니다.
   → 이 키는 모든 자료를 볼 수 있는 열쇠입니다. **홈페이지에 올리거나 남에게 주면 안 됩니다.**
   (이 폴더의 `config.json` 은 저장소에 올라가지 않도록 막아 두었습니다.)

### 3) config.json 만들기

이 폴더의 `config.sample.json` 을 복사해서 이름을 **`config.json`** 으로 바꾸고,
메모장으로 열어 두 곳을 채웁니다.

```json
{
  "botToken": "8123456789:AAH1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6P",
  "chatId": null,
  "supabaseUrl": "https://ltbhgwozkffenahqdzfj.supabase.co",
  "supabaseServiceKey": "여기에 service_role 키",
  "pollSeconds": 30
}
```

### 4) 방 만들고 봇 초대하기

1. 텔레그램에서 **새 그룹**을 만듭니다. (이름 예: `시화산노회 임원방`)
2. 노회장·서기·간사를 초대합니다.
3. 방금 만든 봇(`@sihwasan_notice_bot`)도 초대합니다.
4. 방에서 **`/등록`** 이라고 한 번 적어 주세요.
   봇이 "이 방을 알림 방으로 정했습니다" 라고 답하면 끝입니다.

### 5) 봇 켜기

**`알림봇 시작.bat`** 을 두 번 누릅니다.
`tools` 폴더의 **`자동실행 등록.bat`** 을 한 번 실행해 두시면,
컴퓨터를 켤 때마다 저절로 돌아갑니다.

---

## 미리 해두어야 할 것

Supabase에서 **`32_notify_president.sql`** 을 실행해 두셔야 알림이 쌓입니다.
(대시보드 → SQL Editor → New query → 파일 내용 붙여넣고 Run)

## 잘 안 될 때

| 증상 | 살펴볼 것 |
|---|---|
| "봇 토큰이 올바르지 않은 것 같습니다" | `config.json` 의 botToken 을 다시 확인 |
| 알림이 안 옴 | 방에서 `/등록` 을 했는지 / `32_notify_president.sql` 을 실행했는지 |
| "알림함을 읽지 못했습니다" | service_role 키가 맞는지 확인 |
| 봇이 방 글을 못 읽음 | BotFather → `/setprivacy` → 해당 봇 → **Disable** |

## 안전에 관하여

- `config.json` 과 `state.json` 은 저장소에 올라가지 않습니다. (`.gitignore`)
- 봇은 이 컴퓨터에서만 돌고, 토큰도 이 컴퓨터에만 있습니다.
- 관리자 방에서 나가신 분은 더 이상 알림을 받지 않습니다.
  그래서 임기를 마치시면 방에서 나가시는 것이 중요합니다.
