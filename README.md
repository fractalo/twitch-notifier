# twitch-notifier
텔레그램 트위치 알림 봇

## 기능
- 방송 알림 (방송 시작, 방송 종료, 제목 변경, 카테고리 변경)
- 채널 포인트 예측 알림 (시작, 결과, 취소)
- 채팅 알림

## 사용법

### 빌드 및 실행

1. yarn berry 패키지 매니저 설치

2. 패키지 설치
```
yarn
```
3. 빌드
```
yarn build
```

4. 실행
```
yarn node dist
```

### 환경변수

프로젝트의 루트 디렉토리에 .env 파일을 생성 후, 다음의 필수 환경변수를 설정합니다.
```
TWITCH_API_CLIENT_ID
TWITCH_API_CLIENT_SECRET
TELEGRAM_TWITCH_NOTI_BOT_TOKEN
```

### 트위치 채널 알림 설정

#### config 경로
```
./config/telegram/*.json
```

#### config 형식
```ts
{
    type: "telegram"
    telegramChannel: {
        chatId: string | number // 알림을 받을 텔레그램 Chat ID
        name: string // 로그용 이름
    }
    twitchChannels: [
        {
            channel: // 트위치 ID
            options: {
                notifiesOnline: boolean // 방송 시작 알림 여부 (default: false)
                notifiesOffline: boolean // 방송 종료 알림 여부 (default: false)
                notifiesTitle: boolean // 제목 변경 알림 여부 (default: false)
                notifiesCategory: boolean // 카테고리 변경 알림 여부 (default: false)
                excludedCategoryNames: string[] // 카테고리 변경 알림에서 제외할 카테고리 목록
                notifiesPredictions: boolean // 채널 포인트 예측 알림 여부 (default: false)
                monitoredChatters: string[] // 채팅 알림 트위치 ID 목록
            }
        }
    ]
}
```

### 트위치 유저 설정

#### config 경로
```
./config/users.json
```

#### config 형식
```ts
[
    {
        loginName: string // 트위치 ID
        name: string // 알림 메시지에 표시되는 이름
        emoji: string // 채팅 알림 메시지에 표시되는 이모지
    }
]
```


### 트위치 이모티콘 대체 문자 설정

#### config 경로
```
./config/twitchEmotes.json
```

#### config 형식
```ts
[
    {
        [트위치 이모티콘 이름]: string // 대체 단어 또는 이모지
    }
]
```


    